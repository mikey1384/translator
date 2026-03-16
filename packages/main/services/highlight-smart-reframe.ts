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
  buildSampleTimes,
  buildVerticalReframePlan,
  decodeUltraFaceDetections,
  pickPrimaryFaceCenterX,
  type FaceCandidate,
  type FaceTrackSample,
  type VerticalReframePlan,
} from './highlight-smart-reframe-core.js';

const MODEL_FILE_NAME = 'version-RFB-320.onnx';
const VERTICAL_OUTPUT_WIDTH = 1080;
const VERTICAL_OUTPUT_HEIGHT = 1920;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

type DetectedPrimaryFace = {
  centerX: number;
  confidence: number;
};

type DetectedFaceSample = {
  primaryFace: DetectedPrimaryFace | null;
  candidates: FaceCandidate[];
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
  const sampleTimes = buildSampleTimes(durationSeconds);
  const trackSamples: FaceTrackSample[] = [];
  let previousCenterX: number | null = null;
  let completedSamples = 0;

  for (const relativeTime of sampleTimes) {
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

      if (detectedFaces?.primaryFace) {
        previousCenterX = detectedFaces.primaryFace.centerX;
      }

      trackSamples.push({
        timeSeconds: relativeTime,
        centerX: detectedFaces?.primaryFace?.centerX ?? null,
        confidence: detectedFaces?.primaryFace?.confidence ?? 0,
        candidates: detectedFaces?.candidates ?? [],
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      log.warn(
        `[highlight-smart-reframe] Frame analysis failed for ${operationId ?? 'no-op'} at ${absoluteTime.toFixed(2)}s`,
        error
      );
      trackSamples.push({
        timeSeconds: relativeTime,
        centerX: null,
        confidence: 0,
        candidates: [],
      });
    } finally {
      completedSamples += 1;
      onSampleProgress?.(completedSamples, sampleTimes.length);
    }
  }

  return buildVerticalReframePlan({
    sourceWidth,
    sourceHeight,
    durationSeconds,
    samples: trackSamples,
  });
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

function normalizeDimension(value: number | undefined): number | null {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return null;
  }
  return Math.max(2, Math.round(value as number));
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
