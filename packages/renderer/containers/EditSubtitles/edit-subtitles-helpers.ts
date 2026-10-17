import { SrtSegment } from '@shared-types/app';
import { textMatches, type FindOptions } from '../../utils/subtitleFind.js';

export function calcAffectedSubtitleRows(
  prev: SrtSegment[],
  next: SrtSegment[],
  start: number | null | undefined
): number[] {
  if (start == null) return [];
  const batchSize = 50;
  const out: number[] = [];
  for (
    let i = start;
    i < Math.min(start + batchSize, prev.length, next.length);
    i++
  ) {
    if (
      prev[i] &&
      next[i] &&
      (prev[i].original !== next[i].original ||
        prev[i].translation !== next[i].translation)
    ) {
      out.push(i);
    }
  }
  return out;
}

export function collectMatchIndices(
  subtitles: SrtSegment[],
  term: string,
  options: FindOptions = {}
): number[] {
  if (!term.trim()) return [];
  return subtitles
    .map((segment, index) =>
      textMatches(segment.original || '', term, options) ||
      textMatches(segment.translation || '', term, options)
        ? index
        : -1
    )
    .filter(index => index !== -1);
}
