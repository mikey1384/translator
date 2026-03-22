import type { SrtSegment } from '@shared-types/app';

type SegmentWord = NonNullable<SrtSegment['words']>[number];

const WORD_TIMING_PRECISION_MS = 1000;
const MIN_VISIBLE_WORD_DURATION_SEC = 0.001;
const TIMING_DELTA_EPSILON_SEC = 0.001;

function roundWordTimingSeconds(value: number): number {
  return (
    Math.round(value * WORD_TIMING_PRECISION_MS) / WORD_TIMING_PRECISION_MS
  );
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= TIMING_DELTA_EPSILON_SEC;
}

function sanitizeWordList(
  words: SrtSegment['words'],
  projectWordBounds: (
    word: SegmentWord
  ) => { start: number; end: number } | null
): SrtSegment['words'] {
  if (!Array.isArray(words) || words.length === 0) {
    return words;
  }

  const sanitized: NonNullable<SrtSegment['words']> = [];
  let previousEnd = 0;

  for (const word of words) {
    const projected = projectWordBounds(word);
    if (!projected) {
      continue;
    }

    const start = roundWordTimingSeconds(
      Math.max(previousEnd, projected.start)
    );
    const end = roundWordTimingSeconds(Math.max(start, projected.end));
    if (end - start < MIN_VISIBLE_WORD_DURATION_SEC) {
      continue;
    }

    sanitized.push({
      ...word,
      start,
      end,
    });
    previousEnd = end;
  }

  return sanitized.length > 0 ? sanitized : undefined;
}

export function sanitizeRelativeWordTimings(
  words: SrtSegment['words'],
  segmentDuration: number
): SrtSegment['words'] {
  const safeDuration = Math.max(0, Number(segmentDuration) || 0);

  return sanitizeWordList(words, word => {
    const rawStart = Number(word.start ?? 0);
    const rawEnd = Number(word.end ?? rawStart);
    const start = Math.min(safeDuration, Math.max(0, rawStart));
    const end = Math.min(safeDuration, Math.max(start, rawEnd));

    return { start, end };
  });
}

export function reconcileWordTimingsAfterCueBoundaryEdit(
  previousSegment: SrtSegment,
  nextStart: number,
  nextEnd: number
): SrtSegment['words'] {
  if (
    !Array.isArray(previousSegment.words) ||
    previousSegment.words.length === 0
  ) {
    return previousSegment.words;
  }

  const safeStart = Number(nextStart ?? previousSegment.start ?? 0);
  const safeEnd = Number(nextEnd ?? previousSegment.end ?? safeStart);
  if (!(safeEnd > safeStart)) {
    return undefined;
  }

  return sanitizeWordList(previousSegment.words, word => {
    const absoluteStart =
      Number(previousSegment.start ?? 0) + Number(word.start ?? 0);
    const absoluteEnd =
      Number(previousSegment.start ?? 0) + Number(word.end ?? word.start ?? 0);
    const clippedStart = Math.max(safeStart, absoluteStart);
    const clippedEnd = Math.min(safeEnd, absoluteEnd);

    if (clippedEnd - clippedStart < MIN_VISIBLE_WORD_DURATION_SEC) {
      return null;
    }

    return {
      start: clippedStart - safeStart,
      end: clippedEnd - safeStart,
    };
  });
}

export function applySegmentPatchWithWordTimings(
  previousSegment: SrtSegment,
  patch: Partial<SrtSegment>
): SrtSegment {
  const nextSegment = {
    ...previousSegment,
    ...patch,
  };

  if (Object.prototype.hasOwnProperty.call(patch, 'words')) {
    return nextSegment;
  }

  if (
    typeof patch.original === 'string' &&
    patch.original !== (previousSegment.original ?? '')
  ) {
    return {
      ...nextSegment,
      words: undefined,
    };
  }

  const updatesStart = typeof patch.start === 'number';
  const updatesEnd = typeof patch.end === 'number';
  if (!updatesStart && !updatesEnd) {
    return nextSegment;
  }

  const nextStart = Number(nextSegment.start ?? previousSegment.start ?? 0);
  const nextEnd = Number(nextSegment.end ?? previousSegment.end ?? nextStart);
  const preserveRelativeOffsets =
    updatesStart &&
    updatesEnd &&
    nearlyEqual(
      nextStart - previousSegment.start,
      nextEnd - previousSegment.end
    );

  return {
    ...nextSegment,
    words: preserveRelativeOffsets
      ? sanitizeRelativeWordTimings(
          previousSegment.words,
          Math.max(0, nextEnd - nextStart)
        )
      : reconcileWordTimingsAfterCueBoundaryEdit(
          previousSegment,
          nextStart,
          nextEnd
        ),
  };
}
