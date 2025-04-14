import path from 'path';
import fs from 'fs/promises';
import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { FFmpegService } from '../services/ffmpeg-service.js';
import { FileManager } from '../services/file-manager.js';
import {
  mergeSubtitlesWithVideo,
  extractSubtitlesFromVideo,
} from '../services/subtitle-processing.js';
import {
  GenerateSubtitlesOptions,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
} from '../types/interface.js';

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

export async function handleGenerateSubtitles(
  event: IpcMainInvokeEvent,
  options: GenerateSubtitlesOptions,
  signal: AbortSignal,
  operationId: string
): Promise<{
  success: boolean;
  subtitles?: string;
  cancelled?: boolean;
  error?: string;
  operationId: string;
}> {
  const { ffmpegService, fileManager } = checkServicesInitialized();

  log.info(`[handleGenerateSubtitles] Starting. Operation ID: ${operationId}`);

  let tempVideoPath: string | null = null;
  const finalOptions = { ...options };

  try {
    // -------------------- STEP 1: PREPARE VIDEO PATH --------------------
    tempVideoPath = await maybeWriteTempVideo({
      finalOptions,
      ffmpegService,
    });
    if (!finalOptions.videoPath) {
      throw new Error('Video path is required');
    }
    finalOptions.videoPath = path.normalize(finalOptions.videoPath);
    await fs.access(finalOptions.videoPath);

    // -------------------- STEP 2: PROGRESS CALLBACK --------------------
    const progressCallback: GenerateProgressCallback = progress => {
      event.sender.send('generate-subtitles-progress', {
        ...progress,
        operationId,
      });
    };

    // -------------------- STEP 3: GENERATE SUBTITLES --------------------
    const result = await extractSubtitlesFromVideo({
      options: finalOptions,
      operationId,
      signal,
      progressCallback,
      services: { ffmpegService, fileManager },
    });

    // Attempt to remove temp file if created
    await cleanupTempFile(tempVideoPath);

    log.info('--------------------------------');
    log.info('result/testtesttest', result);
    log.info('--------------------------------');

    return { success: true, subtitles: result.subtitles, operationId };
  } catch (error: any) {
    // -------------------- STEP 4: ERROR HANDLING --------------------
    log.error(`[${operationId}] Error generating subtitles:`, error);

    const isCancel =
      error.name === 'AbortError' ||
      error.message === 'Operation cancelled' ||
      signal.aborted;
    if (tempVideoPath && !isCancel) {
      await cleanupTempFile(tempVideoPath);
    }

    // Notify renderer of final state
    event.sender.send('generate-subtitles-progress', {
      percent: 100,
      stage: isCancel ? 'Generation cancelled' : `Error: ${error.message}`,
      error: isCancel ? null : error.message || String(error),
      cancelled: isCancel,
      operationId,
    });
    return {
      success: !isCancel,
      cancelled: isCancel,
      error: isCancel ? null : error.message || String(error),
      operationId,
    };
  }

  async function maybeWriteTempVideo({
    finalOptions,
    ffmpegService,
  }: {
    finalOptions: GenerateSubtitlesOptions;
    ffmpegService: FFmpegService;
  }): Promise<string | null> {
    if (finalOptions.videoFile) {
      const safeName = finalOptions.videoFile.name.replace(
        /[^a-zA-Z0-9_.-]/g,
        '_'
      );
      const tempVideoPath = path.join(
        ffmpegService.getTempDir(),
        `temp_generate_${Date.now()}_${safeName}`
      );

      const buffer = Buffer.from(await finalOptions.videoFile.arrayBuffer());
      await fs.writeFile(tempVideoPath, buffer);

      finalOptions.videoPath = tempVideoPath;
      delete finalOptions.videoFile;

      return tempVideoPath;
    }
    return null;
  }

  async function cleanupTempFile(tempVideoPath: string | null) {
    if (!tempVideoPath) return;
    try {
      await fs.unlink(tempVideoPath);
    } catch (err) {
      log.warn(`Failed to delete temp video file: ${tempVideoPath}`, err);
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

    if (!finalOptions.videoPath) {
      log.info('--------------------------------');
      log.info('handleMergeSubtitles/testtesttest', finalOptions);
      log.info('--------------------------------');
      throw new Error('Video path is required for merge.');
    }

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

export const VIDEO_METADATA_CHANNEL = 'get-video-metadata';

export async function handleGetVideoMetadata(_event: any, filePath: string) {
  if (!ffmpegServiceInstance) {
    log.error('[getVideoMetadata] FFmpegService not initialized.');
    return { success: false, error: 'FFmpegService not available.' };
  }
  try {
    const metadata = await ffmpegServiceInstance.getVideoMetadata(filePath);
    return { success: true, metadata };
  } catch (error: any) {
    log.error(
      `[getVideoMetadata] Error getting metadata for ${filePath}:`,
      error
    );
    return {
      success: false,
      error: error.message || 'Failed to get video metadata.',
    };
  }
}
