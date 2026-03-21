import { IpcMainInvokeEvent } from 'electron';
import { processVideoUrl } from '../services/url-processor/index.js';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { FileManager } from '../services/file-manager.js';
import type { FFmpegContext } from '../services/ffmpeg-runner.js';
import { CancelledError } from '../../shared/cancelled-error.js';
import type { ProcessUrlOptions, ProcessUrlResult } from '@shared-types/app';
import {
  acceptPendingUrlResult,
  cleanupAcceptedUrlResultFile,
  discardPendingUrlResult,
  registerAutoCancel,
  finish as registryFinish,
  registerPendingUrlResult,
} from '../active-processes.js';
import { getMainWindow } from '../utils/window.js';
import { finalizeCancelledUrlOperation } from '../utils/url-operation-finalizers.js';

interface UrlHandlerServices {
  fileManager: FileManager;
  ffmpeg: FFmpegContext;
}

let fileManagerInstance: FileManager | null = null;
let ffmpegCtx: FFmpegContext | null = null;

export function initializeUrlHandler(services: UrlHandlerServices): void {
  if (!services || !services.fileManager || !services.ffmpeg) {
    throw new Error('[url-handler] FileManager and FFmpegContext required.');
  }
  fileManagerInstance = services.fileManager;
  ffmpegCtx = services.ffmpeg;
  log.info('[url-handler] Initialized with FileManager + FFmpegContext.');
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
  _event: IpcMainInvokeEvent,
  options: ProcessUrlOptions
): Promise<ProcessUrlResult> {
  const mainWindow = getMainWindow();
  const operationId = options.operationId || uuidv4();
  log.info(
    `[url-handler] Starting process for URL: ${options.url}, Effective Operation ID used: ${operationId}`
  );

  // Use the specific inline type matching the service's callback definition
  const sendProgress = (progressData: {
    percent: number;
    stage: string;
    error?: string | null;
  }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('url-processing-progress', {
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
    registerAutoCancel(operationId, _event.sender, () => {
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

    registerPendingUrlResult(operationId, _event.sender, result.videoPath);
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
  _event: IpcMainInvokeEvent,
  operationId: string
): Promise<{ success: boolean; error?: string }> {
  if (!String(operationId || '').trim()) {
    return { success: false, error: 'Operation ID is required' };
  }

  const success = acceptPendingUrlResult(operationId);
  if (!success) {
    return {
      success: false,
      error: 'Processed URL result is no longer available',
    };
  }

  return { success: true };
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
