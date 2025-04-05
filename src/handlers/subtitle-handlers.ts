import path from 'path';
import fs from 'fs/promises';
import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { FFmpegService } from '../services/ffmpeg-service.js';
import { FileManager } from '../services/file-manager.js';
import {
  generateSubtitlesFromVideo,
  mergeSubtitlesWithVideo,
} from '../services/subtitle-processing.js';
import {
  GenerateSubtitlesOptions,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
} from '../types/interface.js';
import { cancellationService } from '../services/cancellation-service.js';

// Define the services structure expected by the initializer
interface SubtitleHandlerServices {
  ffmpegService: FFmpegService;
  fileManager: FileManager;
  // cancellationService is imported directly as a singleton
}

// Module-level variables to hold initialized services
let ffmpegServiceInstance: FFmpegService | null = null;
let fileManagerInstance: FileManager | null = null;

// --- Initialization ---
export function initializeSubtitleHandlers(
  services: SubtitleHandlerServices
): void {
  if (!services || !services.ffmpegService || !services.fileManager) {
    throw new Error(
      '[subtitle-handlers] Required services (ffmpegService, fileManager) not provided.'
    );
  }
  ffmpegServiceInstance = services.ffmpegService;
  fileManagerInstance = services.fileManager;

  // Log that cancellation service is available via import
  if (cancellationService) {
    log.info(
      '[src/handlers/subtitle-handlers.ts] CancellationService is available via import.'
    );
  } else {
    // This case should ideally not happen if the import worked
    log.warn(
      '[src/handlers/subtitle-handlers.ts] CancellationService singleton instance not found!'
    );
  }

  log.info('[src/handlers/subtitle-handlers.ts] Initialized!');
}

// Helper function to check if services are initialized
function checkServicesInitialized(): {
  ffmpegService: FFmpegService;
  fileManager: FileManager;
} {
  if (!ffmpegServiceInstance || !fileManagerInstance) {
    throw new Error('[subtitle-handlers] Services not initialized before use.');
  }
  return {
    ffmpegService: ffmpegServiceInstance,
    fileManager: fileManagerInstance,
  };
}

// Define progress callback types for clarity
type GenerateProgressCallback = (progress: {
  percent: number;
  stage: string;
  current?: number;
  total?: number;
  partialResult?: string;
  error?: string;
  batchStartIndex?: number;
}) => void;

type MergeProgressCallback = (progress: {
  percent: number;
  stage: string;
}) => void;

export async function handleGenerateSubtitles(
  event: IpcMainInvokeEvent,
  options: GenerateSubtitlesOptions
): Promise<{
  success: boolean;
  subtitles?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpegService, fileManager } = checkServicesInitialized();
  const controller = new AbortController();
  const { signal } = controller;
  const operationId = `generate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  log.info(`[handleGenerateSubtitles] Operation ID: ${operationId}`);

  cancellationService.registerOperation(operationId, controller);

  let tempVideoPath: string | null = null;
  const finalOptions = { ...options };

  try {
    if (
      'videoFileData' in finalOptions &&
      'videoFileName' in finalOptions &&
      finalOptions.videoFileData
    ) {
      const safeFileName = (finalOptions.videoFileName as string).replace(
        /[^a-zA-Z0-9_.-]/g,
        '_'
      );
      tempVideoPath = path.join(
        ffmpegService.getTempDir(),
        `temp_generate_${Date.now()}_${safeFileName}`
      );
      const buffer = Buffer.from(finalOptions.videoFileData as ArrayBuffer);
      await fs.writeFile(tempVideoPath, buffer);
      finalOptions.videoPath = tempVideoPath;
      delete finalOptions.videoFileData;
      delete finalOptions.videoFileName;
    }

    if (!finalOptions.videoPath) {
      throw new Error('Video path is required');
    }
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.access(finalOptions.videoPath, fs.constants.R_OK);

    const progressCallback: GenerateProgressCallback = progress => {
      event.sender.send('generate-subtitles-progress', {
        ...progress,
        operationId,
      });
    };

    const result = await generateSubtitlesFromVideo({
      options: finalOptions,
      operationId: operationId,
      signal: signal,
      progressCallback: progressCallback,
      services: { ffmpegService, fileManager },
    });

    if (result.subtitles === '') {
      log.info(`[${operationId}] Generation was cancelled.`);
      return { success: true, cancelled: true, operationId };
    }

    return { success: true, subtitles: result.subtitles, operationId };
  } catch (error: any) {
    log.error(`[${operationId}] Error generating subtitles:`, error);
    const isCancellationError =
      error.name === 'AbortError' || error.message === 'Operation cancelled';
    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: isCancellationError
        ? 'Generation cancelled'
        : `Error: ${error.message || 'Unknown error'}`,
      error: isCancellationError ? null : error.message || String(error),
      cancelled: isCancellationError,
      operationId,
    });
    return {
      success: !isCancellationError,
      cancelled: isCancellationError,
      error: isCancellationError ? null : error.message || String(error),
      operationId,
    };
  } finally {
    cancellationService.unregisterOperation(operationId);
    if (tempVideoPath) {
      try {
        await fs.unlink(tempVideoPath);
      } catch (err) {
        log.warn(`Failed to delete temp video file: ${tempVideoPath}`, err);
      }
    }
  }
}

export async function handleMergeSubtitles(
  event: IpcMainInvokeEvent,
  options: MergeSubtitlesOptions & { operationId?: string } // Allow optional operationId
): Promise<MergeSubtitlesResult> {
  log.info(
    `[handleMergeSubtitles] Function entered. OpID Hint: ${options?.operationId || 'N/A'}`
  );
  log.info(`[handleMergeSubtitles] Checking services...`);
  const { ffmpegService } = checkServicesInitialized();
  log.info(`[handleMergeSubtitles] Services checked successfully.`);

  const operationId =
    options.operationId ||
    `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  log.info(`[handleMergeSubtitles] Started. Operation ID: ${operationId}`);

  const controller = new AbortController();
  cancellationService.registerOperation(operationId, controller);

  // Get fileManager to determine the correct temp dir
  const { fileManager } = checkServicesInitialized();
  const tempDir = fileManager.getTempDir();

  let tempVideoPath: string | undefined;
  let tempSrtPath: string | null = null;
  const finalOptions = { ...options, operationId };

  try {
    // Defensive check: If both path and data are somehow present, log warn and prioritize path.
    if (finalOptions.videoPath && finalOptions.videoFileData) {
      log.warn(
        `[${operationId}] handleMergeSubtitles received BOTH videoPath and videoFileData! Prioritizing videoPath and removing file data properties.`
      );
      delete finalOptions.videoFileData;
      delete finalOptions.videoFileName; // Also delete filename
    }

    if (
      'videoFileData' in finalOptions &&
      'videoFileName' in finalOptions &&
      finalOptions.videoFileData
    ) {
      // This block should ONLY run if the video came from a URL (no initial videoPath)
      log.warn(
        `[${operationId}] Entering block to process videoFileData. This should NOT happen if videoPath was provided initially. Options keys: ${JSON.stringify(Object.keys(finalOptions))}`
      );
      const videoExtension = path.extname(finalOptions.videoFileName || '.mp4');
      tempVideoPath = path.join(
        await fileManager.getTempDir(),
        `temp_merge_video_${operationId}_${finalOptions.videoFileName || `file${videoExtension}`}`
      );
      const buffer = Buffer.from(finalOptions.videoFileData as ArrayBuffer);
      await fs.writeFile(tempVideoPath, buffer);
      finalOptions.videoPath = tempVideoPath;
      delete finalOptions.videoFileData;
      delete finalOptions.videoFileName;
      log.info(
        `[${operationId}] Temporary video file written to: ${tempVideoPath}`
      );
    } else {
      log.info(`[${operationId}] No temporary video file needed.`);
    }

    if (!finalOptions.videoPath)
      throw new Error('Video path is required for merge.');
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.access(finalOptions.videoPath, fs.constants.R_OK);

    if (
      !finalOptions.srtContent ||
      typeof finalOptions.srtContent !== 'string'
    ) {
      throw new Error('SRT content (string) is required for merge.');
    }
    const tempSrtFilename = `temp_merge_subtitles_${operationId}.srt`;

    // Ensure the temp directory exists before writing to it
    await fileManager.ensureTempDir();

    // Use tempDir obtained from FileManager
    tempSrtPath = path.join(tempDir, tempSrtFilename);
    await fs.writeFile(tempSrtPath, finalOptions.srtContent, 'utf8');
    log.info(`[${operationId}] Temporary SRT file written to: ${tempSrtPath}`);

    // Log before calling the core merge function
    log.info(
      `[${operationId}] Preparing to call mergeSubtitlesWithVideo with video: ${finalOptions.videoPath}, srt: ${tempSrtPath}`
    );

    if (cancellationService.getSignal(operationId)?.aborted) {
      log.info(`[${operationId}] Operation cancelled before merge started`);
      event.sender.send('merge-subtitles-progress', {
        percent: 100,
        stage: 'Merge cancelled',
        cancelled: true,
        operationId,
      });
      return { success: true, cancelled: true, operationId };
    }

    const progressCallback: MergeProgressCallback = progress => {
      event.sender.send('merge-subtitles-progress', {
        ...progress,
        operationId,
      });
    };

    const mergeResult = await mergeSubtitlesWithVideo({
      options: {
        videoPath: finalOptions.videoPath,
        subtitlesPath: tempSrtPath,
        fontSize: finalOptions.fontSize,
        stylePreset: finalOptions.stylePreset,
      },
      operationId,
      services: { ffmpegService },
      progressCallback,
    });

    if (!mergeResult.outputPath) {
      log.info(
        `[${operationId}] Merge was cancelled, sending success with cancelled status`
      );
      event.sender.send('merge-subtitles-progress', {
        percent: 100,
        stage: 'Merge cancelled',
        cancelled: true,
        operationId,
      });
      return { success: true, cancelled: true, operationId };
    }

    if (cancellationService.getSignal(operationId)?.aborted) {
      log.info(`[${operationId}] Operation cancelled after merge completed`);
      if (mergeResult.outputPath) {
        try {
          await fs.unlink(mergeResult.outputPath);
          log.info(`Deleted cancelled merge output: ${mergeResult.outputPath}`);
        } catch (e) {
          log.warn('Failed to delete cancelled merge output', e);
        }
      }
      return { success: true, cancelled: true, operationId };
    }

    log.info(
      `[${operationId}] Merge successful. Output path: ${mergeResult.outputPath}`
    );
    return { success: true, outputPath: mergeResult.outputPath, operationId };
  } catch (error: any) {
    log.error(`[${operationId}] RAW ERROR in handleMergeSubtitles:`, error);
    log.error(`[${operationId}] Original Error Name: ${error?.name}`);
    log.error(`[${operationId}] Original Error Stack: ${error?.stack}`);
    const isCancellationError =
      error.name === 'AbortError' ||
      error.message === 'Operation cancelled' ||
      error.message.includes('cancelled');
    event.sender.send('merge-subtitles-progress', {
      percent: 100,
      stage: isCancellationError
        ? 'Merge cancelled'
        : `Error: ${error.message || 'Unknown merge error'}`,
      error: isCancellationError
        ? null
        : error.message || 'Unknown merge error',
      cancelled: isCancellationError,
      operationId,
    });
    return {
      success: !isCancellationError,
      cancelled: isCancellationError,
      error: isCancellationError ? null : error.message || String(error),
      operationId,
    };
  } finally {
    cancellationService.unregisterOperation(operationId);
    for (const tempFile of [tempVideoPath, tempSrtPath]) {
      if (tempFile) {
        try {
          await fs.unlink(tempFile);
          log.info(`[${operationId}] Cleaned up temp file: ${tempFile}`);
        } catch (cleanupError) {
          log.warn(`Cleanup failed for ${tempFile}:`, cleanupError);
        }
      }
    }
  }
}

export async function handleCancelOperation(
  event: IpcMainInvokeEvent | null, // Make event optional
  operationId: string
): Promise<{ success: boolean; error?: string }> {
  if (!operationId) {
    return { success: false, error: 'Operation ID is required to cancel.' };
  }
  log.info(`[Handlers] Received cancellation request for ${operationId}`);

  try {
    let cancelled = false;
    if (cancellationService.hasActiveOperation(operationId)) {
      log.info(`[Handlers] Using cancellationService for ${operationId}`);
      cancelled = cancellationService.cancelOperation(operationId);
    } else {
      log.info(
        `[Handlers] No active operation found in cancellationService for ${operationId}`
      );
      // Optionally check ffmpegService directly as a fallback if needed
      if (operationId.startsWith('merge-') && ffmpegServiceInstance) {
        log.info(`[Handlers] Falling back to FFmpegService for ${operationId}`);
        cancelled = ffmpegServiceInstance.cancelOperation(operationId);
      }
    }

    if (cancelled) {
      log.info(
        `[Handlers] Cancellation request processed successfully for ${operationId}.`
      );
      if (event?.sender) {
        const sender = event.sender;
        // Determine progress channel based on operationId prefix
        let channel = '';
        let stage = '';
        if (operationId.startsWith('merge-')) {
          channel = 'merge-subtitles-progress';
          stage = 'Merge cancelled';
        } else if (operationId.startsWith('generate-')) {
          channel = 'generate-subtitles-progress';
          stage = 'Generation cancelled';
        }

        if (channel) {
          sender.send(channel, {
            percent: 100,
            stage,
            cancelled: true,
            operationId,
          });
        }
      }
    } else {
      log.warn(
        `[Handlers] No active operation found or cancellation failed for ${operationId}.`
      );
    }

    return { success: true }; // Return success even if not found, as the goal is fulfilled
  } catch (error: any) {
    log.error(
      `[Handlers] Error during handleCancelOperation for ${operationId}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to cancel operation',
    };
  }
}
