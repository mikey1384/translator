import { SrtSegment } from '@shared-types/app';

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
  wordsPerSide = 40
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

  return `Context before:\n${beforeText}\n\n(You are continuing the same speaker)\n\nContext after:\n${afterText}\n\nTranscript:`;
}
