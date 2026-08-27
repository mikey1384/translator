import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import log from 'electron-log';
import { FileManager } from '../../file-manager.js';
import { GenerateSubtitlesFullResult } from '../types.js';

import { buildSrt } from '../../../../shared/helpers/index.js';
import { Stage, scaleProgress } from './progress.js';

function joinCueText(values: Array<string | undefined>): string {
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

export function mergeZeroDurationSubtitleSegments(
  segments: SrtSegment[]
): SrtSegment[] {
  const candidates = segments.map(segment => ({ ...segment }));
  const merged: SrtSegment[] = [];

  const mergeGroup = (
    target: SrtSegment,
    group: SrtSegment[],
    strategy: 'prepend' | 'append'
  ) => {
    const groupOriginals = group.map(segment => segment.original);
    target.original =
      strategy === 'prepend'
        ? joinCueText([...groupOriginals, target.original])
        : joinCueText([target.original, ...groupOriginals]);
    const groupTranslations = group.map(segment => segment.translation);
    target.translation =
      strategy === 'prepend'
        ? joinCueText([...groupTranslations, target.translation])
        : joinCueText([target.translation, ...groupTranslations]);
    // Word offsets belong to the removed cue boundaries and are no longer a
    // truthful timing source after text is merged into the surviving cue.
    target.words = [];
  };

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const repairable =
      Number.isFinite(candidate.start) &&
      candidate.start >= 0 &&
      Number.isFinite(candidate.end) &&
      candidate.end === candidate.start;
    if (!repairable) {
      merged.push(candidate);
      continue;
    }

    const group = [candidate];
    while (index + 1 < candidates.length) {
      const next = candidates[index + 1];
      if (
        !Number.isFinite(next.start) ||
        !Number.isFinite(next.end) ||
        next.start !== candidate.start ||
        next.end !== next.start
      ) {
        break;
      }
      group.push(next);
      index += 1;
    }

    const next = candidates[index + 1];
    if (
      next &&
      Number.isFinite(next.start) &&
      Number.isFinite(next.end) &&
      next.start === candidate.start &&
      next.end > next.start
    ) {
      const survivor = { ...next };
      mergeGroup(survivor, group, 'prepend');
      merged.push(survivor);
      index += 1;
      continue;
    }

    const previous = merged.at(-1);
    if (previous) {
      mergeGroup(previous, group, 'append');
      continue;
    }

    // Retain an all-degenerate transcript so a later validator fails closed
    // instead of silently discarding the provider's text.
    merged.push(...group);
  }

  merged.forEach((segment, index) => {
    segment.index = index + 1;
  });
  return merged;
}

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

    // Avoid cumulative drift:
    // If cues overlap, trim the previous cue instead of pushing the current cue forward.
    // Pushing starts forward can accumulate small overlaps into minutes of drift on long videos.
    if (prev && prev.end > cur.start) {
      prev.end = Math.max(prev.start, cur.start);
    }

    // Always keep cue durations non-negative.
    if (cur.end < cur.start) {
      cur.end = cur.start;
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

  return mergeZeroDurationSubtitleSegments(items);
}

export async function finalizePass({
  segments,
  speechIntervals,
  fileManager,
  progressCallback,
  operationId,
}: {
  segments: void | SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  fileManager: FileManager;
  progressCallback?: GenerateProgressCallback;
  operationId?: string;
}): Promise<GenerateSubtitlesFullResult> {
  progressCallback?.({
    percent: scaleProgress(0, Stage.REVIEW, Stage.FINAL),
    stage: 'Applying final adjustments',
    phaseKey: 'finalize',
  });

  const items = normalizeSubtitleSegments((segments ?? []) as SrtSegment[]);

  const finalSrtContent = buildSrt({ segments: items, mode: 'dual' });

  let tempFilePath: string | undefined;
  let tempFileError: string | undefined;
  let tempFileSaved = false;
  try {
    tempFilePath = await fileManager.writeTempFile(finalSrtContent, '.srt');
    tempFileSaved = true;
  } catch (error) {
    // Non-fatal: returning subtitle content to renderer is the primary output.
    tempFileError = error instanceof Error ? error.message : String(error);
    const opPrefix = operationId ? `[${operationId}] ` : '';
    log.warn(
      `${opPrefix}[finalizePass] Failed to persist temp SRT file: ${tempFileError}`,
      error
    );
  }

  progressCallback?.({
    percent: scaleProgress(100, Stage.REVIEW, Stage.FINAL),
    stage: tempFileSaved
      ? 'Saved temporary subtitle file'
      : 'Subtitles ready (temporary save unavailable)',
    phaseKey: 'finalize',
  });

  progressCallback?.({
    percent: scaleProgress(100, Stage.FINAL, Stage.END),
    stage: tempFileSaved
      ? 'Processing complete!'
      : 'Processing complete (temporary save unavailable)',
    phaseKey: 'completed',
    partialResult: finalSrtContent,
    current: items.length,
    total: items.length,
    unit: 'segments',
  });

  return {
    subtitles: finalSrtContent,
    segments: items,
    speechIntervals: speechIntervals,
    tempFileSaved,
    tempFilePath,
    tempFileError,
  };
}
