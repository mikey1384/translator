import { IpcMainInvokeEvent } from 'electron';
import { processVideoUrl } from '../services/url-processor/index.js';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { FileManager } from '../services/file-manager.js';
import type { FFmpegContext } from '../services/ffmpeg-runner.js';
import { CancelledError } from '../../shared/cancelled-error.js';
import { ProcessUrlOptions } from '@shared-types/app';
import {
  registerAutoCancel,
  registerDownloadProcess,
  finish as registryFinish,
  hasProcess,
  cancelSafely,
} from '../active-processes.js';
import { forceKillWindows } from '../utils/process-killer.js';
import { getMainWindow } from '../utils/window.js';

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

interface ProcessUrlResult {
  success: boolean;
  message?: string;
  filePath?: string;
  videoId?: string;
  title?: string;
  duration?: number;
  filename?: string;
  size?: number;
  fileUrl?: string;
  originalVideoPath?: string;
  error?: string;
  operationId: string;
  cancelled?: boolean;
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

    // Track early cancellation
    let cancelledEarly = false;

    // Register auto-cancel early with a placeholder cancel function that attempts cancellation
    registerAutoCancel(operationId, _event.sender, () => {
      cancelledEarly = true;
      cancelSafely(operationId);
      log.info(`[url-handler] Early cancel triggered for ${operationId}`);
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
      options.useCookies || false,
      options.cookiesBrowser
    );

    // Check if cancellation was requested early before proceeding
    if (cancelledEarly) {
      if (!result.proc.killed) {
        if (process.platform === 'win32' && result.proc.pid) {
          // On Windows, use taskkill for reliable yt-dlp termination
          log.info(
            `[url-handler] Force-killing Windows yt-dlp process PID: ${result.proc.pid} for early cancelled ${operationId}`
          );
          forceKillWindows({
            pid: result.proc.pid,
            logPrefix: `url-handler-early-${operationId}`,
          })
            .then(killed => {
              if (!killed) {
                // Fallback to signal if taskkill fails
                log.warn(
                  `[url-handler] taskkill failed for early cancel ${operationId}, trying SIGTERM fallback`
                );
                try {
                  result.proc.kill('SIGTERM');
                } catch {
                  // Ignore errors since process might already be dead
                }
              }
            })
            .catch(() => {
              // Fallback to signal if taskkill throws
              try {
                result.proc.kill('SIGTERM');
              } catch {
                // Ignore errors since process might already be dead
              }
            });
        } else {
          // Non-Windows: use regular SIGINT
          result.proc.kill('SIGINT');
        }
        log.info(
          `[url-handler] Late kill of process for early cancelled ${operationId}`
        );
      }
      registryFinish(operationId); // Clean up the entry
      sendProgress({
        percent: 0,
        stage: 'Cancelled',
        error: 'Cancelled by reload',
      });
      return {
        success: false,
        cancelled: true,
        operationId,
      };
    }

    // Manual cancel (Stop button)
    if (!hasProcess(operationId)) {
      registerDownloadProcess(operationId, result.proc);
    }

    const successResult: ProcessUrlResult = {
      success: true,
      filePath: result.videoPath,
      filename: result.filename,
      size: result.size,
      fileUrl: result.fileUrl,
      originalVideoPath: result.originalVideoPath,
      operationId,
    };
    sendProgress({ percent: 100, stage: 'Completed' });
    registryFinish(operationId);
    return successResult;
  } catch (error: any) {
    if (error instanceof CancelledError) {
      registryFinish(operationId);
      return {
        success: false,
        cancelled: true,
        operationId,
      };
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
      registryFinish(operationId);
      return { success: false, error: 'NeedCookies', operationId };
    }

    // Generic error fallback
    sendProgress({ percent: 0, stage: 'Error', error: userFriendlyMessage });

    registryFinish(operationId);
    return {
      success: false,
      error: userFriendlyMessage,
      operationId,
    };
  }
}
