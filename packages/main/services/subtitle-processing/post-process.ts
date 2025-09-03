import { SrtSegment } from '@shared-types/app';

export function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length === 0) return segments;
  const out = segments.slice();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    const hasOriginal = (s.original ?? '').trim() !== '';
    const hasTranslation = (s.translation ?? '').trim() !== '';
    if (hasOriginal && !hasTranslation) {
      // Prefer previous non-empty translation
      let donor: string | undefined;
      if (i > 0) {
        const prev = out[i - 1];
        if ((prev.translation ?? '').trim() !== '')
          donor = prev.translation!.trim();
      }
      if (!donor && i + 1 < out.length) {
        const next = out[i + 1];
        if ((next.translation ?? '').trim() !== '')
          donor = next.translation!.trim();
      }
      if (donor) {
        s.translation = donor;
      }
    }
  }
  return out;
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
