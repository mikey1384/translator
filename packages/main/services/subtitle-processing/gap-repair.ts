import { SrtSegment } from './types.js';

/**
 * Find gaps in captions that should be filled
 */
export function findCaptionGaps(
  speech: Array<{ start: number; end: number }>,
  captions: SrtSegment[],
  minGapSec = 5
) {
  // Convert captions into "covered" intervals
  const covered = captions.map(c => ({ start: c.start, end: c.end }));

  const gaps: Array<{ start: number; end: number }> = [];

  for (const iv of speech) {
    let cursor = iv.start;

    // For each caption that overlaps with this speech interval:
    //   if there's a chunk of speech from 'cursor' to caption.start ≥ minGapSec
    //   that's a missing gap -> push it
    for (const c of covered.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - cursor >= minGapSec) {
        gaps.push({ start: cursor, end: c.start });
      }
      cursor = Math.max(cursor, c.end);
    }

    // Tail end leftover
    if (iv.end - cursor >= minGapSec) {
      gaps.push({ start: cursor, end: iv.end });
    }
  }

  return gaps;
}

/**
 * Build a short "before ... after" prompt for Whisper, to give context about
 * the missing gap. We take up to 3 lines before + 3 lines after, each truncated
 * to ~40 words to avoid huge prompts.
 */
export function buildContextPrompt(
  allSegments: SrtSegment[],
  gap: { start: number; end: number },
  wordsPerSide = 40
) {
  // lines that end before gap
  const beforeText = allSegments
    .filter(s => s.end <= gap.start)
    .slice(-3) // last 3 lines
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(-wordsPerSide)
    .join(' ');

  // lines that start after gap
  const afterText = allSegments
    .filter(s => s.start >= gap.end)
    .slice(0, 3) // next 3 lines
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(0, wordsPerSide)
    .join(' ');

  return `Context before:\n${beforeText}\n\n(You are continuing the same speaker)\n\nContext after:\n${afterText}\n\nTranscript:`;
}
