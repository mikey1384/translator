import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';

import { buildSrt } from '../../../../shared/helpers/index.js';
import { Stage, scaleProgress } from './progress.js';

export async function finalizePass({
  segments,
  speechIntervals,
  fileManager,
  progressCallback,
}: {
  segments: void | SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  fileManager: FileManager;
  progressCallback?: GenerateProgressCallback;
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

  const GAP_EXTEND_THRESHOLD_SEC = 5.0;
  const extendedSegments = indexedSegments
    .slice()
    .sort((a, b) => a.start - b.start)
    .map(s => ({ ...s }));

  for (let i = 0; i < extendedSegments.length - 1; i++) {
    const curr = extendedSegments[i];
    const next = extendedSegments[i + 1];
    const gap = next.start - curr.end;
    if (gap > 0 && gap < GAP_EXTEND_THRESHOLD_SEC) {
      curr.end = Math.min(next.start, Math.max(curr.end, curr.start + 4));
    }
  }
  // Reindex to keep indices sequential after any ordering normalization
  for (let i = 0; i < extendedSegments.length; i++) {
    extendedSegments[i].index = i + 1;
  }

  const finalSrtContent = buildSrt({
    segments: extendedSegments,
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
    segments: extendedSegments,
    speechIntervals: speechIntervals,
  };
}
