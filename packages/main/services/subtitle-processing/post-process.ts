import { SrtSegment } from '@shared-types/app';
import { SUBTITLE_GAP_THRESHOLD } from './constants.js';

export function extendShortSubtitleGaps({
  segments,
  threshold = SUBTITLE_GAP_THRESHOLD,
}: {
  segments: SrtSegment[];
  threshold?: number;
}): SrtSegment[] {
  if (!segments || segments.length < 2) return segments;

  const EPS = 1e-3; // 1 ms for float jitter

  // 1) Ensure strict start-time order (stable by original index if present)
  segments.sort((a, b) => a.start - b.start || (a.index ?? 0) - (b.index ?? 0));

  // 2) Walk clusters and close the *post-cluster* gap
  let i = 0;
  while (i < segments.length - 1) {
    const clusterStartIdx = i;
    let clusterEndIdx = i;
    let clusterEnd = segments[i].end;

    // grow cluster while next starts before (or essentially at) current cluster end
    while (
      clusterEndIdx + 1 < segments.length &&
      segments[clusterEndIdx + 1].start <= clusterEnd + EPS
    ) {
      clusterEndIdx++;
      if (segments[clusterEndIdx].end > clusterEnd) {
        clusterEnd = segments[clusterEndIdx].end;
      }
    }

    const nextIdx = clusterEndIdx + 1;
    if (nextIdx < segments.length) {
      const nextStart = segments[nextIdx].start;
      const gap = nextStart - clusterEnd;

      if (gap > EPS && gap <= threshold + EPS) {
        // extend the cue that ends last within the cluster,
        // preferring one that has non-empty original/translation
        let extendIdx = clusterEndIdx;
        let fallbackIdx = clusterEndIdx;
        for (let k = clusterEndIdx; k >= clusterStartIdx; k--) {
          const endsLast = Math.abs(segments[k].end - clusterEnd) <= EPS;
          if (endsLast) {
            fallbackIdx = k; // remember last-in-cluster that ends at clusterEnd
            const hasText =
              (segments[k].original?.trim()?.length ?? 0) > 0 ||
              (segments[k].translation?.trim()?.length ?? 0) > 0;
            if (hasText) {
              extendIdx = k;
              break;
            }
          }
        }
        // if none of the last-ending cues had text, fall back to the last one
        if (
          (segments[extendIdx].original?.trim()?.length ?? 0) === 0 &&
          (segments[extendIdx].translation?.trim()?.length ?? 0) === 0
        ) {
          extendIdx = fallbackIdx;
        }
        segments[extendIdx].end = nextStart;
      }
    }

    i = Math.max(i + 1, clusterEndIdx + 1);
  }

  return segments;
}

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
