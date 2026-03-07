import { SrtSegment } from '@shared-types/app';

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
  term: string
): number[] {
  if (!term.trim()) return [];
  const needle = term.toLowerCase();
  return subtitles
    .map((segment, index) => {
      const originalText = segment.original || '';
      const translationText = segment.translation || '';
      const haystack = `${originalText}\n${translationText}`.toLowerCase();
      return haystack.includes(needle) ? index : -1;
    })
    .filter(index => index !== -1);
}
