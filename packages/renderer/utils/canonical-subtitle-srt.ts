import { buildSrt } from '../../shared/helpers';
import type { SrtSegment, SubtitleDisplayMode } from '@shared-types/app';

export function buildSavedSubtitleSrt(
  segments: SrtSegment[],
  mode: SubtitleDisplayMode
): string {
  return buildSrt({
    segments,
    mode,
    noWrap: true,
  });
}

export function buildCanonicalSubtitleSrt(segments: SrtSegment[]): string {
  const hasTranslation = segments.some(segment =>
    Boolean((segment.translation || '').trim())
  );

  return buildSavedSubtitleSrt(segments, hasTranslation ? 'dual' : 'original');
}
