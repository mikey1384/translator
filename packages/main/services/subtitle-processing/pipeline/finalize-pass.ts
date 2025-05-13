import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';
import {
  extendShortSubtitleGaps,
  fillBlankTranslations,
  enforceMinDuration,
  fuseOrphans,
} from '../post-process.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import log from 'electron-log';
import crypto from 'crypto';
import { SUBTITLE_GAP_THRESHOLD, GAP_SEC } from '../constants.js';
import { Stage, scaleProgress } from './progress.js';

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

  log.debug(
    `[${operationId}] Segments BEFORE calling extendShortSubtitleGaps (indices 25-27):`,
    indexedSegments.length > 25
      ? JSON.stringify(indexedSegments.slice(25, 28), null, 2)
      : 'Segment count less than 25'
  );

  const orphanFused = fuseOrphans(indexedSegments);
  extendShortSubtitleGaps({
    segments: orphanFused,
    threshold: SUBTITLE_GAP_THRESHOLD,
  });

  log.debug(
    `[${operationId}] Segments AFTER IN-PLACE gap fill, BEFORE blank fill (indices 25-27):`,
    orphanFused.length > 25
      ? JSON.stringify(orphanFused.slice(25, 28), null, 2)
      : 'Segment count less than 25'
  );

  const filled = fillBlankTranslations(orphanFused);
  const finalSegments = enforceMinDuration(filled);

  log.debug(
    `[${operationId}] Segments BEFORE buildSrt (indices 25-27):`,
    finalSegments.length > 25
      ? JSON.stringify(finalSegments.slice(25, 28), null, 2)
      : 'Segment count less than 25'
  );

  finalSegments.sort((a, b) => a.start - b.start);
  const anchors: SrtSegment[] = [];
  let tmpIdx = 0;
  for (let i = 1; i < finalSegments.length; i++) {
    const gap = finalSegments[i].start - finalSegments[i - 1].end;
    if (gap > GAP_SEC) {
      anchors.push({
        id: crypto.randomUUID(),
        index: ++tmpIdx,
        start: finalSegments[i - 1].end,
        end: finalSegments[i - 1].end + 0.5,
        original: '',
      });
    }
  }
  finalSegments.push(...anchors);
  finalSegments.sort((a, b) => a.start - b.start);

  const reIndexed = finalSegments.map((seg, i) => ({
    ...seg,
    index: i + 1,
  }));

  const finalSrtContent = buildSrt({
    segments: reIndexed,
    mode: 'dual',
  });

  await fileManager.writeTempFile(finalSrtContent, '.srt');
  log.info(
    `[${operationId}] FINAL SRT CONTENT being returned:\n${finalSrtContent}`
  );

  progressCallback?.({
    percent: scaleProgress(100, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Processing complete!',
    partialResult: finalSrtContent,
    current: finalSegments.length,
    total: finalSegments.length,
  });

  return {
    subtitles: finalSrtContent,
    segments: reIndexed,
    speechIntervals: speechIntervals,
  };
}
