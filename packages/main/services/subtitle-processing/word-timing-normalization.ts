import type { SrtSegment } from '@shared-types/app';
import { sanitizeRelativeWordTimings } from '../../../shared/helpers/word-timing.js';

type SegmentWord = NonNullable<SrtSegment['words']>[number];

const ABSOLUTE_WORD_TIMING_TOLERANCE_SEC = 0.35;
const RELATIVE_WORD_TIMING_TOLERANCE_SEC = 0.05;

function roundWordTimingSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clampWordToSegmentDuration(
  word: SegmentWord,
  segmentDuration: number
): SegmentWord {
  const start = roundWordTimingSeconds(
    Math.min(segmentDuration, Math.max(0, Number(word.start ?? 0)))
  );
  const end = roundWordTimingSeconds(
    Math.min(segmentDuration, Math.max(start, Number(word.end ?? 0)))
  );

  return {
    ...word,
    start,
    end,
  };
}

export function rebaseWordTimingsToSegment(
  words: SrtSegment['words'],
  segmentStart: number,
  segmentEnd?: number
): SrtSegment['words'] {
  if (!Array.isArray(words) || words.length === 0) {
    return words;
  }

  const segmentDuration =
    typeof segmentEnd === 'number'
      ? Math.max(0, segmentEnd - segmentStart)
      : Number.POSITIVE_INFINITY;

  return words.map(word =>
    clampWordToSegmentDuration(
      {
        ...word,
        start: Number(word.start ?? 0) - segmentStart,
        end: Number(word.end ?? 0) - segmentStart,
      },
      segmentDuration
    )
  );
}

function looksLikeAbsoluteWordTimings(segment: SrtSegment): boolean {
  if (!Array.isArray(segment.words) || segment.words.length === 0) {
    return false;
  }

  const segmentStart = Number(segment.start ?? 0);
  const segmentEnd = Number(segment.end ?? segmentStart);
  const segmentDuration = Math.max(0, segmentEnd - segmentStart);

  return segment.words.some(word => {
    const start = Number(word.start ?? 0);
    const end = Number(word.end ?? start);

    return (
      (start > segmentDuration + ABSOLUTE_WORD_TIMING_TOLERANCE_SEC ||
        end > segmentDuration + ABSOLUTE_WORD_TIMING_TOLERANCE_SEC) &&
      start >= segmentStart - ABSOLUTE_WORD_TIMING_TOLERANCE_SEC &&
      start <= segmentEnd + ABSOLUTE_WORD_TIMING_TOLERANCE_SEC
    );
  });
}

function supportsWordTimingBasis(
  segment: SrtSegment,
  basis: 'absolute' | 'relative'
): boolean {
  if (!Array.isArray(segment.words) || segment.words.length === 0) {
    return false;
  }

  const segmentStart = Number(segment.start ?? 0);
  const segmentEnd = Number(segment.end ?? segmentStart);
  const segmentDuration = Math.max(0, segmentEnd - segmentStart);

  return segment.words.every(word => {
    const start = Number(word.start ?? 0);
    const end = Number(word.end ?? start);
    if (end < start) {
      return false;
    }

    if (basis === 'absolute') {
      return (
        start >= segmentStart - ABSOLUTE_WORD_TIMING_TOLERANCE_SEC &&
        end <= segmentEnd + ABSOLUTE_WORD_TIMING_TOLERANCE_SEC
      );
    }

    return (
      start >= -RELATIVE_WORD_TIMING_TOLERANCE_SEC &&
      end <= segmentDuration + RELATIVE_WORD_TIMING_TOLERANCE_SEC
    );
  });
}

function shouldTreatSubtitleSetAsLegacyAbsolute(
  segments: SrtSegment[]
): boolean {
  const timedSegments = segments.filter(
    segment => Array.isArray(segment.words) && segment.words.length > 0
  );
  if (timedSegments.length === 0) {
    return false;
  }

  let strongAbsoluteCount = 0;
  let absoluteCompatibleCount = 0;
  let relativeCompatibleCount = 0;

  for (const segment of timedSegments) {
    if (looksLikeAbsoluteWordTimings(segment)) {
      strongAbsoluteCount += 1;
    }
    if (supportsWordTimingBasis(segment, 'absolute')) {
      absoluteCompatibleCount += 1;
    }
    if (supportsWordTimingBasis(segment, 'relative')) {
      relativeCompatibleCount += 1;
    }
  }

  return (
    strongAbsoluteCount > 0 && absoluteCompatibleCount > relativeCompatibleCount
  );
}

export function normalizeSegmentWordTimings(segment: SrtSegment): SrtSegment {
  const normalizedSegment = looksLikeAbsoluteWordTimings(segment)
    ? {
        ...segment,
        words: rebaseWordTimingsToSegment(
          segment.words,
          Number(segment.start ?? 0),
          Number(segment.end ?? segment.start ?? 0)
        ),
      }
    : segment;

  if (
    !Array.isArray(normalizedSegment.words) ||
    normalizedSegment.words.length === 0
  ) {
    return normalizedSegment;
  }

  const sanitizedWords = sanitizeRelativeWordTimings(
    normalizedSegment.words,
    Math.max(
      0,
      Number(normalizedSegment.end ?? normalizedSegment.start ?? 0) -
        Number(normalizedSegment.start ?? 0)
    )
  );

  if (sanitizedWords === normalizedSegment.words) {
    return normalizedSegment;
  }

  return {
    ...normalizedSegment,
    words: sanitizedWords,
  };
}

export function normalizeSegmentWordTimingsForRender(
  segments: SrtSegment[]
): SrtSegment[] {
  const treatAsLegacyAbsolute =
    shouldTreatSubtitleSetAsLegacyAbsolute(segments);

  return segments.map(segment =>
    normalizeSegmentWordTimings(
      treatAsLegacyAbsolute &&
        Array.isArray(segment.words) &&
        segment.words.length > 0
        ? {
            ...segment,
            words: rebaseWordTimingsToSegment(
              segment.words,
              Number(segment.start ?? 0),
              Number(segment.end ?? segment.start ?? 0)
            ),
          }
        : segment
    )
  );
}
