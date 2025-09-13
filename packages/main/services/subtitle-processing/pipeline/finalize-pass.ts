import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';

import { buildSrt } from '../../../../shared/helpers/index.js';
import { Stage, scaleProgress } from './progress.js';

export function normalizeSubtitleSegments(
  segments: SrtSegment[]
): SrtSegment[] {
  // Clone, normalize numeric times, and sort
  const items = (segments ?? [])
    .map((s, idx) => ({
      ...s,
      index: idx + 1,
      start: Number(s.start ?? 0),
      end: Number(s.end ?? 0),
    }))
    .sort((a, b) => a.start - b.start)
    .map(s => ({ ...s }));

  // Policy constants
  const MIN_DISPLAY_SEC = 3.0; // prefer at least this long, without clashing
  const JOIN_GAP_LT_SEC = 5.0; // join gaps strictly less than this

  // Forward normalization pass:
  // - ensure non-overlap and ordering
  // - join small gaps (< 5s) by extending previous to next.start
  // - enforce minimum display duration of 3s, shifting subsequent start if needed
  for (let i = 0; i < items.length; i++) {
    const prev = i > 0 ? items[i - 1] : null;
    const cur = items[i];
    const next = i + 1 < items.length ? items[i + 1] : null;

    // Ensure chronological order: clamp start to prev.end if out of order
    if (prev && cur.start < prev.end) {
      cur.start = prev.end;
      if (cur.end < cur.start) cur.end = cur.start;
    }

    // Join small visible gaps between prev and cur
    if (prev) {
      const gap = cur.start - prev.end;
      if (gap > 0 && gap < JOIN_GAP_LT_SEC) {
        prev.end = cur.start; // fill the gap exactly
      }
    }

    // Enforce minimum display duration only if it doesn't clash with the next cue
    // i.e., extend to 3s when there is room, otherwise leave as-is.
    const desiredEnd = cur.start + MIN_DISPLAY_SEC;
    if (cur.end - cur.start < MIN_DISPLAY_SEC) {
      if (!next) {
        // No next cue; we can safely extend to desiredEnd
        cur.end = Math.max(cur.end, desiredEnd);
      } else {
        const available = next.start - cur.start; // time window until next cue starts
        if (available >= MIN_DISPLAY_SEC) {
          cur.end = Math.max(cur.end, Math.min(desiredEnd, next.start));
        } else {
          // Not enough room; do not extend into next cue
          if (cur.end > next.start) cur.end = next.start;
        }
      }
    }
  }

  // Second pass: after pushes, re-apply gap join to catch new small gaps
  for (let i = 0; i + 1 < items.length; i++) {
    const a = items[i];
    const b = items[i + 1];
    const gap = b.start - a.end;
    if (gap > 0 && gap < JOIN_GAP_LT_SEC) {
      a.end = b.start;
    }
  }

  // Reindex sequentially
  for (let i = 0; i < items.length; i++) items[i].index = i + 1;

  return items;
}

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

  const items = normalizeSubtitleSegments((segments ?? []) as SrtSegment[]);

  const finalSrtContent = buildSrt({ segments: items, mode: 'dual' });

  await fileManager.writeTempFile(finalSrtContent, '.srt');

  progressCallback?.({
    percent: scaleProgress(100, Stage.FINAL, Stage.FINAL + 5),
    stage: 'Processing complete!',
    partialResult: finalSrtContent,
    current: items.length,
    total: items.length,
  });

  return {
    subtitles: finalSrtContent,
    segments: items,
    speechIntervals: speechIntervals,
  };
}
