import path from 'path';
import fs from 'fs/promises';
import { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log';
import { FFmpegService } from '../services/ffmpeg-service.js';
import { FileManager } from '../services/file-manager.js';
import { extractSubtitlesFromVideo } from '../services/subtitle-processing.js';
import { GenerateSubtitlesOptions } from '../types/interface.js';

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

    await cleanupTempFile(tempVideoPath);

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
