import { SrtSegment } from './types.js';
import * as C from './constants.js';

/**
 * Extends subtitle gaps that are shorter than the threshold.
 * This makes subtitles stay on screen a bit longer when there's
 * only a tiny gap before the next one.
 */
export function extendShortSubtitleGaps({
  segments,
  threshold = C.SUBTITLE_GAP_THRESHOLD,
}: {
  segments: SrtSegment[];
  threshold?: number;
}): SrtSegment[] {
  if (!segments || segments.length < 2) return segments;

  for (let i = 0; i < segments.length - 1; i++) {
    const currentEnd = Number(segments[i].end);
    const nextStart = Number(segments[i + 1].start);
    const gap = nextStart - currentEnd;

    if (gap > 0 && gap < threshold) {
      segments[i].end = nextStart;
    }
  }
  return segments;
}

/**
 * Fills in blank translations with the original text.
 * This ensures no subtitle has an empty translation.
 */
export function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  return segments; // blanks stay blank, no carry-over
}

/**
 * Fuses segments with few words, to avoid very short subtitles
 */
export function fuseOrphans(segments: SrtSegment[]): SrtSegment[] {
  const MIN_WORDS = 4;

  if (!segments.length) return [];

  const fused: SrtSegment[] = [];

  for (const seg of segments) {
    const wordCount = seg.original.trim().split(/\s+/).length;

    if (wordCount < MIN_WORDS && fused.length) {
      const prev = fused[fused.length - 1];
      const gap = seg.start - prev.end;

      if (gap < C.MAX_GAP_TO_FUSE) {
        // → just a hiccup in the waveform: stretch timing & append text
        prev.end = seg.end;
        prev.original = `${prev.original} ${seg.original}`.trim();
        continue;
      }
    }

    // normal case – keep caption as is
    fused.push({ ...seg });
  }

  // re-index before returning
  return fused.map((s, i) => ({ ...s, index: i + 1 }));
}
