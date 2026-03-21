import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import { app } from 'electron';
import log from 'electron-log';
import * as ort from 'onnxruntime-node';
import type { FFmpegContext, VideoMeta } from './ffmpeg-runner.js';
import {
  ULTRAFACE_INPUT_HEIGHT,
  ULTRAFACE_INPUT_WIDTH,
  buildVerticalReframePlan,
  decodeUltraFaceDetections,
  pickPrimaryFaceCenterX,
  type FaceCandidate,
  type FaceTrackSample,
  type VerticalReframePlan,
} from './highlight-smart-reframe-core.js';
import {
  MAX_DENSE_REFINEMENT_SAMPLE_COUNT,
  buildCoarseReframeSampleTimes,
  buildDenseRefinementSampleTimes,
} from './highlight-smart-reframe-sampling.js';
import {
  applyShotBoundaryTimeCorrections,
  type ShotBoundaryAuditResult,
} from './highlight-smart-reframe-boundary-timing.js';

const MODEL_FILE_NAME = 'version-RFB-320.onnx';
const VERTICAL_OUTPUT_WIDTH = 1080;
const VERTICAL_OUTPUT_HEIGHT = 1920;
const SHOT_SIGNATURE_COLUMNS = 16;
const SHOT_SIGNATURE_ROWS = 12;
const SHOT_CUT_STRONG_DELTA = 0.16;
const SHOT_CUT_SUPPORTING_DELTA = 0.1;
const SHOT_CUT_CENTER_DELTA_RATIO = 0.18;
const SHOT_CUT_CENTER_DELTA_MIN_PX = 180;
const SHOT_BOUNDARY_AUDIT_FRAMES_AFTER = 4;
const SHOT_BOUNDARY_AUDIT_MAX_BOUNDARIES = 12;
const FALLBACK_BOUNDARY_AUDIT_FRAME_RATE = 23.976;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

type DetectedPrimaryFace = {
  centerX: number;
  confidence: number;
};

type DetectedFaceSample = {
  primaryFace: DetectedPrimaryFace | null;
  candidates: FaceCandidate[];
};

type AnalyzedTrackSample = FaceTrackSample & {
  frameSignature: Uint8Array | null;
};

type ShotBoundaryAuditFrame = {
  timeSeconds: number;
  frameDelta: number | null;
  startsNewShot: boolean;
  detectedCenterX: number | null;
  confidence: number;
  candidateCenters: number[];
  cropX: number;
};

export async function createVerticalReframePlan({
  videoPath,
  clipStartSeconds,
  clipEndSeconds,
  videoMeta,
  ffmpeg,
  signal,
  operationId,
  onSampleProgress,
}: {
  videoPath: string;
  clipStartSeconds: number;
  clipEndSeconds: number;
  videoMeta: VideoMeta;
  ffmpeg: Pick<FFmpegContext, 'ffmpegPath'>;
  signal?: AbortSignal;
  operationId?: string;
  onSampleProgress?: (completed: number, total: number) => void;
}): Promise<VerticalReframePlan | null> {
  const sourceWidth = normalizeDimension(videoMeta.width);
  const sourceHeight = normalizeDimension(videoMeta.height);
  if (!sourceWidth || !sourceHeight) {
    return null;
  }

  const durationSeconds = Math.max(0.25, clipEndSeconds - clipStartSeconds);
  const coarseSampleTimes = buildCoarseReframeSampleTimes(durationSeconds);
  const trackSampleMap = new Map<string, AnalyzedTrackSample>();
  let completedSamples = 0;
  const progressTotalEstimate =
    coarseSampleTimes.length + MAX_DENSE_REFINEMENT_SAMPLE_COUNT;
  const centerDeltaThreshold = Math.max(
    SHOT_CUT_CENTER_DELTA_MIN_PX,
    sourceWidth * SHOT_CUT_CENTER_DELTA_RATIO
  );

  const getSortedTrackSamples = (): AnalyzedTrackSample[] =>
    [...trackSampleMap.values()].sort((a, b) => a.timeSeconds - b.timeSeconds);
  const getPreviousDetectedCenterX = (relativeTime: number): number | null => {
    const sortedSamples = getSortedTrackSamples();
    for (let index = sortedSamples.length - 1; index >= 0; index -= 1) {
      const sample = sortedSamples[index];
      if (sample.timeSeconds >= relativeTime) {
        continue;
      }
      if (sample.centerX != null && Number.isFinite(sample.centerX)) {
        return sample.centerX;
      }
    }
    return null;
  };

  const analyzeSampleAtTime = async (
    relativeTime: number
  ): Promise<AnalyzedTrackSample> => {
    const sampleKey = formatSampleTimeKey(relativeTime);
    const cachedSample = trackSampleMap.get(sampleKey);
    if (cachedSample) {
      return cachedSample;
    }

    throwIfAborted(signal);

    const absoluteTime = clipStartSeconds + relativeTime;
    const previousCenterX = getPreviousDetectedCenterX(relativeTime);
    let analyzedSample: AnalyzedTrackSample;

    try {
      const frame = await extractRgbFrameAtTime({
        ffmpegPath: ffmpeg.ffmpegPath,
        videoPath,
        timeSeconds: absoluteTime,
        signal,
      });
      const detectedFaces: DetectedFaceSample | null = frame
        ? await detectFaceSample({
            frame,
            sourceWidth,
            sourceHeight,
            previousCenterX,
          })
        : null;

      analyzedSample = {
        timeSeconds: relativeTime,
        centerX: detectedFaces?.primaryFace?.centerX ?? null,
        confidence: detectedFaces?.primaryFace?.confidence ?? 0,
        candidates: detectedFaces?.candidates ?? [],
        frameSignature: frame ? computeFrameSignature(frame) : null,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      log.warn(
        `[highlight-smart-reframe] Frame analysis failed for ${operationId ?? 'no-op'} at ${absoluteTime.toFixed(2)}s`,
        error
      );
      analyzedSample = {
        timeSeconds: relativeTime,
        centerX: null,
        confidence: 0,
        candidates: [],
        frameSignature: null,
      };
    }

    trackSampleMap.set(sampleKey, analyzedSample);
    completedSamples += 1;
    onSampleProgress?.(completedSamples, progressTotalEstimate);
    return analyzedSample;
  };

  const inspectFrameAtTime = async (
    relativeTime: number,
    previousCenterX: number | null
  ): Promise<AnalyzedTrackSample> => {
    throwIfAborted(signal);

    const absoluteTime = clipStartSeconds + relativeTime;

    try {
      const frame = await extractRgbFrameAtTime({
        ffmpegPath: ffmpeg.ffmpegPath,
        videoPath,
        timeSeconds: absoluteTime,
        signal,
      });
      const detectedFaces: DetectedFaceSample | null = frame
        ? await detectFaceSample({
            frame,
            sourceWidth,
            sourceHeight,
            previousCenterX,
          })
        : null;

      return {
        timeSeconds: relativeTime,
        centerX: detectedFaces?.primaryFace?.centerX ?? null,
        confidence: detectedFaces?.primaryFace?.confidence ?? 0,
        candidates: detectedFaces?.candidates ?? [],
        frameSignature: frame ? computeFrameSignature(frame) : null,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      log.warn(
        `[highlight-smart-reframe] Boundary audit frame analysis failed for ${operationId ?? 'no-op'} at ${absoluteTime.toFixed(3)}s`,
        error
      );
      return {
        timeSeconds: relativeTime,
        centerX: null,
        confidence: 0,
        candidates: [],
        frameSignature: null,
      };
    }
  };

  for (const relativeTime of coarseSampleTimes) {
    await analyzeSampleAtTime(relativeTime);
  }

  const coarseSamples = assignShotIdsToSamples(
    getSortedTrackSamples(),
    sourceWidth
  );
  const denseSampleTimes = buildDenseRefinementSampleTimes({
    durationSeconds,
    sourceWidth,
    coarseSamples,
  });

  for (const relativeTime of denseSampleTimes) {
    await analyzeSampleAtTime(relativeTime);
  }

  const trackSamples = assignShotIdsToSamples(
    getSortedTrackSamples(),
    sourceWidth
  );
  onSampleProgress?.(completedSamples, completedSamples);
  const shouldLogTraceDetails = shouldLogReframeTrace();
  log.info(
    `[highlight-smart-reframe] Adaptive sampling for ${operationId ?? 'no-op'}: ${trackSamples.length} total (${coarseSampleTimes.length} coarse, ${denseSampleTimes.length} dense, ${countDistinctShots(trackSamples)} shots)`
  );

  const initialPlan = buildVerticalReframePlan({
    sourceWidth,
    sourceHeight,
    durationSeconds,
    samples: trackSamples,
    includeDebugTrace: shouldLogTraceDetails,
  });
  if (!initialPlan) {
    return null;
  }

  const boundaryAudits = await logShotBoundaryAudits({
    operationId,
    videoPath,
    ffmpegPath: ffmpeg.ffmpegPath,
    signal,
    durationSeconds,
    frameRate: videoMeta.frameRate,
    sourceWidth,
    sourceHeight,
    centerDeltaThreshold,
    trackSamples,
    plan: initialPlan,
    inspectFrameAtTime,
  });
  const { samples: correctedTrackSamples, corrections } =
    applyShotBoundaryTimeCorrections({
      samples: trackSamples,
      durationSeconds,
      boundaryAudits,
    });
  if (corrections.length > 0) {
    log.info(
      `[highlight-smart-reframe] Applied exact shot boundary timing corrections for ${operationId ?? 'no-op'}: ${JSON.stringify(
        corrections
      )}`
    );
  }

  const plan =
    corrections.length === 0
      ? initialPlan
      : buildVerticalReframePlan({
          sourceWidth,
          sourceHeight,
          durationSeconds,
          samples: correctedTrackSamples,
          includeDebugTrace: shouldLogTraceDetails,
        });
  if (!plan) {
    return null;
  }

  if (shouldLogTraceDetails) {
    for (const traceSample of plan.debugTrace) {
      log.info(
        `[highlight-smart-reframe][trace ${operationId ?? 'no-op'}] ${JSON.stringify(traceSample)}`
      );
    }
  }

  return plan;
}

export function buildVerticalReframeFilter(plan: VerticalReframePlan): string {
  return `crop=${plan.cropWidth}:${plan.cropHeight}:'${plan.xExpression}':0,scale=${VERTICAL_OUTPUT_WIDTH}:${VERTICAL_OUTPUT_HEIGHT}:flags=lanczos,setsar=1`;
}

async function detectFaceSample({
  frame,
  sourceWidth,
  sourceHeight,
  previousCenterX,
}: {
  frame: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  previousCenterX: number | null;
}): Promise<DetectedFaceSample | null> {
  const session = await getSession();
  const inputTensor = frameToTensor(frame);
  const outputs = await session.run({ input: inputTensor });

  const scoreTensor = outputs.scores;
  const boxTensor = outputs.boxes;
  const candidates = decodeUltraFaceDetections(
    scoreTensor.data as ArrayLike<number>,
    boxTensor.data as ArrayLike<number>,
    sourceWidth,
    sourceHeight
  );

  const primaryFace = pickPrimaryFaceCenterX(
    candidates,
    sourceWidth,
    sourceHeight,
    previousCenterX
  );
  return {
    primaryFace,
    candidates,
  };
}

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = createSession();
  }

  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

async function createSession(): Promise<ort.InferenceSession> {
  const modelPath = await resolveModelPath();
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    logSeverityLevel: 3,
    graphOptimizationLevel: 'all',
  });
}

async function resolveModelPath(): Promise<string> {
  const packagedPath = path.join(
    process.resourcesPath,
    'vision-models',
    MODEL_FILE_NAME
  );
  const developmentPath = path.resolve(
    app.getAppPath(),
    'vendor',
    'vision',
    MODEL_FILE_NAME
  );
  const candidates = app.isPackaged
    ? [packagedPath, developmentPath]
    : [developmentPath, packagedPath];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    `[highlight-smart-reframe] Model file missing. Checked: ${candidates.join(', ')}`
  );
}

async function extractRgbFrameAtTime({
  ffmpegPath,
  videoPath,
  timeSeconds,
  signal,
}: {
  ffmpegPath: string;
  videoPath: string;
  timeSeconds: number;
  signal?: AbortSignal;
}): Promise<Buffer | null> {
  throwIfAborted(signal);

  return new Promise<Buffer | null>((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-nostdin',
      '-ss',
      timeSeconds.toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${ULTRAFACE_INPUT_WIDTH}:${ULTRAFACE_INPUT_HEIGHT}:flags=fast_bilinear`,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      'pipe:1',
    ];

    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const chunks: Buffer[] = [];
    let stderr = '';
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener('abort', abortHandler);
    };

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler();
    };

    const abortHandler = () => {
      if (!child.killed) {
        child.kill('SIGKILL');
      }
      finish(() => reject(new Error('Operation cancelled')));
    };

    signal?.addEventListener('abort', abortHandler, { once: true });

    child.stdout.on('data', chunk => {
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      finish(() => reject(error));
    });
    child.on('close', code => {
      finish(() => {
        if (code !== 0) {
          reject(
            new Error(
              stderr.trim() ||
                `FFmpeg frame extraction failed with exit code ${code}`
            )
          );
          return;
        }

        const frame = Buffer.concat(chunks);
        const expectedBytes =
          ULTRAFACE_INPUT_WIDTH * ULTRAFACE_INPUT_HEIGHT * 3;
        if (frame.length < expectedBytes) {
          resolve(null);
          return;
        }
        resolve(frame.subarray(0, expectedBytes));
      });
    });
  });
}

function frameToTensor(frame: Buffer): ort.Tensor {
  const pixelCount = ULTRAFACE_INPUT_WIDTH * ULTRAFACE_INPUT_HEIGHT;
  const data = new Float32Array(pixelCount * 3);

  for (let index = 0; index < pixelCount; index += 1) {
    const sourceOffset = index * 3;
    data[index] = (frame[sourceOffset] - 127) / 128;
    data[pixelCount + index] = (frame[sourceOffset + 1] - 127) / 128;
    data[pixelCount * 2 + index] = (frame[sourceOffset + 2] - 127) / 128;
  }

  return new ort.Tensor('float32', data, [
    1,
    3,
    ULTRAFACE_INPUT_HEIGHT,
    ULTRAFACE_INPUT_WIDTH,
  ]);
}

function computeFrameSignature(frame: Buffer): Uint8Array {
  const signature = new Uint8Array(
    SHOT_SIGNATURE_COLUMNS * SHOT_SIGNATURE_ROWS
  );
  const blockWidth = ULTRAFACE_INPUT_WIDTH / SHOT_SIGNATURE_COLUMNS;
  const blockHeight = ULTRAFACE_INPUT_HEIGHT / SHOT_SIGNATURE_ROWS;

  for (let blockY = 0; blockY < SHOT_SIGNATURE_ROWS; blockY += 1) {
    const yStart = Math.floor(blockY * blockHeight);
    const yEnd = Math.min(
      ULTRAFACE_INPUT_HEIGHT,
      Math.floor((blockY + 1) * blockHeight)
    );
    for (let blockX = 0; blockX < SHOT_SIGNATURE_COLUMNS; blockX += 1) {
      const xStart = Math.floor(blockX * blockWidth);
      const xEnd = Math.min(
        ULTRAFACE_INPUT_WIDTH,
        Math.floor((blockX + 1) * blockWidth)
      );
      let lumaSum = 0;
      let pixelCount = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          const offset = (y * ULTRAFACE_INPUT_WIDTH + x) * 3;
          const red = frame[offset] ?? 0;
          const green = frame[offset + 1] ?? 0;
          const blue = frame[offset + 2] ?? 0;
          lumaSum += (red * 77 + green * 150 + blue * 29) >> 8;
          pixelCount += 1;
        }
      }

      signature[blockY * SHOT_SIGNATURE_COLUMNS + blockX] = Math.round(
        lumaSum / Math.max(1, pixelCount)
      );
    }
  }

  return signature;
}

function assignShotIdsToSamples(
  samples: ReadonlyArray<AnalyzedTrackSample>,
  sourceWidth: number
): FaceTrackSample[] {
  if (samples.length === 0) {
    return [];
  }

  const centerDeltaThreshold = Math.max(
    SHOT_CUT_CENTER_DELTA_MIN_PX,
    sourceWidth * SHOT_CUT_CENTER_DELTA_RATIO
  );
  let currentShotId = 0;

  return samples.map((sample, index) => {
    if (
      index > 0 &&
      shouldStartNewShot({
        previous: samples[index - 1],
        current: sample,
        centerDeltaThreshold,
      })
    ) {
      currentShotId += 1;
    }

    return {
      timeSeconds: sample.timeSeconds,
      centerX: sample.centerX,
      confidence: sample.confidence,
      candidates: sample.candidates,
      shotId: currentShotId,
    };
  });
}

function shouldStartNewShot({
  previous,
  current,
  centerDeltaThreshold,
}: {
  previous: AnalyzedTrackSample;
  current: AnalyzedTrackSample;
  centerDeltaThreshold: number;
}): boolean {
  const frameDelta = computeFrameSignatureDelta(
    previous.frameSignature,
    current.frameSignature
  );
  if (frameDelta == null) {
    return false;
  }
  if (frameDelta >= SHOT_CUT_STRONG_DELTA) {
    return true;
  }

  const previousHasFace = previous.centerX != null;
  const currentHasFace = current.centerX != null;
  const candidateCountChanged =
    (previous.candidates?.length ?? 0) !== (current.candidates?.length ?? 0);
  const centerDelta =
    previous.centerX != null && current.centerX != null
      ? Math.abs(current.centerX - previous.centerX)
      : 0;

  return (
    frameDelta >= SHOT_CUT_SUPPORTING_DELTA &&
    (previousHasFace !== currentHasFace ||
      candidateCountChanged ||
      centerDelta >= centerDeltaThreshold)
  );
}

function computeFrameSignatureDelta(
  previous: Uint8Array | null,
  current: Uint8Array | null
): number | null {
  if (!previous || !current || previous.length !== current.length) {
    return null;
  }

  let totalDelta = 0;
  for (let index = 0; index < previous.length; index += 1) {
    totalDelta += Math.abs(previous[index] - current[index]);
  }

  return totalDelta / (previous.length * 255);
}

function countDistinctShots(samples: ReadonlyArray<FaceTrackSample>): number {
  if (samples.length === 0) {
    return 0;
  }
  return new Set(samples.map(sample => sample.shotId ?? 0)).size;
}

async function logShotBoundaryAudits({
  operationId,
  durationSeconds,
  frameRate,
  centerDeltaThreshold,
  trackSamples,
  plan,
  inspectFrameAtTime,
}: {
  operationId?: string;
  videoPath: string;
  ffmpegPath: string;
  signal?: AbortSignal;
  durationSeconds: number;
  frameRate: number;
  sourceWidth: number;
  sourceHeight: number;
  centerDeltaThreshold: number;
  trackSamples: ReadonlyArray<FaceTrackSample>;
  plan: VerticalReframePlan;
  inspectFrameAtTime: (
    relativeTime: number,
    previousCenterX: number | null
  ) => Promise<AnalyzedTrackSample>;
}): Promise<ShotBoundaryAuditResult[]> {
  if (trackSamples.length <= 1) {
    return [];
  }

  const boundaryIndices = trackSamples
    .map((sample, index) =>
      index > 0 && sample.shotId !== trackSamples[index - 1].shotId ? index : -1
    )
    .filter(index => index >= 0)
    .slice(0, SHOT_BOUNDARY_AUDIT_MAX_BOUNDARIES);
  if (boundaryIndices.length === 0) {
    return [];
  }

  const frameStepSeconds = getBoundaryAuditFrameStepSeconds(frameRate);
  const shouldLogAuditDetails = shouldLogShotBoundaryAudit();
  const results: ShotBoundaryAuditResult[] = [];

  for (const boundaryIndex of boundaryIndices) {
    const boundarySample = trackSamples[boundaryIndex];
    const previousSample = trackSamples[boundaryIndex - 1];
    const frameTimes = buildBoundaryAuditFrameTimes({
      previousSampleTimeSeconds: previousSample.timeSeconds,
      boundaryTimeSeconds: boundarySample.timeSeconds,
      durationSeconds,
      frameStepSeconds,
    });
    const auditFrames: ShotBoundaryAuditFrame[] = [];
    let previousAudit: AnalyzedTrackSample | null = null;

    for (const frameTimeSeconds of frameTimes) {
      const auditSample = await inspectFrameAtTime(
        frameTimeSeconds,
        previousAudit?.centerX ?? null
      );
      const frameDelta = previousAudit
        ? computeFrameSignatureDelta(
            previousAudit.frameSignature,
            auditSample.frameSignature
          )
        : null;
      const startsNewShot =
        previousAudit != null &&
        shouldStartNewShot({
          previous: previousAudit,
          current: auditSample,
          centerDeltaThreshold,
        });

      auditFrames.push({
        timeSeconds: roundTo(frameTimeSeconds, 6),
        frameDelta:
          frameDelta == null ? null : roundTo(clamp(frameDelta, 0, 1), 4),
        startsNewShot,
        detectedCenterX:
          auditSample.centerX == null ? null : roundTo(auditSample.centerX, 3),
        confidence: roundTo(auditSample.confidence, 3),
        candidateCenters: (auditSample.candidates ?? [])
          .map(candidate => roundTo((candidate.x1 + candidate.x2) / 2, 3))
          .slice(0, 4),
        cropX: roundTo(resolveCameraXAtTime(plan, frameTimeSeconds), 3),
      });

      previousAudit = auditSample;
    }

    const exactBoundaryFrame =
      auditFrames.find(frame => frame.startsNewShot)?.timeSeconds ?? null;
    results.push({
      boundaryIndex,
      previousShotId: previousSample.shotId ?? null,
      shotId: boundarySample.shotId ?? null,
      sampledBoundaryTimeSeconds: boundarySample.timeSeconds,
      exactBoundaryFrameTimeSeconds: exactBoundaryFrame,
    });
    if (shouldLogAuditDetails) {
      log.info(
        `[highlight-smart-reframe][boundary-audit ${operationId ?? 'no-op'}] ${JSON.stringify(
          {
            previousShotId: previousSample.shotId ?? null,
            shotId: boundarySample.shotId ?? null,
            previousSampleTimeSeconds: roundTo(previousSample.timeSeconds, 3),
            sampledBoundaryTimeSeconds: roundTo(boundarySample.timeSeconds, 3),
            exactBoundaryFrameTimeSeconds: exactBoundaryFrame,
            exactBoundaryLeadMs:
              exactBoundaryFrame == null
                ? null
                : Math.round(
                    (boundarySample.timeSeconds - exactBoundaryFrame) * 1000
                  ),
            sampledBoundaryCropX: roundTo(
              resolveCameraXAtTime(plan, boundarySample.timeSeconds),
              3
            ),
            frameStepSeconds: roundTo(frameStepSeconds, 6),
            auditFrames,
          }
        )}`
      );
    }
  }

  if (!shouldLogAuditDetails) {
    const unresolvedBoundaries = results
      .filter(result => result.exactBoundaryFrameTimeSeconds == null)
      .map(result => ({
        shotId: result.shotId,
        sampledBoundaryTimeSeconds: roundTo(
          result.sampledBoundaryTimeSeconds,
          3
        ),
      }));
    if (unresolvedBoundaries.length > 0) {
      log.info(
        `[highlight-smart-reframe] Unresolved exact shot boundaries for ${operationId ?? 'no-op'}: ${JSON.stringify(unresolvedBoundaries)}`
      );
    }
  }

  return results;
}

function shouldLogShotBoundaryAudit(): boolean {
  return (
    process.env.STAGE5_REFRAME_BOUNDARY_AUDIT === '1' ||
    process.env.STAGE5_REFRAME_TRACE === '1'
  );
}

function shouldLogReframeTrace(): boolean {
  return process.env.STAGE5_REFRAME_TRACE === '1';
}

function getBoundaryAuditFrameStepSeconds(frameRate: number): number {
  const normalizedFrameRate =
    Number.isFinite(frameRate) && frameRate > 1
      ? frameRate
      : FALLBACK_BOUNDARY_AUDIT_FRAME_RATE;
  return 1 / normalizedFrameRate;
}

function buildBoundaryAuditFrameTimes({
  previousSampleTimeSeconds,
  boundaryTimeSeconds,
  durationSeconds,
  frameStepSeconds,
}: {
  previousSampleTimeSeconds: number;
  boundaryTimeSeconds: number;
  durationSeconds: number;
  frameStepSeconds: number;
}): number[] {
  const maxFrameIndex = Math.max(
    0,
    Math.floor(Math.max(0, durationSeconds) / frameStepSeconds)
  );
  const previousFrameIndex = Math.max(
    0,
    Math.min(
      maxFrameIndex,
      Math.floor(Math.max(0, previousSampleTimeSeconds) / frameStepSeconds)
    )
  );
  const boundaryFrameIndex = Math.max(
    previousFrameIndex,
    Math.min(maxFrameIndex, Math.ceil(boundaryTimeSeconds / frameStepSeconds))
  );
  const startFrameIndex = previousFrameIndex;
  const endFrameIndex = Math.min(
    maxFrameIndex,
    boundaryFrameIndex + SHOT_BOUNDARY_AUDIT_FRAMES_AFTER
  );
  const frameTimes: number[] = [];

  for (
    let frameIndex = startFrameIndex;
    frameIndex <= endFrameIndex;
    frameIndex += 1
  ) {
    frameTimes.push(
      roundTo(
        clamp(frameIndex * frameStepSeconds, 0, Math.max(0, durationSeconds)),
        6
      )
    );
  }

  return Array.from(new Set(frameTimes));
}

function resolveCameraXAtTime(
  plan: VerticalReframePlan,
  timeSeconds: number
): number {
  if (plan.keyframes.length === 0) {
    return 0;
  }

  let currentX = plan.keyframes[0].x;
  for (const keyframe of plan.keyframes) {
    if (keyframe.timeSeconds > timeSeconds) {
      break;
    }
    currentX = keyframe.x;
  }

  return currentX;
}

function normalizeDimension(value: number | undefined): number | null {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return null;
  }
  return Math.max(2, Math.round(value as number));
}

function formatSampleTimeKey(timeSeconds: number): string {
  return timeSeconds.toFixed(3);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation cancelled');
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message === 'Operation cancelled')
  );
}
