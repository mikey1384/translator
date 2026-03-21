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
const SAMPLE_INTERVAL_SECONDS = 0.2;
const EDGE_SAMPLE_PADDING_SECONDS = 0.18;
const MIN_TRACK_CONFIDENCE = 0.74;
const WEAK_VISIBLE_ANCHOR_CONFIDENCE = 0.72;
const STRONG_TRACK_CONFIDENCE = 0.9;
const MAX_CENTER_JUMP_RATIO = 0.32;
const LARGE_JUMP_CONFIRM_SAMPLES = 2;
const LARGE_JUMP_STABILITY_RATIO = 0.06;
const LARGE_JUMP_STABILITY_MIN_PX = 36;
const MEDIAN_FILTER_RADIUS = 1;
const MEDIAN_HARD_BOUNDARY_RATIO = 0.58;
const MEDIAN_HARD_BOUNDARY_MIN_PX = 280;
const DESTINATION_LOOKAHEAD_SECONDS = 1.4;
const CAMERA_QUANTIZE_PX = 8;
const LOCK_DEADZONE_RATIO = 0.18;
const LOCK_DEADZONE_MIN_PX = 80;
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
const MIDPOINT_BALANCE_SCORE_MARGIN = 0.03;
const MIDPOINT_BALANCE_AREA_RATIO = 1.35;
const MIDPOINT_BALANCE_SCORE_MARGIN_PERSIST = 0.05;
const MIDPOINT_BALANCE_AREA_RATIO_PERSIST = 1.5;
const OPENING_STABLE_RANGE_RATIO = 0.045;
const OPENING_STABLE_RANGE_MIN_PX = 24;
const OPENING_OUTLIER_DELTA_RATIO = 0.2;
const OPENING_OUTLIER_DELTA_MIN_PX = 96;
const OPENING_CONFIRMATION_SAMPLE_COUNT = 3;
const TRANSIENT_MIDPOINT_CONFIRMATION_SAMPLE_COUNT = 2;
const TRANSIENT_MISSING_CONFIRMATION_SAMPLE_COUNT = 2;
const TRANSIENT_MISSING_MAX_SECONDS = 1.4;
const TRANSIENT_LOCK_MAX_SECONDS = 1.4;
const TRANSIENT_LOCK_VICINITY_RATIO = 0.33;
const TRANSIENT_LOCK_VICINITY_MIN_PX = 120;
const SHOT_START_CONFIRMATION_SAMPLE_COUNT = 2;
const SHOT_START_BACKFILL_MAX_SECONDS = 0.6;
const MOVE_DWELL_SECONDS = 1.3;

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
  shotId?: number;
}

export interface ReframeKeyframe {
  timeSeconds: number;
  x: number;
}

export interface VerticalReframeDecisionSample {
  timeSeconds: number;
  shotId: number | null;
  startsNewShot: boolean;
  framingMode: SubjectFramingMode;
  detectedCenterX: number | null;
  confidence: number;
  candidateCenters: number[];
  targetX: number;
  rawCameraX: number;
  finalCameraX: number;
  decision: string;
  committedSubjectSwitch: boolean;
  reacquiredAfterGap: boolean;
  usesWeakVisibleAnchor: boolean;
  cleanupAdjusted: boolean;
}

type SubjectFramingMode = 'missing' | 'single' | 'midpoint';
type SubjectAwareSample = FaceTrackSample & {
  framingMode: SubjectFramingMode;
  committedSubjectSwitch: boolean;
  reacquiredAfterGap: boolean;
  usesWeakVisibleAnchor: boolean;
  startsNewShot: boolean;
};

export interface VerticalReframePlan {
  cropWidth: number;
  cropHeight: number;
  keyframes: ReframeKeyframe[];
  xExpression: string;
  strategy: 'tracked-face' | 'center';
  sampleCount: number;
  detectedSamples: number;
  debugTrace: VerticalReframeDecisionSample[];
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

  const sampleCount = Math.max(
    MIN_SAMPLE_COUNT,
    Math.round(durationSeconds / SAMPLE_INTERVAL_SECONDS) + 1
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
          ? 1
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

function pickWeakVisibleAnchorCandidate(
  sample: FaceTrackSample,
  sourceWidth: number,
  sourceHeight: number,
  previousCenterX: number | null
): RankedFaceCandidate | null {
  const rawCandidates = Array.isArray(sample.candidates)
    ? sample.candidates
    : [];
  if (rawCandidates.length === 0) {
    return null;
  }

  const ranked = rankFaceCandidates(
    rawCandidates,
    sourceWidth,
    sourceHeight,
    previousCenterX
  );
  const strongest = ranked[0];
  if (!strongest || strongest.score < WEAK_VISIBLE_ANCHOR_CONFIDENCE) {
    return null;
  }

  return strongest;
}

function canFitTwoFacesInCrop(
  a: FaceCandidate,
  b: FaceCandidate,
  cropWidth: number
): boolean {
  const combinedWidth = Math.max(a.x2, b.x2) - Math.min(a.x1, b.x1);
  return combinedWidth <= cropWidth * TWO_FACE_FIT_MARGIN_RATIO;
}

function computeFaceArea(candidate: FaceCandidate): number {
  return (
    Math.max(1, candidate.x2 - candidate.x1) *
    Math.max(1, candidate.y2 - candidate.y1)
  );
}

function shouldUseMidpointFraming({
  strongest,
  secondary,
  previousFramingMode,
}: {
  strongest: RankedFaceCandidate;
  secondary: RankedFaceCandidate;
  previousFramingMode: SubjectFramingMode;
}): boolean {
  const scoreMargin =
    previousFramingMode === 'midpoint'
      ? MIDPOINT_BALANCE_SCORE_MARGIN_PERSIST
      : MIDPOINT_BALANCE_SCORE_MARGIN;
  const areaRatioLimit =
    previousFramingMode === 'midpoint'
      ? MIDPOINT_BALANCE_AREA_RATIO_PERSIST
      : MIDPOINT_BALANCE_AREA_RATIO;
  const scoreGap = Math.max(0, strongest.score - secondary.score);
  if (scoreGap > scoreMargin) {
    return false;
  }

  const strongestArea = computeFaceArea(strongest);
  const secondaryArea = computeFaceArea(secondary);
  const areaRatio =
    Math.max(strongestArea, secondaryArea) /
    Math.max(1, Math.min(strongestArea, secondaryArea));
  return areaRatio <= areaRatioLimit;
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

function shouldAdoptWeakVisibleAnchor({
  committedCenterX,
  candidateCenterX,
  cropWidth,
  reacquiredAfterGap,
}: {
  committedCenterX: number | null;
  candidateCenterX: number;
  cropWidth: number;
  reacquiredAfterGap: boolean;
}): boolean {
  if (reacquiredAfterGap) {
    return true;
  }
  if (committedCenterX == null) {
    return false;
  }

  const distanceThreshold = Math.max(
    SUBJECT_SWITCH_DISTANCE_MIN_PX,
    cropWidth * SUBJECT_SWITCH_DISTANCE_RATIO
  );
  return Math.abs(candidateCenterX - committedCenterX) >= distanceThreshold;
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
  let committedFramingMode: SubjectFramingMode = 'missing';
  let pendingSwitchCenterX: number | null = null;
  let pendingSwitchCount = 0;
  let hadMissingSample = false;
  let previousShotId: number | null = null;

  return samples.map((sample, index) => {
    const startsNewShot =
      index === 0 ||
      (sample.shotId != null &&
        previousShotId != null &&
        sample.shotId !== previousShotId);
    if (startsNewShot) {
      committedCenterX = null;
      committedFramingMode = 'missing';
      pendingSwitchCenterX = null;
      pendingSwitchCount = 0;
      hadMissingSample = false;
    }
    const rankingPreviousCenter = startsNewShot ? null : committedCenterX;
    previousShotId = sample.shotId ?? previousShotId;
    const reacquiredAfterGap = hadMissingSample;
    const rankedCandidates = toTrackFaceCandidates(
      sample,
      sourceWidth,
      sourceHeight,
      rankingPreviousCenter
    );
    const weakVisibleAnchor = pickWeakVisibleAnchorCandidate(
      sample,
      sourceWidth,
      sourceHeight,
      rankingPreviousCenter
    );
    if (rankedCandidates.length === 0) {
      if (
        weakVisibleAnchor &&
        shouldAdoptWeakVisibleAnchor({
          committedCenterX,
          candidateCenterX: weakVisibleAnchor.centerX,
          cropWidth,
          reacquiredAfterGap,
        })
      ) {
        const distanceThreshold = Math.max(
          SUBJECT_SWITCH_DISTANCE_MIN_PX,
          cropWidth * SUBJECT_SWITCH_DISTANCE_RATIO
        );
        const committedSubjectSwitch =
          committedCenterX != null &&
          Math.abs(weakVisibleAnchor.centerX - committedCenterX) >=
            distanceThreshold;
        committedCenterX = clamp(weakVisibleAnchor.centerX, 0, sourceWidth);
        committedFramingMode = 'single';
        pendingSwitchCenterX = null;
        pendingSwitchCount = 0;
        hadMissingSample = false;
        return {
          ...sample,
          centerX: committedCenterX,
          confidence: weakVisibleAnchor.score,
          candidates: [weakVisibleAnchor],
          framingMode: 'single',
          committedSubjectSwitch,
          reacquiredAfterGap,
          usesWeakVisibleAnchor: true,
          startsNewShot,
        };
      }

      hadMissingSample = true;
      committedFramingMode = 'missing';
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
        usesWeakVisibleAnchor: false,
        startsNewShot,
      };
    }

    hadMissingSample = false;
    const strongest = rankedCandidates[0];
    const secondary = rankedCandidates[1] ?? null;
    const twoStrongFaces =
      secondary != null &&
      strongest.score >= MIN_TRACK_CONFIDENCE &&
      secondary.score >= MIN_TRACK_CONFIDENCE;
    const twoFaceMidpointAllowed =
      twoStrongFaces &&
      canFitTwoFacesInCrop(strongest, secondary, cropWidth) &&
      shouldUseMidpointFraming({
        strongest,
        secondary,
        previousFramingMode: committedFramingMode,
      });

    if (twoFaceMidpointAllowed && secondary) {
      const midpointCenter = clamp(
        roundTo((strongest.centerX + secondary.centerX) / 2, 3),
        0,
        sourceWidth
      );
      committedCenterX = midpointCenter;
      committedFramingMode = 'midpoint';
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
        usesWeakVisibleAnchor: false,
        startsNewShot,
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
    committedFramingMode = 'single';
    return {
      ...sample,
      centerX: committedCenterX,
      confidence: chosen.score,
      candidates: rankedCandidates,
      framingMode: 'single',
      committedSubjectSwitch,
      reacquiredAfterGap,
      usesWeakVisibleAnchor: false,
      startsNewShot,
    };
  });
}

export function buildVerticalReframePlan({
  sourceWidth,
  sourceHeight,
  durationSeconds,
  samples,
  includeDebugTrace = false,
}: {
  sourceWidth: number;
  sourceHeight: number;
  durationSeconds: number;
  samples: FaceTrackSample[];
  includeDebugTrace?: boolean;
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
  const shotSegmentIds = buildShotSegmentIds(subjectAwareSamples);

  const filteredCenterTrack = filterFaceCenterTrack(
    subjectAwareSamples,
    sourceWidth
  );
  const rawTrack = filteredCenterTrack.map(centerX =>
    centerX == null ? null : clamp(centerX - cropWidth / 2, 0, maxX)
  );
  const medianFilterSegments = buildMedianFilterSegments({
    track: rawTrack,
    cropWidth,
    samples: subjectAwareSamples,
  });
  const denoisedTrack = medianFilterNullable(
    rawTrack,
    MEDIAN_FILTER_RADIUS,
    medianFilterSegments
  );
  const filledTrack = fillMissingTrackWithHold(denoisedTrack, fallbackX);
  const quantizedTrack = quantizeTrack(filledTrack, CAMERA_QUANTIZE_PX, maxX);
  const missingResolvedTrack = resolveTransientMissingRuns({
    track: quantizedTrack,
    samples: subjectAwareSamples,
    cropWidth,
    maxX,
  });
  const midpointResolvedTrack = resolveTransientMidpointRuns({
    track: missingResolvedTrack,
    samples: subjectAwareSamples,
    cropWidth,
    maxX,
  });
  const openingStabilizedTrack = stabilizeOpeningTrack({
    track: midpointResolvedTrack,
    cropWidth,
    maxX,
  });
  const sampleTimeTrack = subjectAwareSamples.map(sample => sample.timeSeconds);
  const shotStartResolvedTrack = resolveShotStartTrack({
    track: openingStabilizedTrack,
    timeTrack: sampleTimeTrack,
    samples: subjectAwareSamples,
    cropWidth,
    maxX,
  });
  const staticLockRange = Math.max(
    STATIC_LOCK_RANGE_MIN_PX,
    cropWidth * STATIC_LOCK_RANGE_RATIO
  );
  const staticLockPosition = pickStaticLockPosition(
    shotStartResolvedTrack,
    maxX
  );
  const rawCameraTrackResult =
    computeRange(shotStartResolvedTrack) <= staticLockRange
      ? {
          track: Array.from(
            { length: shotStartResolvedTrack.length },
            () => staticLockPosition
          ),
          decisionReasons: Array.from(
            { length: shotStartResolvedTrack.length },
            (_, index) =>
              index === 0 ? 'start-static-lock' : 'hold-static-lock'
          ),
        }
      : buildCameraTrackWithHysteresis({
          targetTrack: shotStartResolvedTrack,
          timeTrack: sampleTimeTrack,
          cropWidth,
          maxX,
          segmentIds: medianFilterSegments,
        });
  const cameraTrack = resolveTransientLockRuns({
    track: rawCameraTrackResult.track,
    timeTrack: sampleTimeTrack,
    cropWidth,
    segmentIds: shotSegmentIds,
  });

  const keyframes = subjectAwareSamples.map((sample, index) => ({
    timeSeconds: roundTo(sample.timeSeconds, 3),
    x: roundTo(cameraTrack[index], 3),
  }));
  const detectedSamples = subjectAwareSamples.filter(
    sample => sample.centerX != null
  ).length;

  return {
    cropWidth,
    cropHeight,
    keyframes,
    xExpression: buildPiecewiseLinearExpression(keyframes),
    strategy: detectedSamples > 0 ? 'tracked-face' : 'center',
    sampleCount: subjectAwareSamples.length,
    detectedSamples,
    debugTrace: includeDebugTrace
      ? subjectAwareSamples.map((sample, index) => ({
          timeSeconds: roundTo(sample.timeSeconds, 3),
          shotId: sample.shotId ?? null,
          startsNewShot: sample.startsNewShot,
          framingMode: sample.framingMode,
          detectedCenterX:
            sample.centerX == null ? null : roundTo(sample.centerX, 3),
          confidence: roundTo(sample.confidence, 3),
          candidateCenters: (sample.candidates ?? [])
            .map(candidate => roundTo((candidate.x1 + candidate.x2) / 2, 3))
            .slice(0, CANDIDATE_TRACK_LIMIT),
          targetX: roundTo(shotStartResolvedTrack[index], 3),
          rawCameraX: roundTo(rawCameraTrackResult.track[index], 3),
          finalCameraX: roundTo(cameraTrack[index], 3),
          decision:
            rawCameraTrackResult.decisionReasons[index] ??
            (index === 0 ? 'start' : 'hold'),
          committedSubjectSwitch: sample.committedSubjectSwitch,
          reacquiredAfterGap: sample.reacquiredAfterGap,
          usesWeakVisibleAnchor: sample.usesWeakVisibleAnchor,
          cleanupAdjusted:
            rawCameraTrackResult.track[index] !== cameraTrack[index],
        }))
      : [],
  };
}

export function buildPiecewiseLinearExpression(
  keyframes: ReadonlyArray<ReframeKeyframe>
): string {
  if (keyframes.length === 0) {
    return '0';
  }
  const compactKeyframes = keyframes.filter(
    (keyframe, index) => index === 0 || keyframe.x !== keyframes[index - 1].x
  );

  if (compactKeyframes.length === 1) {
    return formatNumber(compactKeyframes[0].x);
  }

  let expression = formatNumber(
    compactKeyframes[compactKeyframes.length - 1].x
  );
  for (let index = compactKeyframes.length - 2; index >= 0; index -= 1) {
    const next = compactKeyframes[index + 1];
    expression = `if(lt(t,${formatNumber(next.timeSeconds)}),${formatNumber(compactKeyframes[index].x)},${expression})`;
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
    const usesWeakVisibleAnchor =
      'usesWeakVisibleAnchor' in sample &&
      sample.usesWeakVisibleAnchor === true;
    const committedSubjectSwitch =
      'committedSubjectSwitch' in sample &&
      sample.committedSubjectSwitch === true;
    const reacquiredAfterGap =
      'reacquiredAfterGap' in sample && sample.reacquiredAfterGap === true;
    const meetsTrackConfidence =
      confidence >= MIN_TRACK_CONFIDENCE ||
      (usesWeakVisibleAnchor && confidence >= WEAK_VISIBLE_ANCHOR_CONFIDENCE);
    if (!meetsTrackConfidence) {
      pendingJumpCenter = null;
      pendingJumpCount = 0;
      return null;
    }

    const normalizedCenter = clamp(sample.centerX, 0, sourceWidth);
    if (
      previousAcceptedCenter != null &&
      Math.abs(normalizedCenter - previousAcceptedCenter) > maxCenterJumpPx &&
      confidence < STRONG_TRACK_CONFIDENCE &&
      !committedSubjectSwitch &&
      !reacquiredAfterGap &&
      !usesWeakVisibleAnchor
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
  radius: number,
  segmentIds?: ReadonlyArray<number>
): Array<number | null> {
  if (values.length === 0 || radius <= 0) {
    return [...values];
  }

  const lastIndex = values.length - 1;
  return values.map((value, index) => {
    if (value == null) {
      return null;
    }

    const segmentId = segmentIds?.[index] ?? 0;
    const windowValues: number[] = [];
    const start = Math.max(0, index - radius);
    const end = Math.min(lastIndex, index + radius);
    for (let cursor = start; cursor <= end; cursor += 1) {
      if ((segmentIds?.[cursor] ?? 0) !== segmentId) {
        continue;
      }
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

function buildMedianFilterSegments({
  track,
  cropWidth,
  samples,
}: {
  track: ReadonlyArray<number | null>;
  cropWidth: number;
  samples: ReadonlyArray<SubjectAwareSample>;
}): number[] {
  if (track.length === 0) {
    return [];
  }

  const hardBoundaryThreshold = Math.max(
    MEDIAN_HARD_BOUNDARY_MIN_PX,
    cropWidth * MEDIAN_HARD_BOUNDARY_RATIO
  );
  const segmentIds = Array.from({ length: track.length }, () => 0);
  let currentSegmentId = 0;

  for (let index = 1; index < track.length; index += 1) {
    const previousTrack = track[index - 1];
    const currentTrack = track[index];
    const currentSample = samples[index];
    const crossedGap =
      previousTrack == null ||
      currentTrack == null ||
      currentSample?.reacquiredAfterGap;
    const largeJump =
      previousTrack != null &&
      currentTrack != null &&
      Math.abs(currentTrack - previousTrack) >= hardBoundaryThreshold;
    const startsHardCut =
      crossedGap ||
      currentSample?.startsNewShot ||
      currentSample?.committedSubjectSwitch ||
      largeJump;

    if (startsHardCut) {
      currentSegmentId += 1;
    }
    segmentIds[index] = currentSegmentId;
  }

  return segmentIds;
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

function resolveTransientMidpointRuns({
  track,
  samples,
  cropWidth,
  maxX,
}: {
  track: number[];
  samples: ReadonlyArray<SubjectAwareSample>;
  cropWidth: number;
  maxX: number;
}): number[] {
  if (track.length === 0 || samples.length !== track.length) {
    return track;
  }

  const stableRangeThreshold = Math.max(
    OPENING_STABLE_RANGE_MIN_PX,
    cropWidth * OPENING_STABLE_RANGE_RATIO
  );
  const resolvedTrack = [...track];

  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].framingMode !== 'midpoint') {
      continue;
    }

    const runStart = index;
    let runEnd = index;
    while (
      runEnd + 1 < samples.length &&
      samples[runEnd + 1].framingMode === 'midpoint'
    ) {
      runEnd += 1;
    }

    const nextIndex = runEnd + 1;
    if (nextIndex >= samples.length) {
      index = runEnd;
      continue;
    }

    const stableSingleTrack: number[] = [];
    for (
      let cursor = nextIndex;
      cursor < samples.length &&
      stableSingleTrack.length < TRANSIENT_MIDPOINT_CONFIRMATION_SAMPLE_COUNT;
      cursor += 1
    ) {
      const sample = samples[cursor];
      if (sample.framingMode !== 'single' || sample.reacquiredAfterGap) {
        break;
      }
      stableSingleTrack.push(track[cursor]);
    }

    if (
      stableSingleTrack.length >=
        TRANSIENT_MIDPOINT_CONFIRMATION_SAMPLE_COUNT &&
      computeRange(stableSingleTrack) <= stableRangeThreshold
    ) {
      const resolvedLock = pickStaticLockPosition(stableSingleTrack, maxX);
      for (let cursor = runStart; cursor <= runEnd; cursor += 1) {
        resolvedTrack[cursor] = resolvedLock;
      }
    }

    index = runEnd;
  }

  return resolvedTrack;
}

function resolveTransientMissingRuns({
  track,
  samples,
  cropWidth,
  maxX,
}: {
  track: number[];
  samples: ReadonlyArray<SubjectAwareSample>;
  cropWidth: number;
  maxX: number;
}): number[] {
  if (track.length === 0 || samples.length !== track.length) {
    return track;
  }

  const stableRangeThreshold = Math.max(
    OPENING_STABLE_RANGE_MIN_PX,
    cropWidth * OPENING_STABLE_RANGE_RATIO
  );
  const resolvedTrack = [...track];

  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].framingMode !== 'missing') {
      continue;
    }

    const runStart = index;
    let runEnd = index;
    while (
      runEnd + 1 < samples.length &&
      samples[runEnd + 1].framingMode === 'missing'
    ) {
      runEnd += 1;
    }

    const previousIndex = runStart - 1;
    const nextIndex = runEnd + 1;
    if (previousIndex < 0 || nextIndex >= samples.length) {
      index = runEnd;
      continue;
    }

    const runDuration =
      samples[runEnd].timeSeconds - samples[runStart].timeSeconds;
    if (
      runDuration > TRANSIENT_MISSING_MAX_SECONDS ||
      !samples[nextIndex].reacquiredAfterGap
    ) {
      index = runEnd;
      continue;
    }

    const stableSingleTrack: number[] = [];
    for (
      let cursor = nextIndex;
      cursor < samples.length &&
      stableSingleTrack.length < TRANSIENT_MISSING_CONFIRMATION_SAMPLE_COUNT;
      cursor += 1
    ) {
      const sample = samples[cursor];
      if (sample.framingMode !== 'single') {
        break;
      }
      stableSingleTrack.push(track[cursor]);
    }

    if (
      stableSingleTrack.length >= TRANSIENT_MISSING_CONFIRMATION_SAMPLE_COUNT &&
      computeRange(stableSingleTrack) <= stableRangeThreshold
    ) {
      const resolvedLock = pickStaticLockPosition(stableSingleTrack, maxX);
      if (
        Math.abs(resolvedLock - track[previousIndex]) > stableRangeThreshold
      ) {
        for (let cursor = runStart; cursor <= runEnd; cursor += 1) {
          resolvedTrack[cursor] = resolvedLock;
        }
      }
    }

    index = runEnd;
  }

  return resolvedTrack;
}

function stabilizeOpeningTrack({
  track,
  cropWidth,
  maxX,
}: {
  track: number[];
  cropWidth: number;
  maxX: number;
}): number[] {
  if (track.length < OPENING_CONFIRMATION_SAMPLE_COUNT + 1) {
    return track;
  }

  const confirmationSlice = track.slice(
    1,
    OPENING_CONFIRMATION_SAMPLE_COUNT + 1
  );
  const stableRangeThreshold = Math.max(
    OPENING_STABLE_RANGE_MIN_PX,
    cropWidth * OPENING_STABLE_RANGE_RATIO
  );
  if (computeRange(confirmationSlice) > stableRangeThreshold) {
    return track;
  }

  const confirmedOpening = pickStaticLockPosition(confirmationSlice, maxX);
  const openingOutlierThreshold = Math.max(
    OPENING_OUTLIER_DELTA_MIN_PX,
    cropWidth * OPENING_OUTLIER_DELTA_RATIO
  );
  if (Math.abs(track[0] - confirmedOpening) < openingOutlierThreshold) {
    return track;
  }

  return [confirmedOpening, ...track.slice(1)];
}

function buildShotSegmentIds(
  samples: ReadonlyArray<SubjectAwareSample>
): number[] {
  if (samples.length === 0) {
    return [];
  }

  const segmentIds = Array.from({ length: samples.length }, () => 0);
  let currentSegmentId = 0;

  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].startsNewShot) {
      currentSegmentId += 1;
    }
    segmentIds[index] = currentSegmentId;
  }

  return segmentIds;
}

function resolveShotStartTrack({
  track,
  timeTrack,
  samples,
  cropWidth,
  maxX,
}: {
  track: number[];
  timeTrack: ReadonlyArray<number>;
  samples: ReadonlyArray<SubjectAwareSample>;
  cropWidth: number;
  maxX: number;
}): number[] {
  if (
    track.length === 0 ||
    track.length !== timeTrack.length ||
    track.length !== samples.length
  ) {
    return track;
  }

  const stableRangeThreshold = Math.max(
    OPENING_STABLE_RANGE_MIN_PX,
    cropWidth * OPENING_STABLE_RANGE_RATIO
  );
  const resolvedTrack = [...track];

  for (let shotStart = 0; shotStart < samples.length; ) {
    let shotEnd = shotStart;
    while (
      shotEnd + 1 < samples.length &&
      !samples[shotEnd + 1].startsNewShot
    ) {
      shotEnd += 1;
    }

    const stableWindow = findEarliestStableSingleWindow({
      startIndex: shotStart,
      endIndex: shotEnd,
      track: resolvedTrack,
      samples,
      stableRangeThreshold,
      requiredSampleCount: SHOT_START_CONFIRMATION_SAMPLE_COUNT,
    });

    if (stableWindow) {
      const leadInDuration = Math.max(
        0,
        timeTrack[stableWindow.startIndex] - timeTrack[shotStart]
      );
      if (
        leadInDuration > 0 &&
        leadInDuration <= SHOT_START_BACKFILL_MAX_SECONDS
      ) {
        const resolvedLock = pickStaticLockPosition(stableWindow.values, maxX);
        for (
          let index = shotStart;
          index < stableWindow.startIndex;
          index += 1
        ) {
          resolvedTrack[index] = resolvedLock;
        }
      }
    }

    shotStart = shotEnd + 1;
  }

  return resolvedTrack;
}

function findEarliestStableSingleWindow({
  startIndex,
  endIndex,
  track,
  samples,
  stableRangeThreshold,
  requiredSampleCount,
}: {
  startIndex: number;
  endIndex: number;
  track: ReadonlyArray<number>;
  samples: ReadonlyArray<SubjectAwareSample>;
  stableRangeThreshold: number;
  requiredSampleCount: number;
}): { startIndex: number; values: number[] } | null {
  let singleRunStart: number | null = null;
  const recentValues: number[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (samples[index].framingMode !== 'single') {
      singleRunStart = null;
      recentValues.length = 0;
      continue;
    }

    if (singleRunStart == null) {
      singleRunStart = index;
    }
    recentValues.push(track[index]);
    if (recentValues.length > requiredSampleCount) {
      recentValues.shift();
      singleRunStart = index - recentValues.length + 1;
    }

    if (
      recentValues.length >= requiredSampleCount &&
      computeRange(recentValues) <= stableRangeThreshold
    ) {
      return {
        startIndex: singleRunStart,
        values: [...recentValues],
      };
    }
  }

  return null;
}

function buildCameraTrackWithHysteresis({
  targetTrack,
  timeTrack,
  cropWidth,
  maxX,
  segmentIds,
}: {
  targetTrack: number[];
  timeTrack: number[];
  cropWidth: number;
  maxX: number;
  segmentIds?: ReadonlyArray<number>;
}): CameraTrackBuildResult {
  if (targetTrack.length <= 1) {
    return {
      track: targetTrack.map(value =>
        quantizeValue(value, CAMERA_QUANTIZE_PX, maxX)
      ),
      decisionReasons: targetTrack.map((_, index) =>
        index === 0 ? 'start' : 'hold'
      ),
    };
  }

  const deadzone = Math.max(
    LOCK_DEADZONE_MIN_PX,
    cropWidth * LOCK_DEADZONE_RATIO
  );
  const immediateMoveThreshold = deadzone * IMMEDIATE_MOVE_MULTIPLIER;
  const cameraTrack = [quantizeValue(targetTrack[0], CAMERA_QUANTIZE_PX, maxX)];
  const decisionReasons = ['start'];
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
    const startsNewSegment =
      (segmentIds?.[index] ?? 0) !== (segmentIds?.[index - 1] ?? 0);

    if (startsNewSegment) {
      cameraTrack.push(
        resolveCutDestination({
          startIndex: index,
          currentTarget: target,
          targetTrack,
          timeTrack,
          maxX,
          deadzone,
          segmentIds,
        })
      );
      decisionReasons.push('cut-shot-boundary');
      pendingDirection = 0;
      pendingElapsedSeconds = 0;
      continue;
    }

    if (absDelta <= deadzone) {
      pendingDirection = 0;
      pendingElapsedSeconds = 0;
      cameraTrack.push(previous);
      decisionReasons.push('hold-deadzone');
      continue;
    }

    const direction: -1 | 1 = delta > 0 ? 1 : -1;
    if (absDelta >= immediateMoveThreshold) {
      cameraTrack.push(
        resolveCutDestination({
          startIndex: index,
          currentTarget: target,
          targetTrack,
          timeTrack,
          maxX,
          deadzone,
          segmentIds,
        })
      );
      decisionReasons.push('cut-large-move');
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
      decisionReasons.push('hold-dwell');
      continue;
    }

    cameraTrack.push(
      resolveCutDestination({
        startIndex: index,
        currentTarget: target,
        targetTrack,
        timeTrack,
        maxX,
        deadzone,
        segmentIds,
      })
    );
    decisionReasons.push(isLastSample ? 'cut-final-dwell' : 'cut-dwell');
    pendingDirection = 0;
    pendingElapsedSeconds = 0;
  }

  return {
    track: cameraTrack,
    decisionReasons,
  };
}

function resolveTransientLockRuns({
  track,
  timeTrack,
  cropWidth,
  segmentIds,
}: {
  track: number[];
  timeTrack: ReadonlyArray<number>;
  cropWidth: number;
  segmentIds?: ReadonlyArray<number>;
}): number[] {
  if (track.length <= 2 || track.length !== timeTrack.length) {
    return track;
  }

  const vicinityThreshold = Math.max(
    TRANSIENT_LOCK_VICINITY_MIN_PX,
    cropWidth * TRANSIENT_LOCK_VICINITY_RATIO
  );
  const resolvedTrack = [...track];

  let changed = true;
  while (changed) {
    changed = false;
    const runs = buildTrackRuns(resolvedTrack);
    for (let runIndex = runs.length - 2; runIndex >= 0; runIndex -= 1) {
      const currentRun = runs[runIndex];
      const nextRun = runs[runIndex + 1];
      const currentDuration = computeTrackRunDurationSeconds(
        currentRun,
        timeTrack
      );
      const nextDuration = computeTrackRunDurationSeconds(nextRun, timeTrack);
      const currentSegmentId = segmentIds?.[currentRun.startIndex] ?? 0;
      const nextSegmentId =
        segmentIds?.[nextRun.startIndex] ?? currentSegmentId;
      if (currentSegmentId !== nextSegmentId) {
        continue;
      }
      if (currentDuration > TRANSIENT_LOCK_MAX_SECONDS) {
        continue;
      }
      if (nextDuration <= currentDuration) {
        continue;
      }
      if (Math.abs(currentRun.value - nextRun.value) > vicinityThreshold) {
        continue;
      }

      for (
        let index = currentRun.startIndex;
        index <= currentRun.endIndex;
        index += 1
      ) {
        resolvedTrack[index] = nextRun.value;
      }
      changed = true;
      break;
    }
  }

  return resolvedTrack;
}

function resolveCutDestination({
  startIndex,
  currentTarget,
  targetTrack,
  timeTrack,
  maxX,
  deadzone,
  segmentIds,
}: {
  startIndex: number;
  currentTarget: number;
  targetTrack: ReadonlyArray<number>;
  timeTrack: ReadonlyArray<number>;
  maxX: number;
  deadzone: number;
  segmentIds?: ReadonlyArray<number>;
}): number {
  const stableWindow = findStableDestinationWindow({
    startIndex,
    targetTrack,
    timeTrack,
    deadzone,
    segmentIds,
  });
  if (!stableWindow) {
    return currentTarget;
  }

  const destination = pickStaticLockPosition(stableWindow, maxX);
  return Math.abs(destination - currentTarget) <= deadzone
    ? destination
    : currentTarget;
}

function findStableDestinationWindow({
  startIndex,
  targetTrack,
  timeTrack,
  deadzone,
  segmentIds,
}: {
  startIndex: number;
  targetTrack: ReadonlyArray<number>;
  timeTrack: ReadonlyArray<number>;
  deadzone: number;
  segmentIds?: ReadonlyArray<number>;
}): number[] | null {
  if (startIndex >= targetTrack.length - 1) {
    return null;
  }

  const segmentId = segmentIds?.[startIndex] ?? 0;
  let lookaheadEnd = startIndex;
  while (lookaheadEnd + 1 < targetTrack.length) {
    const nextIndex = lookaheadEnd + 1;
    if ((segmentIds?.[nextIndex] ?? 0) !== segmentId) {
      break;
    }
    const elapsed = timeTrack[nextIndex] - timeTrack[startIndex];
    if (
      Number.isFinite(elapsed) &&
      elapsed > DESTINATION_LOOKAHEAD_SECONDS &&
      lookaheadEnd > startIndex
    ) {
      break;
    }
    lookaheadEnd = nextIndex;
  }

  for (
    let windowStart = startIndex + 1;
    windowStart < lookaheadEnd;
    windowStart += 1
  ) {
    const window = targetTrack.slice(windowStart, lookaheadEnd + 1);
    if (window.length < 2) {
      continue;
    }
    if (computeRange(window) <= deadzone) {
      return window;
    }
  }

  return null;
}

type TrackRun = {
  startIndex: number;
  endIndex: number;
  value: number;
};

type CameraTrackBuildResult = {
  track: number[];
  decisionReasons: string[];
};

function buildTrackRuns(track: ReadonlyArray<number>): TrackRun[] {
  if (track.length === 0) {
    return [];
  }

  const runs: TrackRun[] = [];
  let startIndex = 0;
  for (let index = 1; index <= track.length; index += 1) {
    if (index < track.length && track[index] === track[startIndex]) {
      continue;
    }
    runs.push({
      startIndex,
      endIndex: index - 1,
      value: track[startIndex],
    });
    startIndex = index;
  }

  return runs;
}

function computeTrackRunDurationSeconds(
  run: TrackRun,
  timeTrack: ReadonlyArray<number>
): number {
  const startTime = timeTrack[run.startIndex];
  if (!Number.isFinite(startTime)) {
    return 0;
  }

  const nextStartTime = timeTrack[run.endIndex + 1];
  if (Number.isFinite(nextStartTime)) {
    return Math.max(0, nextStartTime - startTime);
  }

  const endTime = timeTrack[run.endIndex];
  if (!Number.isFinite(endTime)) {
    return 0;
  }

  return Math.max(
    0,
    endTime - startTime + inferTrailingRunStepSeconds(run, timeTrack)
  );
}

function inferTrailingRunStepSeconds(
  run: TrackRun,
  timeTrack: ReadonlyArray<number>
): number {
  const endTime = timeTrack[run.endIndex];
  if (!Number.isFinite(endTime)) {
    return SAMPLE_INTERVAL_SECONDS;
  }

  const previousInRunTime = timeTrack[run.endIndex - 1];
  if (Number.isFinite(previousInRunTime) && previousInRunTime < endTime) {
    return endTime - previousInRunTime;
  }

  const previousTrackTime = timeTrack[run.startIndex - 1];
  const startTime = timeTrack[run.startIndex];
  if (
    Number.isFinite(previousTrackTime) &&
    Number.isFinite(startTime) &&
    previousTrackTime < startTime
  ) {
    return startTime - previousTrackTime;
  }

  return SAMPLE_INTERVAL_SECONDS;
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
