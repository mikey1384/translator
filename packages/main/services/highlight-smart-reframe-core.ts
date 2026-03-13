export const ULTRAFACE_INPUT_WIDTH = 320;
export const ULTRAFACE_INPUT_HEIGHT = 240;

const ULTRAFACE_CENTER_VARIANCE = 0.1;
const ULTRAFACE_SIZE_VARIANCE = 0.2;
const ULTRAFACE_IOU_THRESHOLD = 0.3;
const ULTRAFACE_MIN_BOXES = [
  [10, 16, 24],
  [32, 48],
  [64, 96],
  [128, 192, 256],
] as const;
const ULTRAFACE_FEATURE_MAP_W_H = [
  [40, 20, 10, 5],
  [30, 15, 8, 4],
] as const;

const MAX_FACE_CANDIDATES = 200;
const MIN_SAMPLE_COUNT = 4;
const MAX_SAMPLE_COUNT = 12;
const SAMPLE_INTERVAL_SECONDS = 0.65;
const EDGE_SAMPLE_PADDING_SECONDS = 0.18;
const MAX_PAN_SPEED_MULTIPLIER = 0.9;
const SMOOTHING_ALPHA = 0.72;

const ULTRAFACE_PRIORS = buildUltraFacePriors();

export interface FaceCandidate {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

export interface FaceTrackSample {
  timeSeconds: number;
  centerX: number | null;
  confidence: number;
}

export interface ReframeKeyframe {
  timeSeconds: number;
  x: number;
}

export interface VerticalReframePlan {
  cropWidth: number;
  cropHeight: number;
  keyframes: ReframeKeyframe[];
  xExpression: string;
  strategy: 'tracked-face' | 'center';
  sampleCount: number;
  detectedSamples: number;
}

export function computeVerticalCropWidth(
  sourceWidth: number,
  sourceHeight: number
): number | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    return null;
  }
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return null;
  }

  const rawWidth = Math.round((sourceHeight * 9) / 16);
  if (rawWidth >= sourceWidth) {
    return null;
  }

  return clampEven(rawWidth);
}

export function buildSampleTimes(durationSeconds: number): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }

  const sampleCount = clamp(
    Math.round(durationSeconds / SAMPLE_INTERVAL_SECONDS) + 1,
    MIN_SAMPLE_COUNT,
    MAX_SAMPLE_COUNT
  );
  if (sampleCount <= 1) {
    return [0];
  }

  const padding = Math.min(
    EDGE_SAMPLE_PADDING_SECONDS,
    Math.max(0, durationSeconds / 6)
  );
  const start = Math.min(padding, Math.max(0, durationSeconds - 0.05));
  const end = Math.max(start, durationSeconds - padding);

  return Array.from({ length: sampleCount }, (_, index) => {
    if (sampleCount === 1) {
      return roundTo(start, 3);
    }
    const progress = index / (sampleCount - 1);
    return roundTo(start + (end - start) * progress, 3);
  });
}

export function decodeUltraFaceDetections(
  scores: ArrayLike<number>,
  boxes: ArrayLike<number>,
  sourceWidth: number,
  sourceHeight: number,
  scoreThreshold = 0.72
): FaceCandidate[] {
  const decodedBoxes = decodeUltraFaceBoxes(boxes);
  const candidates: FaceCandidate[] = [];

  for (let index = 0; index < ULTRAFACE_PRIORS.length / 4; index += 1) {
    const score = Number(scores[index * 2 + 1] ?? 0);
    if (!Number.isFinite(score) || score < scoreThreshold) {
      continue;
    }

    const boxOffset = index * 4;
    const x1 = clamp(decodedBoxes[boxOffset] * sourceWidth, 0, sourceWidth);
    const y1 = clamp(
      decodedBoxes[boxOffset + 1] * sourceHeight,
      0,
      sourceHeight
    );
    const x2 = clamp(decodedBoxes[boxOffset + 2] * sourceWidth, 0, sourceWidth);
    const y2 = clamp(
      decodedBoxes[boxOffset + 3] * sourceHeight,
      0,
      sourceHeight
    );

    if (x2 <= x1 || y2 <= y1) {
      continue;
    }

    candidates.push({ x1, y1, x2, y2, score });
  }

  return hardNms(candidates, ULTRAFACE_IOU_THRESHOLD, MAX_FACE_CANDIDATES);
}

export function pickPrimaryFaceCenterX(
  candidates: FaceCandidate[],
  sourceWidth: number,
  sourceHeight: number,
  previousCenterX: number | null
): { centerX: number; confidence: number } | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  let best: { centerX: number; confidence: number; rank: number } | null = null;

  for (const candidate of candidates) {
    const width = Math.max(1, candidate.x2 - candidate.x1);
    const height = Math.max(1, candidate.y2 - candidate.y1);
    const centerX = candidate.x1 + width / 2;
    const centerBias =
      1 - Math.min(1, Math.abs(centerX - sourceWidth / 2) / (sourceWidth / 2));
    const areaShare =
      (width * height) / Math.max(1, sourceWidth * sourceHeight);
    const continuityBias =
      previousCenterX == null
        ? centerBias
        : 1 -
          Math.min(
            1,
            Math.abs(centerX - previousCenterX) / Math.max(1, sourceWidth)
          );
    const rank =
      candidate.score *
      (1 + Math.min(areaShare * 12, 2.4)) *
      (0.7 + centerBias * 0.3) *
      (0.65 + continuityBias * 0.55);

    if (!best || rank > best.rank) {
      best = { centerX, confidence: candidate.score, rank };
    }
  }

  return best ? { centerX: best.centerX, confidence: best.confidence } : null;
}

export function buildVerticalReframePlan({
  sourceWidth,
  sourceHeight,
  durationSeconds,
  samples,
}: {
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  samples: FaceTrackSample[];
}): VerticalReframePlan | null {
  const cropWidth = computeVerticalCropWidth(sourceWidth, sourceHeight);
  if (!cropWidth) {
    return null;
  }

  const cropHeight = clampEven(sourceHeight);
  const maxX = Math.max(0, sourceWidth - cropWidth);
  const fallbackX = roundTo(maxX / 2, 3);
  const normalizedSamples =
    samples.length > 0
      ? [...samples].sort((a, b) => a.timeSeconds - b.timeSeconds)
      : buildSampleTimes(durationSeconds).map(timeSeconds => ({
          timeSeconds,
          centerX: null,
          confidence: 0,
        }));

  const rawTrack = normalizedSamples.map(sample =>
    sample.centerX == null
      ? null
      : clamp(sample.centerX - cropWidth / 2, 0, maxX)
  );
  const filledTrack = interpolateMissingTrack(rawTrack, fallbackX);
  const smoothedTrack = smoothTrack(
    normalizedSamples.map(sample => sample.timeSeconds),
    filledTrack,
    cropWidth,
    maxX
  );

  const keyframes = normalizedSamples.map((sample, index) => ({
    timeSeconds: roundTo(sample.timeSeconds, 3),
    x: roundTo(smoothedTrack[index], 3),
  }));
  const detectedSamples = normalizedSamples.filter(
    sample => sample.centerX != null
  ).length;

  return {
    cropWidth,
    cropHeight,
    keyframes,
    xExpression: buildPiecewiseLinearExpression(keyframes),
    strategy: detectedSamples > 0 ? 'tracked-face' : 'center',
    sampleCount: normalizedSamples.length,
    detectedSamples,
  };
}

export function buildPiecewiseLinearExpression(
  keyframes: ReadonlyArray<ReframeKeyframe>
): string {
  if (keyframes.length === 0) {
    return '0';
  }
  if (keyframes.length === 1) {
    return formatNumber(keyframes[0].x);
  }

  let expression = formatNumber(keyframes[keyframes.length - 1].x);
  for (let index = keyframes.length - 2; index >= 0; index -= 1) {
    const current = keyframes[index];
    const next = keyframes[index + 1];
    const duration = Math.max(0.001, next.timeSeconds - current.timeSeconds);
    const delta = next.x - current.x;
    const segmentExpression =
      Math.abs(delta) < 0.001
        ? formatNumber(current.x)
        : `(${formatNumber(current.x)}+(${formatNumber(delta / duration)}*(t-${formatNumber(current.timeSeconds)})))`;
    expression = `if(lt(t,${formatNumber(next.timeSeconds)}),${segmentExpression},${expression})`;
  }
  return expression;
}

function buildUltraFacePriors(): Float32Array {
  const priors: number[] = [];
  const shrinkageList = ULTRAFACE_FEATURE_MAP_W_H.map((featureMaps, axis) =>
    featureMaps.map(
      featureSize =>
        (axis === 0 ? ULTRAFACE_INPUT_WIDTH : ULTRAFACE_INPUT_HEIGHT) /
        featureSize
    )
  );

  for (let level = 0; level < ULTRAFACE_FEATURE_MAP_W_H[0].length; level += 1) {
    const featureMapWidth = ULTRAFACE_FEATURE_MAP_W_H[0][level];
    const featureMapHeight = ULTRAFACE_FEATURE_MAP_W_H[1][level];
    const scaleWidth = ULTRAFACE_INPUT_WIDTH / shrinkageList[0][level];
    const scaleHeight = ULTRAFACE_INPUT_HEIGHT / shrinkageList[1][level];

    for (let y = 0; y < featureMapHeight; y += 1) {
      for (let x = 0; x < featureMapWidth; x += 1) {
        const centerX = (x + 0.5) / scaleWidth;
        const centerY = (y + 0.5) / scaleHeight;

        for (const minBox of ULTRAFACE_MIN_BOXES[level]) {
          priors.push(
            centerX,
            centerY,
            minBox / ULTRAFACE_INPUT_WIDTH,
            minBox / ULTRAFACE_INPUT_HEIGHT
          );
        }
      }
    }
  }

  return Float32Array.from(priors);
}

function decodeUltraFaceBoxes(boxes: ArrayLike<number>): Float32Array {
  const decoded = new Float32Array(boxes.length);

  for (let index = 0; index < ULTRAFACE_PRIORS.length / 4; index += 1) {
    const priorOffset = index * 4;
    const priorCenterX = ULTRAFACE_PRIORS[priorOffset];
    const priorCenterY = ULTRAFACE_PRIORS[priorOffset + 1];
    const priorWidth = ULTRAFACE_PRIORS[priorOffset + 2];
    const priorHeight = ULTRAFACE_PRIORS[priorOffset + 3];

    const locationCenterX =
      Number(boxes[priorOffset] ?? 0) * ULTRAFACE_CENTER_VARIANCE * priorWidth +
      priorCenterX;
    const locationCenterY =
      Number(boxes[priorOffset + 1] ?? 0) *
        ULTRAFACE_CENTER_VARIANCE *
        priorHeight +
      priorCenterY;
    const locationWidth =
      Math.exp(Number(boxes[priorOffset + 2] ?? 0) * ULTRAFACE_SIZE_VARIANCE) *
      priorWidth;
    const locationHeight =
      Math.exp(Number(boxes[priorOffset + 3] ?? 0) * ULTRAFACE_SIZE_VARIANCE) *
      priorHeight;

    decoded[priorOffset] = locationCenterX - locationWidth / 2;
    decoded[priorOffset + 1] = locationCenterY - locationHeight / 2;
    decoded[priorOffset + 2] = locationCenterX + locationWidth / 2;
    decoded[priorOffset + 3] = locationCenterY + locationHeight / 2;
  }

  return decoded;
}

function hardNms(
  candidates: FaceCandidate[],
  iouThreshold: number,
  topK: number
): FaceCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const picked: FaceCandidate[] = [];

  while (sorted.length > 0) {
    const current = sorted.shift()!;
    picked.push(current);
    if (topK > 0 && picked.length >= topK) {
      break;
    }

    for (let index = sorted.length - 1; index >= 0; index -= 1) {
      if (intersectionOverUnion(sorted[index], current) > iouThreshold) {
        sorted.splice(index, 1);
      }
    }
  }

  return picked;
}

function intersectionOverUnion(a: FaceCandidate, b: FaceCandidate): number {
  const overlapLeft = Math.max(a.x1, b.x1);
  const overlapTop = Math.max(a.y1, b.y1);
  const overlapRight = Math.min(a.x2, b.x2);
  const overlapBottom = Math.min(a.y2, b.y2);
  const overlapWidth = Math.max(0, overlapRight - overlapLeft);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);
  const overlapArea = overlapWidth * overlapHeight;
  if (overlapArea <= 0) {
    return 0;
  }

  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  return overlapArea / Math.max(1e-6, areaA + areaB - overlapArea);
}

function interpolateMissingTrack(
  values: Array<number | null>,
  fallback: number
): number[] {
  if (values.length === 0) {
    return [fallback];
  }

  const resolved = [...values];
  const firstDefinedIndex = resolved.findIndex(value => value != null);
  if (firstDefinedIndex === -1) {
    return resolved.map(() => fallback);
  }

  for (let index = 0; index < firstDefinedIndex; index += 1) {
    resolved[index] = resolved[firstDefinedIndex];
  }

  let lastDefinedIndex = firstDefinedIndex;
  for (let index = firstDefinedIndex + 1; index < resolved.length; index += 1) {
    if (resolved[index] == null) {
      continue;
    }

    const previousValue = Number(resolved[lastDefinedIndex]);
    const nextValue = Number(resolved[index]);
    const gap = index - lastDefinedIndex;
    for (let cursor = 1; cursor < gap; cursor += 1) {
      const progress = cursor / gap;
      resolved[lastDefinedIndex + cursor] =
        previousValue + (nextValue - previousValue) * progress;
    }
    lastDefinedIndex = index;
  }

  for (let index = lastDefinedIndex + 1; index < resolved.length; index += 1) {
    resolved[index] = resolved[lastDefinedIndex];
  }

  return resolved.map(value => roundTo(Number(value ?? fallback), 3));
}

function smoothTrack(
  timeSeconds: number[],
  track: number[],
  cropWidth: number,
  maxX: number
): number[] {
  if (track.length <= 1) {
    return track.map(value => clamp(value, 0, maxX));
  }

  const smoothed = [clamp(track[0], 0, maxX)];

  for (let index = 1; index < track.length; index += 1) {
    const previous = smoothed[index - 1];
    const target = clamp(track[index], 0, maxX);
    const deltaTime = Math.max(
      0.001,
      timeSeconds[index] - timeSeconds[index - 1]
    );
    const maxDelta = Math.max(
      18,
      cropWidth * MAX_PAN_SPEED_MULTIPLIER * deltaTime
    );
    const blended = previous + (target - previous) * SMOOTHING_ALPHA;
    const limited = clamp(blended, previous - maxDelta, previous + maxDelta);
    smoothed.push(roundTo(clamp(limited, 0, maxX), 3));
  }

  return smoothed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  return roundTo(value, 3)
    .toFixed(3)
    .replace(/\.?0+$/, '');
}
