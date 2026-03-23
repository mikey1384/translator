import type { SrtSegment } from '@shared-types/app';

function buildTimeKey(segment: Pick<SrtSegment, 'start' | 'end'>): string {
  return `${Math.round(Number(segment.start ?? 0) * 1000)}:${Math.round(
    Number(segment.end ?? 0) * 1000
  )}`;
}

function cloneWords(words: SrtSegment['words']): SrtSegment['words'] {
  if (!Array.isArray(words) || words.length === 0) {
    return words;
  }

  return words.map(word => ({ ...word }));
}

export function preserveWordTimingsOnTranslatedSegments(
  sourceSegments: SrtSegment[],
  translatedSegments: SrtSegment[]
): SrtSegment[] {
  const sourceByTime = new Map<string, SrtSegment>();
  const sourceByIndex = new Map<number, SrtSegment>();

  sourceSegments.forEach((segment, index) => {
    sourceByTime.set(buildTimeKey(segment), segment);
    if (typeof segment.index === 'number' && segment.index > 0) {
      sourceByIndex.set(segment.index, segment);
    } else if (!sourceByIndex.has(index + 1)) {
      sourceByIndex.set(index + 1, segment);
    }
  });

  const useOrderFallback = sourceSegments.length === translatedSegments.length;

  return translatedSegments.map((segment, index) => {
    const source =
      sourceByTime.get(buildTimeKey(segment)) ??
      (typeof segment.index === 'number' && segment.index > 0
        ? sourceByIndex.get(segment.index)
        : undefined) ??
      (useOrderFallback ? sourceSegments[index] : undefined);

    if (!Array.isArray(source?.words) || source.words.length === 0) {
      return segment;
    }

    return {
      ...segment,
      words: cloneWords(source.words),
    };
  });
}
