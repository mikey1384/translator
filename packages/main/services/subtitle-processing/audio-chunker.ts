import log from 'electron-log';
import { spawn } from 'child_process';
import * as webrtcvadPackage from 'webrtcvad';
import {
  VAD_NORMALIZATION_MIN_GAP_SEC,
  VAD_NORMALIZATION_MIN_DURATION_SEC,
} from './constants.js';

const Vad = webrtcvadPackage.default.default;

export async function detectSpeechIntervals({
  inputPath,
  vadMode = 2,
  frameMs = 30,
  operationId = '',
  signal,
}: {
  inputPath: string;
  vadMode?: 0 | 1 | 2 | 3;
  frameMs?: 10 | 20 | 30;
  operationId?: string;
  signal?: AbortSignal;
}): Promise<Array<{ start: number; end: number }>> {
  return new Promise((resolve, reject) => {
    log.info(`[${operationId}] Starting streamed VAD for: ${inputPath}`);
    const sampleRate = 16_000;
    const bytesPerSample = 2; // 16-bit
    const frameSizeSamples = (sampleRate * frameMs) / 1000;
    const bytesPerFrame = frameSizeSamples * bytesPerSample; // 16‑bit mono

    const vad = new Vad(sampleRate, vadMode);
    const intervals: Array<{ start: number; end: number }> = [];
    let speechOpen = false;
    let segStart = 0;
    let currentFrameIndex = 0;
    let leftoverBuffer = Buffer.alloc(0);

    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-f',
      's16le',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-loglevel',
      'error',
      '-',
    ]);

    if (signal) {
      const killSig = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
      const onAbort = () => {
        if (!ffmpeg.killed) {
          log.info(
            `[${operationId}] Killing VAD ffmpeg process due to abort signal`
          );
          ffmpeg.kill(killSig);
        }
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
        ffmpeg.once('close', () =>
          signal.removeEventListener('abort', onAbort)
        );
      }
    }

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      // Combine leftover data from previous chunk with the new chunk
      const currentBuffer = Buffer.concat([leftoverBuffer, chunk]);
      let offset = 0;

      // Process as many full frames as possible from the current buffer
      while (offset + bytesPerFrame <= currentBuffer.length) {
        const frame = currentBuffer.subarray(offset, offset + bytesPerFrame);
        const t = currentFrameIndex * (frameMs / 1000);

        try {
          const isSpeech = vad.process(frame);

          if (isSpeech && !speechOpen) {
            segStart = t;
            speechOpen = true;
          }
          if (!isSpeech && speechOpen) {
            intervals.push({ start: segStart, end: t });
            speechOpen = false;
          }
        } catch (vadError) {
          log.error(
            `[${operationId}] VAD process error on frame ${currentFrameIndex}`,
            vadError
          );
          // Decide if you want to stop or continue
        }

        offset += bytesPerFrame;
        currentFrameIndex++;
      }

      // Keep any remaining incomplete frame data for the next chunk
      leftoverBuffer = currentBuffer.subarray(offset);
    });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      log.error(`[${operationId}] ffmpeg stderr: ${data.toString()}`);
    });

    ffmpeg.on('close', code => {
      log.info(`[${operationId}] ffmpeg process exited with code ${code}`);
      if (speechOpen) {
        // Flush the last segment if speech was open at the end
        const endTime = currentFrameIndex * (frameMs / 1000);
        intervals.push({ start: segStart, end: endTime });
        speechOpen = false; // Reset state
      }
      if (code !== 0 && code !== null) {
        // Allow null code for graceful exit/cancel
        // Check if the intervals array is empty, might indicate early failure
        if (intervals.length === 0 && leftoverBuffer.length === 0) {
          log.error(
            `[${operationId}] FFmpeg exited abnormally (code ${code}) before processing any frames. Check input file/FFmpeg installation.`
          );
          return reject(
            new Error(
              `FFmpeg process failed with code ${code}. No VAD intervals generated.`
            )
          );
        } else {
          log.warn(
            `[${operationId}] FFmpeg process exited with code ${code}, but some intervals may have been processed.`
          );
          // Continue with potentially partial results
        }
      }
      log.info(
        `[${operationId}] Finished streamed VAD. Found ${intervals.length} raw intervals.`
      );
      resolve(intervals);
    });

    ffmpeg.on('error', err => {
      log.error(`[${operationId}] Failed to start ffmpeg process:`, err);
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

export function normalizeSpeechIntervals({
  intervals,
  minGapSec = VAD_NORMALIZATION_MIN_GAP_SEC,
  minDurSec = VAD_NORMALIZATION_MIN_DURATION_SEC,
}: {
  intervals: Array<{ start: number; end: number }>;
  minGapSec?: number;
  minDurSec?: number;
}) {
  if (!intervals || intervals.length === 0) return []; // Handle empty input

  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  if (intervals[0]) {
    merged.push({ ...intervals[0] });
  }

  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i];
    const last = merged.at(-1);

    if (last && cur.start - last.end < minGapSec) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged.filter(i => i.end - i.start >= minDurSec);
}

export function chunkSpeechInterval({
  interval,
  duration,
}: {
  interval: { start: number; end: number };
  duration: number;
}): Array<{ start: number; end: number }> {
  if (interval.end - interval.start <= duration) {
    return [interval];
  }

  const mid = (interval.start + interval.end) / 2;
  return [
    ...chunkSpeechInterval({
      interval: { start: interval.start, end: mid },
      duration,
    }),
    ...chunkSpeechInterval({
      interval: { start: mid, end: interval.end },
      duration,
    }),
  ];
}

export function mergeAdjacentIntervals(
  intervals: Array<{ start: number; end: number }>,
  maxGapSec: number
): Array<{ start: number; end: number }> {
  if (!intervals || intervals.length === 0) {
    return [];
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  merged.push({ ...intervals[0] });

  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];

    if (current.start - last.end < maxGapSec) {
      // Merge if gap is small enough
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}
