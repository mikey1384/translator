import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';
import {
  extendShortSubtitleGaps,
  fillBlankTranslations,
} from '../post-process.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import {
  cleanupTranslatedCaptions,
  mergeUnrealisticCpsTranslatedSegments,
  enforceReadableTranslatedCaptions,
} from '../utils.js';
import { SUBTITLE_GAP_THRESHOLD } from '../constants.js';
import { Stage, scaleProgress } from './progress.js';
import log from 'electron-log';

export async function finalizePass({
  segments,
  speechIntervals,
  fileManager,
  progressCallback,
  operationId,
  targetLang,
  signal,
}: {
  segments: void | SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  fileManager: FileManager;
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  targetLang: string;
  signal: AbortSignal;
}): Promise<GenerateSubtitlesFullResult> {
  progressCallback?.({
    percent: scaleProgress(0, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Applying final adjustments',
  });

  const indexedSegments = (segments ?? []).map((block, idx) => ({
    ...block,
    index: idx + 1,
    start: Number(block.start),
    end: Number(block.end),
  }));

  extendShortSubtitleGaps({
    segments: indexedSegments,
    threshold: SUBTITLE_GAP_THRESHOLD,
  });

  log.debug(
    `[${operationId}] Segments AFTER IN-PLACE gap fill, BEFORE blank fill (indices 25-27):`,
    indexedSegments.length > 25
      ? JSON.stringify(indexedSegments.slice(25, 28), null, 2)
      : 'Segment count less than 25'
  );

  const totalToClean = indexedSegments.length;
  progressCallback?.({
    percent: scaleProgress(0, Stage.REVIEW, Stage.FINAL),
    stage: `__i18n__:translation_cleanup:0:${totalToClean}`,
  });

  const mergedReviewed = await cleanupTranslatedCaptions({
    segments: indexedSegments,
    operationId,
    signal,
    targetLang,
    onProgress: (done, total) => {
      progressCallback?.({
        percent: scaleProgress(
          (done / Math.max(1, total)) * 100,
          Stage.REVIEW,
          Stage.FINAL
        ),
        stage: `__i18n__:translation_cleanup:${done}:${total}`,
        current: done,
        total,
      });
    },
  });

  const mergedCps = mergeUnrealisticCpsTranslatedSegments(mergedReviewed);
  const readable = enforceReadableTranslatedCaptions(mergedCps);
  const filled = fillBlankTranslations(readable);

  const finalSrtContent = buildSrt({
    segments: filled,
    mode: 'dual',
  });

  await fileManager.writeTempFile(finalSrtContent, '.srt');

  progressCallback?.({
    percent: scaleProgress(100, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Processing complete!',
    partialResult: finalSrtContent,
    current: filled.length,
    total: filled.length,
  });

  return {
    subtitles: finalSrtContent,
    segments: filled,
    speechIntervals: speechIntervals,
  };
}
