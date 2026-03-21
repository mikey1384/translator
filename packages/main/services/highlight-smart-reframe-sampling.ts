import type { FaceTrackSample } from './highlight-smart-reframe-core.js';

const MIN_SAMPLE_COUNT = 4;
const EDGE_SAMPLE_PADDING_SECONDS = 0.18;
const COARSE_SAMPLE_INTERVAL_SECONDS = 0.4;
const COARSE_MAX_SAMPLE_COUNT = 18;
const DENSE_SAMPLE_INTERVAL_SECONDS = 0.05;
const DENSE_MAX_SAMPLE_COUNT = 60;
const REFINE_WINDOW_PADDING_SECONDS = 0.25;
const REFINE_CONFIDENCE_THRESHOLD = 0.9;
const REFINE_CENTER_CHANGE_RATIO = 0.08;
const REFINE_CENTER_CHANGE_MIN_PX = 80;

type ScoredTimeWindow = {
  startSeconds: number;
  endSeconds: number;
  score: number;
};

export const MAX_DENSE_REFINEMENT_SAMPLE_COUNT = DENSE_MAX_SAMPLE_COUNT;

export function buildCoarseReframeSampleTimes(
  durationSeconds: number
): number[] {
  return buildBoundedSampleTimes({
    durationSeconds,
    intervalSeconds: COARSE_SAMPLE_INTERVAL_SECONDS,
    maxSampleCount: COARSE_MAX_SAMPLE_COUNT,
  });
}

export function buildDenseRefinementSampleTimes({
  durationSeconds,
  sourceWidth,
  coarseSamples,
}: {
  durationSeconds: number;
  sourceWidth: number;
  coarseSamples: ReadonlyArray<FaceTrackSample>;
}): number[] {
  if (coarseSamples.length < 2) {
    return [];
  }

  const scoredWindows = buildScoredRefinementWindows({
    durationSeconds,
    sourceWidth,
    coarseSamples,
  });
  if (scoredWindows.length === 0) {
    return [];
  }

  const totalSpanSeconds = scoredWindows.reduce(
    (sum, window) => sum + (window.endSeconds - window.startSeconds),
    0
  );
  const effectiveDenseInterval = Math.max(
    DENSE_SAMPLE_INTERVAL_SECONDS,
    totalSpanSeconds / Math.max(1, DENSE_MAX_SAMPLE_COUNT)
  );
  const coarseTimes = new Set(
    coarseSamples.map(sample => formatSampleTime(sample.timeSeconds))
  );
  const denseTimes = new Set<number>();

  for (const window of scoredWindows) {
    const windowTimes = buildBoundedSampleTimesInWindow({
      startSeconds: window.startSeconds,
      endSeconds: window.endSeconds,
      intervalSeconds: effectiveDenseInterval,
    });
    for (const timeSeconds of windowTimes) {
      if (coarseTimes.has(formatSampleTime(timeSeconds))) {
        continue;
      }
      denseTimes.add(timeSeconds);
    }
  }

  return [...denseTimes].sort((a, b) => a - b);
}

function buildScoredRefinementWindows({
  durationSeconds,
  sourceWidth,
  coarseSamples,
}: {
  durationSeconds: number;
  sourceWidth: number;
  coarseSamples: ReadonlyArray<FaceTrackSample>;
}): ScoredTimeWindow[] {
  const rawWindows: ScoredTimeWindow[] = [];
  const centerChangeThreshold = Math.max(
    REFINE_CENTER_CHANGE_MIN_PX,
    sourceWidth * REFINE_CENTER_CHANGE_RATIO
  );

  for (let index = 0; index < coarseSamples.length; index += 1) {
    const current = coarseSamples[index];
    const previous = coarseSamples[index - 1];

    const uncertaintyScore = scoreUncertainSample(current);
    if (uncertaintyScore > 0) {
      rawWindows.push(
        clampWindow({
          startSeconds: current.timeSeconds - REFINE_WINDOW_PADDING_SECONDS,
          endSeconds: current.timeSeconds + REFINE_WINDOW_PADDING_SECONDS,
          score: uncertaintyScore,
          durationSeconds,
        })
      );
    }

    if (!previous) {
      continue;
    }

    const transitionScore = scoreTransition({
      previous,
      current,
      centerChangeThreshold,
    });
    if (transitionScore <= 0) {
      continue;
    }

    rawWindows.push(
      clampWindow({
        startSeconds:
          Math.min(previous.timeSeconds, current.timeSeconds) -
          REFINE_WINDOW_PADDING_SECONDS,
        endSeconds:
          Math.max(previous.timeSeconds, current.timeSeconds) +
          REFINE_WINDOW_PADDING_SECONDS,
        score: transitionScore,
        durationSeconds,
      })
    );
  }

  return mergeOverlappingWindows(rawWindows);
}

function scoreUncertainSample(sample: FaceTrackSample): number {
  const candidateCount = sample.candidates?.length ?? 0;
  if (sample.centerX == null) {
    return 3;
  }
  if (candidateCount !== 1) {
    return 2;
  }
  if (sample.confidence < REFINE_CONFIDENCE_THRESHOLD) {
    return 1;
  }
  return 0;
}

function scoreTransition({
  previous,
  current,
  centerChangeThreshold,
}: {
  previous: FaceTrackSample;
  current: FaceTrackSample;
  centerChangeThreshold: number;
}): number {
  if (
    previous.shotId != null &&
    current.shotId != null &&
    previous.shotId !== current.shotId
  ) {
    return 4;
  }

  if (previous.centerX == null || current.centerX == null) {
    return 3;
  }

  const candidateCountChanged =
    (previous.candidates?.length ?? 0) !== (current.candidates?.length ?? 0);
  if (candidateCountChanged) {
    return 2;
  }

  const centerDelta = Math.abs(current.centerX - previous.centerX);
  if (centerDelta >= centerChangeThreshold) {
    return 2;
  }

  if (
    previous.confidence < REFINE_CONFIDENCE_THRESHOLD ||
    current.confidence < REFINE_CONFIDENCE_THRESHOLD
  ) {
    return 1;
  }

  return 0;
}

function mergeOverlappingWindows(
  windows: ReadonlyArray<ScoredTimeWindow>
): ScoredTimeWindow[] {
  if (windows.length === 0) {
    return [];
  }

  const sorted = [...windows].sort((a, b) => a.startSeconds - b.startSeconds);
  const merged: ScoredTimeWindow[] = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, current.endSeconds);
      previous.score = Math.max(previous.score, current.score);
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
}

function clampWindow({
  startSeconds,
  endSeconds,
  score,
  durationSeconds,
}: ScoredTimeWindow & {
  durationSeconds: number;
}): ScoredTimeWindow {
  return {
    startSeconds: clamp(startSeconds, 0, durationSeconds),
    endSeconds: clamp(endSeconds, 0, durationSeconds),
    score,
  };
}

function buildBoundedSampleTimes({
  durationSeconds,
  intervalSeconds,
  maxSampleCount,
}: {
  durationSeconds: number;
  intervalSeconds: number;
  maxSampleCount: number;
}): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }

  const sampleCount = clamp(
    Math.round(durationSeconds / intervalSeconds) + 1,
    MIN_SAMPLE_COUNT,
    maxSampleCount
  );
  if (sampleCount <= 1) {
    return [0];
  }

  const padding = Math.min(
    EDGE_SAMPLE_PADDING_SECONDS,
    Math.max(0, durationSeconds / 6)
  );
  const start = Math.min(
    padding,
    Math.max(0, durationSeconds - intervalSeconds)
  );
  const end = Math.max(start, durationSeconds - padding);

  return Array.from({ length: sampleCount }, (_, index) => {
    if (sampleCount === 1) {
      return roundTo(start, 3);
    }
    const progress = index / (sampleCount - 1);
    return roundTo(start + (end - start) * progress, 3);
  });
}

function buildBoundedSampleTimesInWindow({
  startSeconds,
  endSeconds,
  intervalSeconds,
}: {
  startSeconds: number;
  endSeconds: number;
  intervalSeconds: number;
}): number[] {
  const clampedEnd = Math.max(startSeconds, endSeconds);
  const durationSeconds = clampedEnd - startSeconds;
  if (durationSeconds <= 0) {
    return [roundTo(startSeconds, 3)];
  }

  const sampleCount = Math.max(
    2,
    Math.round(durationSeconds / intervalSeconds) + 1
  );
  return Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    return roundTo(startSeconds + durationSeconds * progress, 3);
  });
}

function formatSampleTime(timeSeconds: number): string {
  return roundTo(timeSeconds, 3).toFixed(3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
