import type { SrtSegment, TranscriptHighlight } from '@shared-types/app';

export type ClipRange = { start: number; end: number };

/**
 * Whole-transcript signature. Clips used to be keyed by it, so any edit hid
 * every clip; it is now only used to find clips recorded that way.
 */
export function highlightCaptionSignature(
  segments: readonly SrtSegment[],
  displayMode: string,
  style: string,
  fontSize: number,
  typeface = 'sans'
): string {
  // Only what reaches the burned-in captions counts. Cue ids are minted fresh
  // each time an SRT is parsed, so they must not make a reopened video's
  // clips look stale.
  const cues = segments.map(segment => [
    segment.start,
    segment.end,
    segment.original,
    segment.translation ?? '',
    segment.words ?? null,
  ]);
  // Older signatures had no face; 'sans' keeps them matching.
  return typeface === 'sans'
    ? JSON.stringify([displayMode, style, fontSize, cues])
    : JSON.stringify([displayMode, style, fontSize, typeface, cues]);
}

/** Small stable string hash (cyrb53); signatures are compared, not secret. */
function hashSignature(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

/**
 * The captions burned into one clip: the look plus only the cues that overlap
 * the clip's own intervals. Editing a cue elsewhere in the transcript, or
 * translating other lines, leaves the clip current.
 */
export function highlightClipCaptionSignature(
  segments: readonly SrtSegment[],
  ranges: readonly ClipRange[],
  displayMode: string,
  style: string,
  fontSize: number,
  typeface = 'sans'
): string {
  const cues = segments
    .filter(segment =>
      ranges.some(
        range =>
          Math.min(segment.end, range.end) >
          Math.max(segment.start, range.start)
      )
    )
    .map(segment => [
      segment.start,
      segment.end,
      segment.original,
      segment.translation ?? '',
      segment.words ?? null,
    ]);
  return `clip1:${hashSignature(
    JSON.stringify([displayMode, style, fontSize, typeface, cues])
  )}`;
}

export function normalizeHighlightSourcePath(
  value: string | null | undefined
): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

/**
 * Which source a rendered clip belongs to: the verified asset first, then the
 * path, then URL/library metadata. Clips are keyed by this alone; each one
 * carries its own caption signature to tell whether it is still current.
 */
export function highlightClipSourceIdentity({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  originalVideoPath,
  sourceAssetIdentity,
  sourceUrl,
  libraryEntryId,
}: {
  fallbackVideoAssetIdentity: string | null | undefined;
  fallbackVideoPath: string | null | undefined;
  originalVideoPath: string | null | undefined;
  sourceAssetIdentity: string | null | undefined;
  sourceUrl: string | null | undefined;
  libraryEntryId: string | null | undefined;
}): string {
  const asset = String(sourceAssetIdentity || '').trim();
  if (asset) return `asset:${asset}`;
  const original = normalizeHighlightSourcePath(originalVideoPath);
  if (original) return `path:${original}`;
  const fallbackAsset = String(fallbackVideoAssetIdentity || '').trim();
  if (fallbackAsset) return `asset:${fallbackAsset}`;
  const fallback = normalizeHighlightSourcePath(fallbackVideoPath);
  if (fallback) return `path:${fallback}`;
  const url = String(sourceUrl || '').trim();
  const library = String(libraryEntryId || '').trim();
  return `meta:${url}|${library}`;
}

/** One rendered interval and edit, independent of the highlight's id. */
export function highlightClipArtifactKey(
  highlight: TranscriptHighlight
): string {
  const start = Number.isFinite(highlight.start)
    ? Math.round(highlight.start * 1000)
    : 0;
  const end = Number.isFinite(highlight.end)
    ? Math.round(highlight.end * 1000)
    : start;
  return `${start}-${end}|${JSON.stringify(highlight.editorial ?? null)}`;
}

/** Combined clips are keyed by their ordered intervals; under two is none. */
export function highlightClipSelectionSignature(
  orderedSelection: readonly TranscriptHighlight[]
): string {
  if (!Array.isArray(orderedSelection) || orderedSelection.length < 2) {
    return '';
  }
  return orderedSelection.map(highlightClipArtifactKey).join('|');
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
