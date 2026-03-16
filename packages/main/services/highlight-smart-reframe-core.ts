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
const MIN_TRACK_CONFIDENCE = 0.74;
const STRONG_TRACK_CONFIDENCE = 0.9;
const MAX_CENTER_JUMP_RATIO = 0.32;
const LARGE_JUMP_CONFIRM_SAMPLES = 2;
const LARGE_JUMP_STABILITY_RATIO = 0.06;
const LARGE_JUMP_STABILITY_MIN_PX = 36;
const MEDIAN_FILTER_RADIUS = 1;
const MOVE_DWELL_SAMPLES = 2;
const CAMERA_QUANTIZE_PX = 8;
const LOCK_DEADZONE_RATIO = 0.09;
const LOCK_DEADZONE_MIN_PX = 40;
const IMMEDIATE_MOVE_MULTIPLIER = 2.4;
const STATIC_LOCK_RANGE_RATIO = 0.035;
const STATIC_LOCK_RANGE_MIN_PX = 16;
const CANDIDATE_TRACK_LIMIT = 4;
const TWO_FACE_FIT_MARGIN_RATIO = 0.92;
const SUBJECT_SWITCH_DISTANCE_RATIO = 0.18;
const SUBJECT_SWITCH_DISTANCE_MIN_PX = 42;
const SUBJECT_SWITCH_SCORE_MARGIN = 0.08;
const SUBJECT_SWITCH_DWELL_SAMPLES = 2;
const CANDIDATE_SCORE_WINDOW = 0.12;
const TRANSITION_HOLD_DELTA_RATIO = 0.03;
const TRANSITION_HOLD_DELTA_MIN_PX = 14;
const TRANSITION_INTERPOLATE_DELTA_RATIO = 0.34;
const TRANSITION_INTERPOLATE_DELTA_MIN_PX = 200;
const TRANSITION_SNAP_DELTA_RATIO = 0.58;
const TRANSITION_SNAP_DELTA_MIN_PX = 280;
const MOVE_DWELL_SECONDS = MOVE_DWELL_SAMPLES * SAMPLE_INTERVAL_SECONDS;

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
  candidates?: FaceCandidate[];
}

export interface ReframeKeyframe {
  timeSeconds: number;
  x: number;
}

type ReframeTransitionMode = 'hold' | 'interpolate' | 'snap';
type SubjectFramingMode = 'missing' | 'single' | 'midpoint';
type SubjectAwareSample = FaceTrackSample & {
  framingMode: SubjectFramingMode;
  committedSubjectSwitch: boolean;
  reacquiredAfterGap: boolean;
};

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

type RankedFaceCandidate = FaceCandidate & {
  centerX: number;
  rank: number;
};

function rankFaceCandidates(
  candidates: FaceCandidate[],
  sourceWidth: number,
  sourceHeight: number,
  previousCenterX: number | null
): RankedFaceCandidate[] {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const ranked = candidates
    .map(candidate => {
      const width = Math.max(1, candidate.x2 - candidate.x1);
      const height = Math.max(1, candidate.y2 - candidate.y1);
      const centerX = candidate.x1 + width / 2;
      const centerBias =
        1 -
        Math.min(1, Math.abs(centerX - sourceWidth / 2) / (sourceWidth / 2));
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

      return {
        ...candidate,
        centerX,
        rank,
      };
    })
    .sort((a, b) => b.rank - a.rank);

  return ranked;
}

export function pickPrimaryFaceCenterX(
  candidates: FaceCandidate[],
  sourceWidth: number,
  sourceHeight: number,
  previousCenterX: number | null
): { centerX: number; confidence: number } | null {
  const ranked = rankFaceCandidates(
    candidates,
    sourceWidth,
    sourceHeight,
    previousCenterX
  );
  if (ranked.length === 0) {
    return null;
  }
  return {
    centerX: ranked[0].centerX,
    confidence: ranked[0].score,
  };
}

function toTrackFaceCandidates(
  sample: FaceTrackSample,
  sourceWidth: number,
  sourceHeight: number,
  previousCenterX: number | null
): RankedFaceCandidate[] {
  const rawCandidates = Array.isArray(sample.candidates)
    ? sample.candidates
    : [];
  if (rawCandidates.length > 0) {
    const ranked = rankFaceCandidates(
      rawCandidates,
      sourceWidth,
      sourceHeight,
      previousCenterX
    );
    if (ranked.length === 0) {
      return [];
    }
    const scoreFloor = Math.max(
      MIN_TRACK_CONFIDENCE,
      ranked[0].score - CANDIDATE_SCORE_WINDOW
    );
    return ranked
      .filter(candidate => candidate.score >= scoreFloor)
      .slice(0, CANDIDATE_TRACK_LIMIT);
  }

  if (
    sample.centerX == null ||
    !Number.isFinite(sample.centerX) ||
    !Number.isFinite(sample.confidence) ||
    sample.confidence < MIN_TRACK_CONFIDENCE
  ) {
    return [];
  }

  const syntheticWidth = Math.max(80, sourceWidth * 0.16);
  const syntheticHeight = Math.max(100, sourceHeight * 0.2);
  const safeCenterX = clamp(sample.centerX, 0, sourceWidth);
  const x1 = clamp(safeCenterX - syntheticWidth / 2, 0, sourceWidth);
  const x2 = clamp(safeCenterX + syntheticWidth / 2, 0, sourceWidth);
  const y1 = clamp(sourceHeight * 0.2, 0, sourceHeight);
  const y2 = clamp(y1 + syntheticHeight, 0, sourceHeight);
  return rankFaceCandidates(
    [{ x1, y1, x2, y2, score: clamp(sample.confidence, 0, 1) }],
    sourceWidth,
    sourceHeight,
    previousCenterX
  );
}

function canFitTwoFacesInCrop(
  a: FaceCandidate,
  b: FaceCandidate,
  cropWidth: number
): boolean {
  const combinedWidth = Math.max(a.x2, b.x2) - Math.min(a.x1, b.x1);
  return combinedWidth <= cropWidth * TWO_FACE_FIT_MARGIN_RATIO;
}

function pickClosestCandidate(
  candidates: RankedFaceCandidate[],
  centerX: number
): RankedFaceCandidate {
  let closest = candidates[0];
  let smallestDistance = Math.abs(candidates[0].centerX - centerX);
  for (let index = 1; index < candidates.length; index += 1) {
    const distance = Math.abs(candidates[index].centerX - centerX);
    if (distance < smallestDistance) {
      closest = candidates[index];
      smallestDistance = distance;
    }
  }
  return closest;
}

function shouldSwitchCommittedSubject({
  currentCenterX,
  currentScore,
  targetCenterX,
  targetScore,
  cropWidth,
}: {
  currentCenterX: number;
  currentScore: number;
  targetCenterX: number;
  targetScore: number;
  cropWidth: number;
}): boolean {
  const distanceThreshold = Math.max(
    SUBJECT_SWITCH_DISTANCE_MIN_PX,
    cropWidth * SUBJECT_SWITCH_DISTANCE_RATIO
  );
  const distance = Math.abs(targetCenterX - currentCenterX);
  return (
    distance >= distanceThreshold &&
    targetScore >= currentScore + SUBJECT_SWITCH_SCORE_MARGIN
  );
}

function buildSubjectAwareSamples({
  samples,
  sourceWidth,
  sourceHeight,
  cropWidth,
}: {
  samples: FaceTrackSample[];
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
}): SubjectAwareSample[] {
  let committedCenterX: number | null = null;
  let pendingSwitchCenterX: number | null = null;
  let pendingSwitchCount = 0;
  let hadMissingSample = false;

  return samples.map(sample => {
    const rankedCandidates = toTrackFaceCandidates(
      sample,
      sourceWidth,
      sourceHeight,
      committedCenterX
    );
    if (rankedCandidates.length === 0) {
      hadMissingSample = true;
      pendingSwitchCenterX = null;
      pendingSwitchCount = 0;
      return {
        ...sample,
        centerX: null,
        confidence: 0,
        candidates: [],
        framingMode: 'missing',
        committedSubjectSwitch: false,
        reacquiredAfterGap: false,
      };
    }

    const reacquiredAfterGap = hadMissingSample;
    hadMissingSample = false;
    const strongest = rankedCandidates[0];
    const secondary = rankedCandidates[1] ?? null;
    const twoStrongFaces =
      secondary != null &&
      strongest.score >= MIN_TRACK_CONFIDENCE &&
      secondary.score >= MIN_TRACK_CONFIDENCE;
    const twoFaceMidpointAllowed =
      twoStrongFaces && canFitTwoFacesInCrop(strongest, secondary, cropWidth);

    if (twoFaceMidpointAllowed && secondary) {
      const midpointCenter = clamp(
        roundTo((strongest.centerX + secondary.centerX) / 2, 3),
        0,
        sourceWidth
      );
      committedCenterX = midpointCenter;
      pendingSwitchCenterX = null;
      pendingSwitchCount = 0;
      return {
        ...sample,
        centerX: midpointCenter,
        confidence: Math.max(strongest.score, secondary.score),
        candidates: rankedCandidates,
        framingMode: 'midpoint',
        committedSubjectSwitch: false,
        reacquiredAfterGap,
      };
    }

    let chosen = strongest;
    let committedSubjectSwitch = false;
    if (twoStrongFaces && committedCenterX != null) {
      const stayCandidate = pickClosestCandidate(
        rankedCandidates,
        committedCenterX
      );
      const switchCandidate = strongest;
      if (
        stayCandidate !== switchCandidate &&
        shouldSwitchCommittedSubject({
          currentCenterX: stayCandidate.centerX,
          currentScore: stayCandidate.score,
          targetCenterX: switchCandidate.centerX,
          targetScore: switchCandidate.score,
          cropWidth,
        })
      ) {
        const switchPendingThreshold = Math.max(24, cropWidth * 0.06);
        if (
          pendingSwitchCenterX != null &&
          Math.abs(pendingSwitchCenterX - switchCandidate.centerX) <=
            switchPendingThreshold
        ) {
          pendingSwitchCount += 1;
        } else {
          pendingSwitchCenterX = switchCandidate.centerX;
          pendingSwitchCount = 1;
        }
        if (pendingSwitchCount >= SUBJECT_SWITCH_DWELL_SAMPLES) {
          chosen = switchCandidate;
          committedSubjectSwitch = true;
          pendingSwitchCenterX = null;
          pendingSwitchCount = 0;
        } else {
          chosen = stayCandidate;
        }
      } else {
        chosen = stayCandidate;
        pendingSwitchCenterX = null;
        pendingSwitchCount = 0;
      }
    } else {
      pendingSwitchCenterX = null;
      pendingSwitchCount = 0;
    }

    committedCenterX = clamp(chosen.centerX, 0, sourceWidth);
    return {
      ...sample,
      centerX: committedCenterX,
      confidence: chosen.score,
      candidates: rankedCandidates,
      framingMode: 'single',
      committedSubjectSwitch,
      reacquiredAfterGap,
    };
  });
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
  const subjectAwareSamples = buildSubjectAwareSamples({
    samples: normalizedSamples,
    sourceWidth,
    sourceHeight,
    cropWidth,
  });

  const filteredCenterTrack = filterFaceCenterTrack(
    subjectAwareSamples,
    sourceWidth
  );
  const rawTrack = filteredCenterTrack.map(centerX =>
    centerX == null ? null : clamp(centerX - cropWidth / 2, 0, maxX)
  );
  const denoisedTrack = medianFilterNullable(rawTrack, MEDIAN_FILTER_RADIUS);
  const filledTrack = fillMissingTrackWithHold(denoisedTrack, fallbackX);
  const quantizedTrack = quantizeTrack(filledTrack, CAMERA_QUANTIZE_PX, maxX);
  const staticLockRange = Math.max(
    STATIC_LOCK_RANGE_MIN_PX,
    cropWidth * STATIC_LOCK_RANGE_RATIO
  );
  const staticLockPosition = pickStaticLockPosition(quantizedTrack, maxX);
  const sampleTimeTrack = subjectAwareSamples.map(sample => sample.timeSeconds);
  const cameraTrack =
    computeRange(quantizedTrack) <= staticLockRange
      ? Array.from({ length: quantizedTrack.length }, () => staticLockPosition)
      : buildCameraTrackWithHysteresis({
          targetTrack: quantizedTrack,
          timeTrack: sampleTimeTrack,
          cropWidth,
          maxX,
        });

  const keyframes = subjectAwareSamples.map((sample, index) => ({
    timeSeconds: roundTo(sample.timeSeconds, 3),
    x: roundTo(cameraTrack[index], 3),
  }));
  const transitionModes = buildReframeTransitionModes({
    keyframes,
    cropWidth,
    samples: subjectAwareSamples,
  });
  const detectedSamples = subjectAwareSamples.filter(
    sample => sample.centerX != null
  ).length;

  return {
    cropWidth,
    cropHeight,
    keyframes,
    xExpression: buildPiecewiseLinearExpression(keyframes, transitionModes),
    strategy: detectedSamples > 0 ? 'tracked-face' : 'center',
    sampleCount: subjectAwareSamples.length,
    detectedSamples,
  };
}

function buildReframeTransitionModes({
  keyframes,
  cropWidth,
  samples,
}: {
  keyframes: ReadonlyArray<ReframeKeyframe>;
  cropWidth: number;
  samples?: ReadonlyArray<SubjectAwareSample>;
}): ReframeTransitionMode[] {
  if (keyframes.length < 2) return [];
  const holdDeltaThreshold = Math.max(
    TRANSITION_HOLD_DELTA_MIN_PX,
    cropWidth * TRANSITION_HOLD_DELTA_RATIO
  );
  const interpolateDeltaThreshold = Math.max(
    TRANSITION_INTERPOLATE_DELTA_MIN_PX,
    cropWidth * TRANSITION_INTERPOLATE_DELTA_RATIO
  );
  const snapDeltaThreshold = Math.max(
    TRANSITION_SNAP_DELTA_MIN_PX,
    cropWidth * TRANSITION_SNAP_DELTA_RATIO
  );

  const modes: ReframeTransitionMode[] = [];
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const current = keyframes[index];
    const next = keyframes[index + 1];
    const currentSample = samples?.[index];
    const nextSample = samples?.[index + 1];
    const delta = Math.abs(next.x - current.x);
    const duration = next.timeSeconds - current.timeSeconds;
    if (
      !Number.isFinite(delta) ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      modes.push('snap');
      continue;
    }
    if (delta <= holdDeltaThreshold) {
      modes.push('hold');
      continue;
    }
    const framingChanged =
      currentSample != null &&
      nextSample != null &&
      currentSample.framingMode !== nextSample.framingMode &&
      currentSample.framingMode !== 'missing' &&
      nextSample.framingMode !== 'missing';
    const hardTransition =
      Boolean(nextSample?.committedSubjectSwitch) ||
      Boolean(nextSample?.reacquiredAfterGap) ||
      framingChanged;

    if (
      hardTransition ||
      ((currentSample == null || nextSample == null) &&
        delta >= snapDeltaThreshold)
    ) {
      modes.push('snap');
      continue;
    }
    if (delta < interpolateDeltaThreshold) {
      modes.push('hold');
      continue;
    }
    modes.push('interpolate');
  }
  return modes;
}

function buildInterpolatedSegmentExpression(
  current: ReframeKeyframe,
  next: ReframeKeyframe
): string {
  const duration = next.timeSeconds - current.timeSeconds;
  if (!Number.isFinite(duration) || duration <= 0) {
    return formatNumber(current.x);
  }
  const slope = (next.x - current.x) / duration;
  if (!Number.isFinite(slope) || Math.abs(slope) < 0.0001) {
    return formatNumber(current.x);
  }
  const currentX = formatNumber(current.x);
  const currentTime = formatNumber(current.timeSeconds);
  const slopeText = formatNumber(slope);
  const interpolated = `${currentX}+(${slopeText})*(t-${currentTime})`;
  return `if(lt(t,${currentTime}),${currentX},${interpolated})`;
}

export function buildPiecewiseLinearExpression(
  keyframes: ReadonlyArray<ReframeKeyframe>,
  transitionModes?: ReadonlyArray<ReframeTransitionMode>
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
    const mode = transitionModes?.[index] ?? 'interpolate';
    const segmentExpression =
      mode === 'interpolate'
        ? buildInterpolatedSegmentExpression(current, next)
        : formatNumber(current.x);
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

function filterFaceCenterTrack(
  samples: FaceTrackSample[],
  sourceWidth: number
): Array<number | null> {
  const maxCenterJumpPx = Math.max(80, sourceWidth * MAX_CENTER_JUMP_RATIO);
  const jumpStabilityThreshold = Math.max(
    LARGE_JUMP_STABILITY_MIN_PX,
    sourceWidth * LARGE_JUMP_STABILITY_RATIO
  );
  let previousAcceptedCenter: number | null = null;
  let pendingJumpCenter: number | null = null;
  let pendingJumpCount = 0;

  return samples.map(sample => {
    if (sample.centerX == null || !Number.isFinite(sample.centerX)) {
      pendingJumpCenter = null;
      pendingJumpCount = 0;
      return null;
    }

    const confidence = Number(sample.confidence ?? 0);
    if (confidence < MIN_TRACK_CONFIDENCE) {
      pendingJumpCenter = null;
      pendingJumpCount = 0;
      return null;
    }

    const normalizedCenter = clamp(sample.centerX, 0, sourceWidth);
    if (
      previousAcceptedCenter != null &&
      Math.abs(normalizedCenter - previousAcceptedCenter) > maxCenterJumpPx &&
      confidence < STRONG_TRACK_CONFIDENCE
    ) {
      if (
        pendingJumpCenter != null &&
        Math.abs(normalizedCenter - pendingJumpCenter) <= jumpStabilityThreshold
      ) {
        pendingJumpCount += 1;
      } else {
        pendingJumpCenter = normalizedCenter;
        pendingJumpCount = 1;
      }

      if (pendingJumpCount >= LARGE_JUMP_CONFIRM_SAMPLES) {
        previousAcceptedCenter = normalizedCenter;
        pendingJumpCenter = null;
        pendingJumpCount = 0;
        return normalizedCenter;
      }
      return null;
    }

    pendingJumpCenter = null;
    pendingJumpCount = 0;
    previousAcceptedCenter = normalizedCenter;
    return normalizedCenter;
  });
}

function medianFilterNullable(
  values: Array<number | null>,
  radius: number
): Array<number | null> {
  if (values.length === 0 || radius <= 0) {
    return [...values];
  }

  const lastIndex = values.length - 1;
  return values.map((value, index) => {
    if (value == null) {
      return null;
    }

    const windowValues: number[] = [];
    const start = Math.max(0, index - radius);
    const end = Math.min(lastIndex, index + radius);
    for (let cursor = start; cursor <= end; cursor += 1) {
      const candidate = values[cursor];
      if (candidate == null) continue;
      windowValues.push(candidate);
    }

    if (windowValues.length === 0) {
      return value;
    }

    windowValues.sort((a, b) => a - b);
    const midpoint = Math.floor(windowValues.length / 2);
    return windowValues.length % 2 === 1
      ? windowValues[midpoint]
      : (windowValues[midpoint - 1] + windowValues[midpoint]) / 2;
  });
}

function fillMissingTrackWithHold(
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

  for (let index = firstDefinedIndex + 1; index < resolved.length; index += 1) {
    if (resolved[index] == null) {
      resolved[index] = resolved[index - 1];
    }
  }

  return resolved.map(value => roundTo(Number(value ?? fallback), 3));
}

function quantizeTrack(
  values: number[],
  stepPx: number,
  maxX: number
): number[] {
  return values.map(value => quantizeValue(value, stepPx, maxX));
}

function quantizeValue(value: number, stepPx: number, maxX: number): number {
  const clamped = clamp(value, 0, maxX);
  if (stepPx <= 1) {
    return roundTo(clamped, 3);
  }
  return roundTo(clamp(Math.round(clamped / stepPx) * stepPx, 0, maxX), 3);
}

function computeRange(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  let min = values[0];
  let max = values[0];
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min;
}

function pickStaticLockPosition(track: number[], maxX: number): number {
  if (track.length === 0) {
    return 0;
  }

  const sorted = [...track].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  const centerValue =
    sorted.length % 2 === 1
      ? sorted[midpoint]
      : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  return quantizeValue(centerValue, CAMERA_QUANTIZE_PX, maxX);
}

function buildCameraTrackWithHysteresis({
  targetTrack,
  timeTrack,
  cropWidth,
  maxX,
}: {
  targetTrack: number[];
  timeTrack: number[];
  cropWidth: number;
  maxX: number;
}): number[] {
  if (targetTrack.length <= 1) {
    return targetTrack.map(value =>
      quantizeValue(value, CAMERA_QUANTIZE_PX, maxX)
    );
  }

  const deadzone = Math.max(
    LOCK_DEADZONE_MIN_PX,
    cropWidth * LOCK_DEADZONE_RATIO
  );
  const immediateMoveThreshold = deadzone * IMMEDIATE_MOVE_MULTIPLIER;
  const cameraTrack = [quantizeValue(targetTrack[0], CAMERA_QUANTIZE_PX, maxX)];
  let pendingDirection: -1 | 0 | 1 = 0;
  let pendingElapsedSeconds = 0;

  for (let index = 1; index < targetTrack.length; index += 1) {
    const previous = cameraTrack[index - 1];
    const target = quantizeValue(targetTrack[index], CAMERA_QUANTIZE_PX, maxX);
    const delta = target - previous;
    const absDelta = Math.abs(delta);
    const rawStepSeconds = timeTrack[index] - timeTrack[index - 1];
    const stepSeconds =
      Number.isFinite(rawStepSeconds) && rawStepSeconds > 0
        ? rawStepSeconds
        : SAMPLE_INTERVAL_SECONDS;

    if (absDelta <= deadzone) {
      pendingDirection = 0;
      pendingElapsedSeconds = 0;
      cameraTrack.push(previous);
      continue;
    }

    const direction: -1 | 1 = delta > 0 ? 1 : -1;
    if (absDelta >= immediateMoveThreshold) {
      cameraTrack.push(target);
      pendingDirection = 0;
      pendingElapsedSeconds = 0;
      continue;
    }

    if (pendingDirection !== direction) {
      pendingDirection = direction;
      pendingElapsedSeconds = stepSeconds;
    } else {
      pendingElapsedSeconds += stepSeconds;
    }

    const isLastSample = index === targetTrack.length - 1;
    if (pendingElapsedSeconds < MOVE_DWELL_SECONDS && !isLastSample) {
      cameraTrack.push(previous);
      continue;
    }

    cameraTrack.push(target);
    pendingDirection = 0;
    pendingElapsedSeconds = 0;
  }

  return cameraTrack;
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
