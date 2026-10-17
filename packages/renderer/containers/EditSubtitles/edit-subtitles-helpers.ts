import { SrtSegment } from '@shared-types/app';
import {
  collectMatchRows,
  type FindOptions,
} from '../../utils/subtitleFind.js';

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

/** Rows of every match, one entry per match (see collectMatchRows). */
export function collectMatchIndices(
  subtitles: SrtSegment[],
  term: string,
  options: FindOptions = {}
): number[] {
  return collectMatchRows(subtitles, term, options);
}
