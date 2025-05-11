import { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { processVideoUrl } from '../services/url-processor/index.js';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { FileManager } from '../services/file-manager.js';
import { FFmpegService } from '../services/ffmpeg-service.js';
import { CancelledError } from '../../shared/cancelled-error.js';
import { ProcessUrlOptions } from '@shared-types/app';
import {
  registerAutoCancel,
  registerDownloadProcess,
  finish as registryFinish,
  hasProcess,
  cancelSafely,
} from '../active-processes.js';

interface UrlHandlerServices {
  fileManager: FileManager;
  ffmpegService: FFmpegService;
}

let fileManagerInstance: FileManager | null = null;
let ffmpegServiceInstance: FFmpegService | null = null;

export function initializeUrlHandler(services: UrlHandlerServices): void {
  if (!services || !services.fileManager || !services.ffmpegService) {
    throw new Error(
      '[url-handler] FileManager and FFmpegService services not provided.'
    );
  }
  fileManagerInstance = services.fileManager;
  ffmpegServiceInstance = services.ffmpegService;
  log.info(
    '[url-handler] Initialized with FileManager and FFmpegService (v2).'
  );
}

function checkServicesInitialized(): {
  fileManager: FileManager;
  ffmpegService: FFmpegService;
} {
  if (!fileManagerInstance || !ffmpegServiceInstance) {
    throw new Error('[url-handler] Services not initialized (v2).');
  }
  return {
    fileManager: fileManagerInstance,
    ffmpegService: ffmpegServiceInstance,
  };
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
  log.error('[url-handler] HANDLER FUNCTION CALLED');
  log.warn('[url-handler] Processing URL request');
  log.error(`[url-handler] URL TO DOWNLOAD: ${options.url}`);
  log.error(
    `[url-handler] Received options.operationId: ${options.operationId} (Type: ${typeof options.operationId})`
  );
  log.info('useCookies:', options.useCookies || false);

  const mainWindow = BrowserWindow.getAllWindows()[0];
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

    log.info(
      `[url-handler] Calling processVideoUrl for Operation ID: ${operationId}`
    );

    const { fileManager, ffmpegService } = checkServicesInitialized();

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
        ffmpegService,
      },
      options.useCookies || false
    );

    // Check if cancellation was requested early before proceeding
    if (cancelledEarly) {
      if (!result.proc.killed) {
        const sig = process.platform === 'win32' ? 'SIGINT' : 'SIGTERM';
        result.proc.kill(sig);
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

    log.info(
      `[url-handler] processVideoUrl completed successfully for Operation ID: ${operationId}`
    );

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

    log.info(
      `[url-handler] processVideoUrl returned: ${JSON.stringify(result)}`
    );

    registryFinish(operationId);
    return successResult;
  } catch (error: any) {
    if (error instanceof CancelledError) {
      log.info(
        `[url-handler] Download was cancelled by user (Op ID: ${operationId})`
      );
      registryFinish(operationId); // tidy up
      return {
        success: false,
        cancelled: true,
        operationId,
      };
    }

    log.error(
      `[url-handler] Error processing URL for Op ID ${operationId}:`,
      error
    );

    log.error(`[url-handler] Error type: ${typeof error}`);
    log.error(`[url-handler] Error message: ${error.message || 'No message'}`);
    log.error(`[url-handler] Error stack: ${error.stack || 'No stack'}`);

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
      error.message ||
      (typeof error === 'string' ? error : 'An unknown error occurred');

    sendProgress({
      percent: 0,
      stage: 'Error',
      error: 'Download failed...',
    });

    registryFinish(operationId); // tidy up
    return {
      success: false,
      error: `Download failed: ${rawErrorMessage}.`,
      operationId,
    };
  }
}
