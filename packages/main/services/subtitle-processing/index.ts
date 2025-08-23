import {
  GenerateSubtitlesOptions,
  GenerateProgressCallback,
} from '@shared-types/app';
import log from 'electron-log';
import { FileManager } from '../file-manager.js';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import { GenerateSubtitlesFullResult } from './types.js';
import { SubtitleProcessingError } from './errors.js';
import { prepareAudio } from './pipeline/prepare-audio.js';
import { transcribePass } from './pipeline/transcribe-pass.js';
import { translatePass } from './pipeline/translate-pass.js';
import { finalizePass } from './pipeline/finalize-pass.js';

export async function extractSubtitlesFromMedia({
  options,
  operationId,
  signal,
  progressCallback,
  services,
}: {
  options: GenerateSubtitlesOptions;
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
  services: {
    fileManager: FileManager;
    ffmpeg: FFmpegContext;
  };
}): Promise<GenerateSubtitlesFullResult> {
  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!services?.fileManager) {
    log.error('[subtitle-processing] Required services were not provided.');
    throw new SubtitleProcessingError(
      'Required services (fileManager) were not provided.'
    );
  }

  const { ffmpeg, fileManager } = services;
  const targetLang = options.targetLanguage.toLowerCase();

  let audioPath: string | null = null;

  try {
    const { audioPath: extractedAudioPath } = await prepareAudio({
      videoPath: options.videoPath,
      services: { ffmpeg },
      progressCallback,
      operationId,
      signal,
    });
    audioPath = extractedAudioPath;

    const { segments, speechIntervals } = await transcribePass({
      audioPath: audioPath,
      services: { ffmpeg },
      progressCallback,
      operationId,
      signal,
    });

    const translatedSegments = await translatePass({
      segments,
      targetLang,
      progressCallback,
      operationId,
      signal,
    });

    return await finalizePass({
      segments: translatedSegments,
      speechIntervals,
      fileManager,
      progressCallback,
      operationId,
    });
  } catch (error: any) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);

    const isCancel =
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled') ||
      signal.aborted;

    if (isCancel) {
      progressCallback?.({
        percent: 100,
        stage: 'Process cancelled',
      });
      log.info(`[${operationId}] Process cancelled by user.`);
    } else {
      progressCallback?.({
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: !isCancel ? error?.message || String(error) : undefined,
      });
    }

    throw error;
  } finally {
    if (audioPath) {
      try {
        await fileManager.deleteFile(audioPath);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary audio file ${audioPath}:`,
          cleanupError
        );
      }
    }
  }
}
