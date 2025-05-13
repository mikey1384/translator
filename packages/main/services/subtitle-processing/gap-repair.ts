import { SrtSegment } from '@shared-types/app';
import { MAX_CHUNK_DURATION_SEC, MIN_CHUNK_DURATION_SEC } from './constants.js';

export function findCaptionGaps(
  speech: Array<{ start: number; end: number }>,
  captions: SrtSegment[],
  minGapSec = 5
) {
  const covered = captions.map(c => ({ start: c.start, end: c.end }));
  const gaps: Array<{ start: number; end: number }> = [];
  for (const iv of speech) {
    let cursor = iv.start;
    for (const c of covered.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - cursor >= minGapSec) {
        gaps.push({ start: cursor, end: c.start });
      }
      cursor = Math.max(cursor, c.end);
    }
    if (iv.end - cursor >= minGapSec) {
      gaps.push({ start: cursor, end: iv.end });
    }
  }
  return gaps;
}

export function buildContextPrompt(
  allSegments: SrtSegment[],
  gap: { start: number; end: number },
  wordsPerSide = 80
) {
  const beforeText = allSegments
    .filter(s => s.end <= gap.start)
    .slice(-3)
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(-wordsPerSide)
    .join(' ');

  const afterText = allSegments
    .filter(s => s.start >= gap.end)
    .slice(0, 3)
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(0, wordsPerSide)
    .join(' ');

  return `Context before:\n${beforeText}\n\nContext after:\n${afterText}\n\nTranscript:`;
}

export interface RepairableGap {
  start: number;
  end: number;
}

/**
 * Identifies gaps between existing SRT segments that are larger than a threshold.
 * If a gap is very large, it can optionally be broken into smaller, manageable sub-gaps.
 */
export function findGapsBetweenTranscribedSegments(
  existingSegments: SrtSegment[],
  minGapSecForRepair: number,
  maxRepairChunkDuration: number = MAX_CHUNK_DURATION_SEC,
  minRepairChunkDuration: number = MIN_CHUNK_DURATION_SEC
): RepairableGap[] {
  if (existingSegments.length < 1) {
    return [];
  }

  const repairableGaps: RepairableGap[] = [];
  const sortedSegments = [...existingSegments].sort(
    (a, b) => a.start - b.start
  );

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const prevSegment = sortedSegments[i];
    const nextSegment = sortedSegments[i + 1];

    const gapStart = prevSegment.end;
    const gapEnd = nextSegment.start;
    const gapDuration = gapEnd - gapStart;

    if (gapDuration >= minGapSecForRepair) {
      let currentSubGapStart = gapStart;
      while (currentSubGapStart < gapEnd) {
        const remainingDurationInMajorGap = gapEnd - currentSubGapStart;
        if (remainingDurationInMajorGap < minRepairChunkDuration) {
          break;
        }
        const currentSubGapEnd = Math.min(
          currentSubGapStart + maxRepairChunkDuration,
          gapEnd
        );
        repairableGaps.push({
          start: currentSubGapStart,
          end: currentSubGapEnd,
        });
        currentSubGapStart = currentSubGapEnd;
      }
    }
  }

  return repairableGaps;
}

export function uncoveredSpeech(
  speech: Array<{ start: number; end: number }>,
  caps: SrtSegment[],
  minDur = 1
): RepairableGap[] {
  const gaps: RepairableGap[] = [];
  for (const iv of speech) {
    let ptr = iv.start;
    for (const c of caps.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - ptr >= minDur) gaps.push({ start: ptr, end: c.start });
      ptr = Math.max(ptr, c.end);
    }
    if (iv.end - ptr >= minDur) gaps.push({ start: ptr, end: iv.end });
  }
  return gaps;
}
