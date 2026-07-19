import { IpcMainInvokeEvent } from 'electron';
import { processVideoUrl } from '../services/url-processor/index.js';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { FileManager } from '../services/file-manager.js';
import type { FFmpegContext } from '../services/ffmpeg-runner.js';
import { CancelledError } from '../../shared/cancelled-error.js';
import type {
  ProcessUrlOptions,
  ProcessUrlResult,
  VideoSuggestionDownloadHistoryMutationRequest,
  VideoSuggestionDownloadHistoryMutationResult,
} from '@shared-types/app';
import {
  acceptPendingUrlResult,
  cleanupAcceptedUrlResultFile,
  discardPendingUrlResult,
  registerAutoCancel,
  finish as registryFinish,
  registerPendingUrlResult,
} from '../active-processes.js';
import { finalizeCancelledUrlOperation } from '../utils/url-operation-finalizers.js';
import {
  isUrlDownloadLibraryFilePath,
  promoteUrlDownload,
  reclaimUrlDownloadLibraryFiles,
} from '../services/url-download-library.js';
import { VideoSuggestionDownloadHistoryManager } from '../services/video-suggestion-download-history.js';
import { settingsStore } from '../store/settings-store.js';
import { isIpcInvokeSenderGone } from '../utils/ipc-sender-liveness.js';

interface UrlHandlerServices {
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
  downloadLibraryDir: string;
}

let fileManagerInstance: FileManager | null = null;
let ffmpegCtx: FFmpegContext | null = null;
let downloadLibraryDir: string | null = null;
let downloadHistoryManager: VideoSuggestionDownloadHistoryManager | null = null;
const leaseCleanupRegistered = new Set<number>();

async function reclaimManagedHistoryPaths(
  filePaths: string[]
): Promise<string[]> {
  if (!downloadLibraryDir || filePaths.length === 0) return [];
  const result = await reclaimUrlDownloadLibraryFiles({
    libraryDir: downloadLibraryDir,
    filePaths,
    logger: log,
  });
  const failedByPath = new Map(
    result.failedPaths.map(failed => [failed.filePath, failed])
  );
  // Keep genuine deletion failures in the manager's persisted pending set so
  // they survive restart and are retried after the next history/lease update.
  return filePaths.filter(filePath => !failedByPath.has(filePath));
}

export function initializeUrlHandler(services: UrlHandlerServices): void {
  if (
    !services ||
    !services.fileManager ||
    !services.ffmpeg ||
    !String(services.downloadLibraryDir || '').trim()
  ) {
    throw new Error(
      '[url-handler] FileManager, FFmpegContext, and download library required.'
    );
  }
  fileManagerInstance = services.fileManager;
  ffmpegCtx = services.ffmpeg;
  downloadLibraryDir = services.downloadLibraryDir;
  downloadHistoryManager = new VideoSuggestionDownloadHistoryManager({
    persistence: {
      loadHistory: () => settingsStore.get('videoSuggestionDownloadHistory'),
      saveHistory: items =>
        settingsStore.set('videoSuggestionDownloadHistory', items),
      loadPendingReclaims: () =>
        settingsStore.get('pendingUrlDownloadLibraryReclaims'),
      savePendingReclaims: filePaths =>
        settingsStore.set('pendingUrlDownloadLibraryReclaims', filePaths),
    },
    isManagedLibraryPath: filePath =>
      isUrlDownloadLibraryFilePath(services.downloadLibraryDir, filePath),
    reclaimPaths: reclaimManagedHistoryPaths,
    onMaintenanceError: error =>
      log.warn(
        '[url-handler] Download history cleanup will be retried:',
        error
      ),
  });
  log.info(
    `[url-handler] Initialized with persistent download library: ${downloadLibraryDir}`
  );
}

function checkServicesInitialized(): {
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
} {
  if (!fileManagerInstance || !ffmpegCtx) {
    throw new Error('[url-handler] Services not initialized.');
  }
  return { fileManager: fileManagerInstance, ffmpeg: ffmpegCtx };
}

export async function handleProcessUrl(
  event: IpcMainInvokeEvent,
  options: ProcessUrlOptions
): Promise<ProcessUrlResult> {
  const operationId = options.operationId || uuidv4();
  log.info(
    `[url-handler] Starting process for URL: ${options.url}, Effective Operation ID used: ${operationId}`
  );

  // Progress goes to the tab that started the operation.
  const sendProgress = (progressData: {
    percent: number;
    stage: string;
    error?: string | null;
  }) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('url-processing-progress', {
        ...progressData,
        operationId,
      });
    }
  };

  if (!options || typeof options.url !== 'string' || !options.url.trim()) {
    log.warn('[url-handler] Invalid URL received');
    // Use sendProgress to report error to UI
    sendProgress({ percent: 0, stage: 'Error', error: 'Invalid URL provided' });
    return { success: false, error: 'Invalid URL provided', operationId };
  }

  const url = options.url.trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    log.warn(`[url-handler] URL does not start with http/https: ${url}`);
    sendProgress({ percent: 0, stage: 'Error', error: 'Invalid URL format' });
    return { success: false, error: 'Invalid URL format', operationId };
  }

  try {
    sendProgress({ percent: 0, stage: 'Validating' });

    const { fileManager, ffmpeg } = checkServicesInitialized();
    const controller = new AbortController();

    // Register auto-cancel early so generic cancellation can mark this operation
    // before yt-dlp has been spawned and promoted into the registry. The abort
    // signal then stops setup + download as one operation.
    registerAutoCancel(operationId, event.sender, () => {
      if (controller.signal.aborted) return;
      controller.abort();
      log.info(`[url-handler] Cancel triggered for ${operationId}`);
    });

    const result = await processVideoUrl(
      url,
      options.quality || 'mid',
      (progress: { percent: number; stage: string; error?: string | null }) => {
        log.info(
          `[url-handler] Progress update: ${progress.stage} - ${progress.percent}%`
        );
        sendProgress(progress);
      },
      operationId,
      {
        fileManager,
        ffmpeg,
      },
      {},
      {
        signal: controller.signal,
      }
    );

    registerPendingUrlResult(operationId, event.sender, result.videoPath);
    if (controller.signal.aborted) {
      return await finalizeCancelledUrlOperation({
        operationId,
        discardPendingUrlResult,
        registryFinish,
      });
    }

    const successResult: ProcessUrlResult = {
      success: true,
      filePath: result.videoPath,
      filename: result.filename,
      title: result.title,
      thumbnailUrl: result.thumbnailUrl,
      channel: result.channel,
      channelUrl: result.channelUrl,
      durationSec: result.durationSec,
      uploadedAt: result.uploadedAt,
      size: result.size,
      fileUrl: result.fileUrl,
      originalVideoPath: result.originalVideoPath,
      operationId,
    };
    return successResult;
  } catch (error: any) {
    if (error instanceof CancelledError) {
      return await finalizeCancelledUrlOperation({
        operationId,
        discardPendingUrlResult,
        registryFinish,
      });
    }

    if (typeof error === 'string') {
      log.error(`[url-handler] Error is string: ${error}`);
    } else if (typeof error === 'object' && error !== null) {
      log.error(
        `[url-handler] Error object keys: ${Object.keys(error).join(', ')}`
      );

      if (error.stderr)
        log.error(`[url-handler] Error stderr: ${error.stderr}`);
      if (error.stdout)
        log.error(`[url-handler] Error stdout: ${error.stdout}`);
      if (error.code) log.error(`[url-handler] Error code: ${error.code}`);
    }

    const rawErrorMessage =
      error?.message ||
      (typeof error === 'string' ? error : 'An unknown error occurred');

    const userFriendlyMessage =
      typeof (error as any)?.userFriendly === 'string' &&
      (error as any).userFriendly.trim().length > 0
        ? ((error as any).userFriendly as string)
        : rawErrorMessage;

    // If upstream flagged NeedCookies, surface that stage instead of generic error
    if (rawErrorMessage === 'NeedCookies') {
      sendProgress({ percent: 0, stage: 'NeedCookies' });
      await discardPendingUrlResult(operationId);
      registryFinish(operationId);
      return { success: false, error: 'NeedCookies', operationId };
    }

    // Generic error fallback
    sendProgress({ percent: 0, stage: 'Error', error: userFriendlyMessage });

    await discardPendingUrlResult(operationId);
    registryFinish(operationId);
    return {
      success: false,
      error: userFriendlyMessage,
      operationId,
    };
  }
}

export async function handleAcceptProcessedUrl(
  event: IpcMainInvokeEvent,
  operationId: string
): Promise<{ success: boolean; filePath?: string; error?: string }> {
  if (!String(operationId || '').trim()) {
    return { success: false, error: 'Operation ID is required' };
  }

  const pendingFilePath = acceptPendingUrlResult(operationId);
  if (!pendingFilePath) {
    return {
      success: false,
      error: 'Processed URL result is no longer available',
    };
  }

  if (!downloadLibraryDir) {
    await cleanupAcceptedUrlResultFile(
      `${operationId}:promotion-unavailable`,
      pendingFilePath
    );
    return {
      success: false,
      error: 'Persistent download storage is not available',
    };
  }

  try {
    const filePath = await promoteUrlDownload({
      sourcePath: pendingFilePath,
      libraryDir: downloadLibraryDir,
      operationId,
      persistDestinationOwnership: async destinationPath => {
        if (!downloadHistoryManager) {
          throw new Error('Persistent download ownership is not available');
        }
        await downloadHistoryManager.trackPromotedFile(destinationPath);
      },
      logger: log,
    });

    // Promotion persisted a reclaim claim before publishing the final path.
    // If the renderer died or reloaded while we promoted, no one will commit
    // the history entry that owns this file, so reclaim it immediately.
    if (isIpcInvokeSenderGone(event)) {
      log.warn(
        `[url-handler] Renderer gone before accepting handoff of ${operationId}; reclaiming promoted file.`
      );
      await cleanupAcceptedUrlResultFile(
        `${operationId}:sender-gone`,
        filePath
      );
      return {
        success: false,
        error: 'Requesting view is no longer available',
      };
    }
    return { success: true, filePath };
  } catch (error: any) {
    log.error(
      `[url-handler] Failed to promote accepted URL result ${operationId}:`,
      error
    );
    await cleanupAcceptedUrlResultFile(
      `${operationId}:promotion-failed`,
      pendingFilePath
    );
    return {
      success: false,
      error:
        error?.message ||
        'Downloaded video could not be moved into persistent storage',
    };
  }
}

export async function handleDiscardProcessedUrl(
  _event: IpcMainInvokeEvent,
  operationId: string
): Promise<{ success: boolean; error?: string }> {
  if (!String(operationId || '').trim()) {
    return { success: false, error: 'Operation ID is required' };
  }

  const success = await discardPendingUrlResult(operationId);
  if (!success) {
    return {
      success: false,
      error: 'Processed URL result is no longer available',
    };
  }

  return { success: true };
}

export async function handleCleanupAcceptedProcessedUrl(
  _event: IpcMainInvokeEvent,
  payload: { operationId: string; filePath: string }
): Promise<{ success: boolean; error?: string }> {
  const operationId = String(payload?.operationId || '').trim();
  const filePath = String(payload?.filePath || '').trim();

  if (!operationId) {
    return { success: false, error: 'Operation ID is required' };
  }

  if (!filePath) {
    return { success: false, error: 'File path is required' };
  }

  const success = await cleanupAcceptedUrlResultFile(
    `${operationId}:accepted-stale`,
    filePath
  );
  if (!success) {
    return {
      success: false,
      error: 'Accepted processed URL result could not be scheduled for cleanup',
    };
  }

  return { success: true };
}

function registerLeaseCleanup(event: IpcMainInvokeEvent): void {
  const rendererId = event.sender.id;
  if (leaseCleanupRegistered.has(rendererId)) return;
  leaseCleanupRegistered.add(rendererId);
  event.sender.once('destroyed', () => {
    leaseCleanupRegistered.delete(rendererId);
    void downloadHistoryManager?.releaseRenderer(rendererId);
  });
}

export async function handleMutateVideoSuggestionDownloadHistory(
  event: IpcMainInvokeEvent,
  request: VideoSuggestionDownloadHistoryMutationRequest
): Promise<VideoSuggestionDownloadHistoryMutationResult> {
  if (!downloadHistoryManager || !request?.mutation) {
    return {
      success: false,
      items: [],
      error: 'Persistent download history is not available',
    };
  }
  registerLeaseCleanup(event);
  try {
    const items = await downloadHistoryManager.mutate({
      rendererId: event.sender.id,
      mutation: request.mutation,
      seedItems: Array.isArray(request.seedItems) ? request.seedItems : [],
      mountedPaths: Array.isArray(request.mountedPaths)
        ? request.mountedPaths
        : [],
    });
    return { success: true, items };
  } catch (error) {
    log.error('[url-handler] Failed to mutate download history:', error);
    return {
      success: false,
      items: [],
      error:
        error instanceof Error
          ? error.message
          : 'Persistent download history could not be updated',
    };
  }
}

export async function handleSetMountedUrlDownloadLibraryPaths(
  event: IpcMainInvokeEvent,
  payload: { filePaths?: unknown }
): Promise<{ success: boolean; error?: string }> {
  if (!downloadHistoryManager) {
    return {
      success: false,
      error: 'Persistent download history is not available',
    };
  }
  registerLeaseCleanup(event);
  try {
    await downloadHistoryManager.setMountedPaths(
      event.sender.id,
      Array.isArray(payload?.filePaths)
        ? payload.filePaths.filter(
            (filePath): filePath is string => typeof filePath === 'string'
          )
        : []
    );
    return { success: true };
  } catch (error) {
    log.error('[url-handler] Failed to update mounted download leases:', error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Mounted download leases could not be updated',
    };
  }
}
