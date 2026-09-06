import type { SrtSegment, TranscriptHighlight } from '@shared-types/app';

export type ClipRange = { start: number; end: number };

export function highlightCaptionSignature(
  segments: readonly SrtSegment[],
  displayMode: string,
  style: string,
  fontSize: number
): string {
  return JSON.stringify([displayMode, style, fontSize, segments]);
}

/** Fail closed instead of silently cutting an unrelated fallback interval. */
export function resolveClipRanges(
  highlights: readonly ClipRange[],
  duration: number,
  padding = 0
): ClipRange[] {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Cannot cut highlights without a verified video duration.');
  }
  if (!highlights.length || highlights.length > 20) {
    throw new Error('Choose between 1 and 20 highlights.');
  }
  return highlights.map(({ start, end }, index) => {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > duration + 0.1 ||
      start >= duration
    ) {
      throw new Error(`Highlight ${index + 1} has an invalid source interval.`);
    }
    return {
      start: Math.max(0, start - (index === 0 ? padding : 0)),
      end: Math.min(
        duration,
        end + (index === highlights.length - 1 ? padding : 0)
      ),
    };
  });
}

/** Preserve both languages and relative word timings in the edited timeline. */
export function rebaseClipSubtitles(
  segments: readonly SrtSegment[],
  ranges: readonly ClipRange[]
): SrtSegment[] {
  let offset = 0;
  const result: SrtSegment[] = [];
  for (const [rangeIndex, range] of ranges.entries()) {
    for (const segment of segments) {
      const start = Math.max(segment.start, range.start);
      const end = Math.min(segment.end, range.end);
      if (end <= start) continue;
      const words = segment.words?.flatMap(word => {
        const wordStart = Math.max(segment.start + word.start, start);
        const wordEnd = Math.min(segment.start + word.end, end);
        return wordEnd > wordStart
          ? [{ ...word, start: wordStart - start, end: wordEnd - start }]
          : [];
      });
      result.push({
        ...segment,
        id: `clip-${rangeIndex}-${segment.id}`,
        index: result.length + 1,
        start: offset + start - range.start,
        end: offset + end - range.start,
        ...(words ? { words } : {}),
      });
    }
    offset += range.end - range.start;
  }
  return result;
}

/** Prefer the strongest distinct ideas; an empty selection is a valid result. */
export function rankDistinctHighlights(
  highlights: readonly TranscriptHighlight[],
  limit = 12
): TranscriptHighlight[] {
  const ranked = highlights
    .filter(
      h =>
        Number.isFinite(h.start) &&
        Number.isFinite(h.end) &&
        h.start >= 0 &&
        h.end > h.start &&
        h.end - h.start <= 180 &&
        (h.confidence === undefined || h.confidence >= 0.5)
    )
    .sort(
      (a, b) => (b.score ?? b.confidence ?? 0) - (a.score ?? a.confidence ?? 0)
    );
  const selected: TranscriptHighlight[] = [];
  for (const candidate of ranked) {
    const duplicate = selected.some(h => {
      const overlap = Math.max(
        0,
        Math.min(h.end, candidate.end) - Math.max(h.start, candidate.start)
      );
      return (
        overlap / Math.min(h.end - h.start, candidate.end - candidate.start) >
        0.6
      );
    });
    if (!duplicate) selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}
