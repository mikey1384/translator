import { SrtSegment } from '@shared-types/app';
import { MAX_GAP_TO_FUSE, SUBTITLE_GAP_THRESHOLD } from './constants.js';

export function extendShortSubtitleGaps({
  segments,
  threshold = SUBTITLE_GAP_THRESHOLD,
}: {
  segments: SrtSegment[];
  threshold?: number;
}): SrtSegment[] {
  if (!segments || segments.length < 2) return segments;

  for (let i = 0; i < segments.length - 1; i++) {
    const currentEnd = segments[i].end;
    const nextStart = segments[i + 1].start;
    const gap = nextStart - currentEnd;

    if (gap > 0 && gap < threshold) {
      segments[i].end = nextStart;
    }
  }
  return segments;
}

export function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  return segments;
}

export function fuseOrphans(segments: SrtSegment[]): SrtSegment[] {
  const MIN_WORDS = 4;

  if (!segments.length) return [];

  const fused: SrtSegment[] = [];

  for (const seg of segments) {
    const wordCount = seg.original.trim().split(/\s+/).length;

    if (wordCount < MIN_WORDS && fused.length) {
      const prev = fused[fused.length - 1];
      const gap = seg.start - prev.end;

      if (gap < MAX_GAP_TO_FUSE) {
        prev.end = seg.end;
        prev.original = `${prev.original} ${seg.original}`.trim();
        continue;
      }
    }

    fused.push({ ...seg });
  }

  return fused.map((s, i) => ({ ...s, index: i + 1 }));
}

export function enforceMinDuration(segs: SrtSegment[]): SrtSegment[] {
  const MIN_DUR = 5.0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const dur = s.end - s.start;
    if (dur >= MIN_DUR) continue;

    const deficit = MIN_DUR - dur;

    const next = segs[i + 1];
    if (next && next.start - s.end >= deficit) {
      s.end += deficit;
      continue;
    }

    const prev = segs[i - 1];
    if (prev && s.start - prev.end >= deficit) {
      s.start -= deficit;
      continue;
    }

    if (prev) {
      prev.end = s.end;
      prev.original = `${prev.original} ${s.original}`.trim();
      segs.splice(i--, 1); // remove current; re-check this index
    }
  }
  return segs.map((s, idx) => ({ ...s, index: idx + 1 }));
}
