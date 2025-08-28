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
import { parseSrt } from '../../../shared/helpers/index.js';
import { buildSrt } from '../../../shared/helpers/index.js';
import { Stage } from './pipeline/progress.js';

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
  const transcribeOnly = targetLang === 'original';

  // Progress adapter so that, when running transcription-only, the progress bar spans 0..100 for transcription phase
  const adaptedProgress: GenerateProgressCallback | undefined = progressCallback
    ? p => {
        if (!transcribeOnly) {
          return progressCallback?.(p);
        }
        let mapped = p.percent ?? 0;
        if (mapped <= Stage.TRANSCRIBE) {
          mapped = 0;
        } else if (mapped < Stage.TRANSLATE) {
          mapped = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((mapped - Stage.TRANSCRIBE) /
                  (Stage.TRANSLATE - Stage.TRANSCRIBE)) *
                  100
              )
            )
          );
        } else {
          mapped = 100;
        }
        progressCallback?.({ ...p, percent: mapped });
      }
    : undefined;

  let audioPath: string | null = null;

  try {
    const { audioPath: extractedAudioPath } = await prepareAudio({
      videoPath: options.videoPath,
      services: { ffmpeg },
      progressCallback: adaptedProgress ?? progressCallback,
      operationId,
      signal,
    });
    audioPath = extractedAudioPath;

    const { segments, speechIntervals } = await transcribePass({
      audioPath: audioPath,
      services: { ffmpeg },
      progressCallback: adaptedProgress ?? progressCallback,
      operationId,
      signal,
    });

    // Always finalize using the segments produced by transcription/gap-repair.
    // Translation is handled separately via translateSubtitlesFromSrt.
    return await finalizePass({
      segments,
      speechIntervals,
      fileManager,
      progressCallback,
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

/**
 * Translates an existing SRT (provided as string) into the target language, using the
 * same translate pipeline used during end-to-end generation. Returns the translated
 * SRT content (dual mode by default so original + translation are preserved for UI).
 */
export async function translateSubtitlesFromSrt({
  srtContent,
  targetLanguage,
  operationId,
  signal,
  progressCallback,
}: {
  srtContent: string;
  targetLanguage: string;
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
}): Promise<{ subtitles: string }> {
  // Parse provided SRT into segments
  const segments = parseSrt(srtContent);

  // When running translation as a standalone pipeline, the underlying translate pass
  // reports progress on the multi-stage scale (TRANSLATE..FINAL). Remap that to 0..100.
  const adaptedProgress: GenerateProgressCallback | undefined = progressCallback
    ? p => {
        let mapped = p.percent ?? 0;
        if (mapped <= Stage.TRANSLATE) {
          mapped = 0;
        } else if (mapped < Stage.FINAL) {
          mapped = Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((mapped - Stage.TRANSLATE) / (Stage.FINAL - Stage.TRANSLATE)) *
                  100
              )
            )
          );
        } else {
          mapped = 100;
        }
        progressCallback?.({ ...p, percent: mapped });
      }
    : undefined;

  // Run translation-only pass
  const translatedSegments = await translatePass({
    segments,
    targetLang: targetLanguage,
    progressCallback: adaptedProgress ?? progressCallback,
    operationId,
    signal,
  });

  // Build final SRT (dual mode keeps original + translation)
  const out = buildSrt({ segments: translatedSegments, mode: 'dual' });
  return { subtitles: out };
}
