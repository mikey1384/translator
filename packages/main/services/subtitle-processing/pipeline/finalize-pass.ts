import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';
import { extendShortSubtitleGaps } from '../post-process.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { SUBTITLE_GAP_THRESHOLD } from '../constants.js';
import { Stage, scaleProgress } from './progress.js';
import log from 'electron-log';

export async function finalizePass({
  segments,
  speechIntervals,
  fileManager,
  progressCallback,
  operationId,
}: {
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  fileManager: FileManager;
  progressCallback?: GenerateProgressCallback;
  operationId: string;
}): Promise<GenerateSubtitlesFullResult> {
  progressCallback?.({
    percent: scaleProgress(0, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Applying final adjustments',
  });

  const indexedSegments = segments.map((block, idx) => ({
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

  const finalSrtContent = buildSrt({
    segments: indexedSegments,
    mode: 'dual',
  });

  await fileManager.writeTempFile(finalSrtContent, '.srt');

  progressCallback?.({
    percent: scaleProgress(100, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Processing complete!',
    partialResult: finalSrtContent,
    current: indexedSegments.length,
    total: indexedSegments.length,
  });

  return {
    subtitles: finalSrtContent,
    segments: indexedSegments,
    speechIntervals: speechIntervals,
  };
}
