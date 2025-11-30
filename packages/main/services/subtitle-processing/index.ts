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
import {
  ERROR_CODES,
  AI_MODEL_DISPLAY_NAMES,
} from '../../../shared/constants/index.js';
import { scaleProgress, Stage } from './pipeline/progress.js';
import { reviewTranslationBatch, getReviewModel } from './translator.js';

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
      qualityTranscription: options?.qualityTranscription ?? false,
    });

    return await finalizePass({
      segments,
      speechIntervals,
      fileManager,
      progressCallback,
    });
  } catch (error: any) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);

    const errorMsg = String(error?.message || '');
    const creditCancel = errorMsg.includes(ERROR_CODES.INSUFFICIENT_CREDITS);
    const isCancel =
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled') ||
      creditCancel ||
      signal.aborted;

    if (isCancel) {
      progressCallback?.({
        percent: 100,
        stage: '__i18n__:process_cancelled',
      });
      log.info(`[${operationId}] Process cancelled by user.`);
    } else {
      progressCallback?.({
        percent: 100,
        stage: '__i18n__:error',
        error: creditCancel
          ? ERROR_CODES.INSUFFICIENT_CREDITS
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

export async function translateSubtitlesFromSrt({
  srtContent,
  targetLanguage,
  operationId,
  signal,
  progressCallback,
  fileManager,
  qualityTranslation,
}: {
  srtContent: string;
  targetLanguage: string;
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
  fileManager: FileManager;
  qualityTranslation?: boolean;
}): Promise<{ subtitles: string }> {
  const segments = parseSrt(srtContent);

  const adaptedProgress: GenerateProgressCallback | undefined = progressCallback
    ? p => {
        const raw = typeof p.percent === 'number' ? p.percent : 0;
        const clamped = Math.max(0, Math.min(100, Math.round(raw)));
        progressCallback?.({ ...p, percent: clamped });
      }
    : undefined;

  const translatedSegments = await translatePass({
    segments,
    targetLang: targetLanguage,
    progressCallback: adaptedProgress ?? progressCallback,
    operationId,
    qualityTranslation: qualityTranslation ?? false,
    signal,
  });

  // Optionally run review pass (skip when target is 'original')
  const reviewedSegments = translatedSegments;
  if (targetLanguage !== 'original' && (qualityTranslation ?? false)) {
    try {
      const total = translatedSegments.length;
      // Review window design:
      // - 30 target lines to review per request
      // - 15 lines of context before and 15 after (not counted toward progress)
      const BATCH = 30; // target lines per review call
      const BEFORE_CTX = 15;
      const AFTER_CTX = 15;
      let done = 0;

      // Determine which model will be used for review and get display name
      const reviewConfig = getReviewModel();
      const reviewModelName =
        AI_MODEL_DISPLAY_NAMES[reviewConfig.model] ?? reviewConfig.model;

      const emitRangeStage = (
        startIndex: number,
        endIndex: number,
        completed: number,
        includePartial: boolean
      ) => {
        if (total === 0) return;
        const safeStartIndex = Math.max(0, Math.min(startIndex, total - 1));
        const safeEndExclusive = Math.max(safeStartIndex + 1, endIndex);
        const displayStart = Math.min(safeStartIndex + 1, total);
        const displayEnd = Math.min(
          Math.max(safeEndExclusive, displayStart),
          total
        );
        const stage = `__i18n__:reviewing_range:${displayStart}:${displayEnd}:${total}`;
        const reviewedRatio =
          total > 0 ? Math.min(Math.max(completed / total, 0), 1) : 0;
        const payload: any = {
          percent: scaleProgress(
            reviewedRatio * 100,
            Stage.TRANSLATE,
            Stage.REVIEW
          ),
          stage,
          current: completed,
          total,
          model: reviewModelName,
        };
        if (includePartial) {
          payload.partialResult = buildSrt({
            segments: reviewedSegments,
            mode: 'dual',
          });
        }
        (adaptedProgress ?? progressCallback)?.(payload);
      };

      if (total > 0) {
        emitRangeStage(0, Math.min(BATCH, total), done, false);
      }

      for (let start = 0; start < total; start += BATCH) {
        const end = Math.min(start + BATCH, total);
        emitRangeStage(start, end, done, false);
        const contextBefore = reviewedSegments.slice(
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
            String(err?.message).includes(ERROR_CODES.INSUFFICIENT_CREDITS)
          ) {
            throw err;
          }
        }
        done += Math.min(BATCH, end - start);
        const nextStart = done;
        const nextEnd = Math.min(done + BATCH, total);
        emitRangeStage(nextStart, nextEnd, done, true);
      }
    } catch {
      // If review fails (network, etc.), continue with translatedSegments
    }
  }

  const finalized = await finalizePass({
    segments: reviewedSegments,
    speechIntervals: [],
    fileManager,
    progressCallback: adaptedProgress ?? progressCallback,
  });

  return { subtitles: finalized.subtitles };
}
