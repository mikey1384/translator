import { SrtSegment } from '@shared-types/app';

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

export function uncoveredSpeech(
  speech: Array<{ start: number; end: number }>,
  caps: SrtSegment[],
  minDur = 1
): RepairableGap[] {
  const gaps: RepairableGap[] = [];
  for (const iv of speech) {
    const firstCapStart = caps[0]?.start ?? iv.end;
    if (firstCapStart - iv.start >= minDur) {
      gaps.push({ start: iv.start, end: firstCapStart });
    }
    let ptr = iv.start;
    for (const c of caps.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - ptr >= minDur) gaps.push({ start: ptr, end: c.start });
      ptr = Math.max(ptr, c.end);
    }
    if (iv.end - ptr >= minDur) gaps.push({ start: ptr, end: iv.end });

    const lastCapEnd = caps.at(-1)?.end ?? iv.start;
    if (iv.end - lastCapEnd >= minDur) {
      gaps.push({ start: lastCapEnd, end: iv.end });
    }
  }
  return gaps;
}
