import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';
import {
  extendShortSubtitleGaps,
  fillBlankTranslations,
} from '../post-process.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { SUBTITLE_GAP_THRESHOLD } from '../constants.js';
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

  const extended = extendShortSubtitleGaps({
    segments: indexedSegments,
    threshold: SUBTITLE_GAP_THRESHOLD,
  });

  const filled = fillBlankTranslations(extended);

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
