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

  const adaptedProgress: GenerateProgressCallback | undefined =
    progressCallback;

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
      /insufficient-credits|Insufficient credits/i.test(
        String(error?.message || '')
      ) ||
      signal.aborted;
    const creditCancel = /insufficient-credits|Insufficient credits/i.test(
      String(error?.message || '')
    );

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
        error: creditCancel
          ? 'insufficient-credits'
          : !isCancel
            ? error?.message || String(error)
            : undefined,
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

  // Run translation pass
  const translatedSegments = await translatePass({
    segments,
    targetLang: targetLanguage,
    progressCallback: adaptedProgress ?? progressCallback,
    operationId,
    signal,
  });

  // Optionally run review pass (skip when target is 'original')
  const reviewedSegments = translatedSegments;
  if (targetLanguage !== 'original') {
    try {
      // Batch review with light context, mapped to REVIEW..FINAL progress
      const { scaleProgress, Stage } = await import('./pipeline/progress.js');
      const { reviewTranslationBatch } = await import('./translator.js');

      const total = translatedSegments.length;
      // Review window design:
      // - 30 target lines to review per request
      // - 15 lines of context before and 15 after (not counted toward progress)
      const BATCH = 30; // target lines per review call
      const BEFORE_CTX = 15;
      const AFTER_CTX = 15;
      let done = 0;

      // Announce review start before the first batch arrives
      {
        const percent = scaleProgress(0, Stage.REVIEW, Stage.FINAL);
        const stage = 'Beginning review...';
        const partialResult = buildSrt({ segments: reviewedSegments, mode: 'dual' });
        (adaptedProgress ?? progressCallback)?.({
          percent,
          stage,
          partialResult,
          current: done,
          total,
        });
      }

      for (let start = 0; start < total; start += BATCH) {
        const end = Math.min(start + BATCH, total);
        const contextBefore = translatedSegments.slice(
          Math.max(0, start - BEFORE_CTX),
          start
        );
        const contextAfter = translatedSegments.slice(
          end,
          Math.min(end + AFTER_CTX, total)
        );
        const batch = {
          segments: translatedSegments.slice(start, end),
          startIndex: start,
          endIndex: end,
          targetLang: targetLanguage,
          contextBefore,
          contextAfter,
        } as any;

        if (signal?.aborted)
          throw new DOMException('Operation cancelled', 'AbortError');

        try {
          const reviewed = await reviewTranslationBatch({
            batch,
            operationId,
            signal,
          });
          // splice results back in place
          for (let i = 0; i < reviewed.length; i++) {
            reviewedSegments[start + i] = reviewed[i];
          }
        } catch (err: any) {
          if (
            err?.name === 'AbortError' ||
            String(err?.message).includes('insufficient-credits')
          ) {
            throw err;
          }
          // Otherwise, keep original translated segs for this batch
        }
        // Progress after this sequential batch
        done += Math.min(BATCH, end - start);
        const pctLocal = Math.round((done / total) * 100);
        const percent = scaleProgress(pctLocal, Stage.REVIEW, Stage.FINAL);
        const stage = `Reviewing ${done}/${total}`;
        const partialResult = buildSrt({
          segments: reviewedSegments,
          mode: 'dual',
        });
        (adaptedProgress ?? progressCallback)?.({
          percent,
          stage,
          partialResult,
          current: done,
          total,
        });
      }
    } catch {
      // If review fails (network, etc.), continue with translatedSegments
    }
  }

  const out = buildSrt({ segments: reviewedSegments, mode: 'dual' });
  return { subtitles: out };
}
