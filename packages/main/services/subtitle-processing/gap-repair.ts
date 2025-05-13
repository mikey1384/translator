import { SrtSegment } from '@shared-types/app';
import { transcribeChunk } from './transcriber.js';
import path from 'path';
import log from 'electron-log';
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
} from './audio-chunker.js';
import { extractAudioSegment } from './audio-extractor.js';
import { FFmpegContext } from '../ffmpeg-runner.js';
import OpenAI from 'openai';
import {
  MIN_DURATION_FOR_RETRY_SPLIT_SEC,
  MIN_CHUNK_DURATION_SEC,
  MIN_HALF_DURATION_FACTOR,
  MERGE_GAP_SEC,
  NO_SPEECH_PROB_THRESHOLD,
  LOG_PROB_THRESHOLD,
} from './constants.js';
import os from 'os';
import { mkdirSync, copyFileSync } from 'fs';
import { throwIfAborted } from './utils/cancel.js';

const SAVE_WHISPER_CHUNKS = true;

export function buildContextPrompt(
  allSegments: SrtSegment[],
  gap: { start: number; end: number },
  wordsPerSide = 80
) {
  const beforeText = allSegments
    .filter(s => s.end <= gap.start)
    .slice(-3)
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(-wordsPerSide)
    .join(' ');

  const afterText = allSegments
    .filter(s => s.start >= gap.end)
    .slice(0, 3)
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(0, wordsPerSide)
    .join(' ');

  return `Context before:\n${beforeText}\n\nContext after:\n${afterText}\n\nTranscript:`;
}

export interface RepairableGap {
  start: number;
  end: number;
}

export function uncoveredSpeech(
  speech: Array<{ start: number; end: number }>,
  caps: SrtSegment[],
  minDur = 1
): RepairableGap[] {
  const gaps: RepairableGap[] = [];
  for (const iv of speech) {
    const firstCapStart = caps[0]?.start ?? iv.end;
    if (firstCapStart - iv.start >= minDur) {
      gaps.push({ start: iv.start, end: firstCapStart });
    }
    let ptr = iv.start;
    for (const c of caps.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - ptr >= minDur) gaps.push({ start: ptr, end: c.start });
      ptr = Math.max(ptr, c.end);
    }
    if (iv.end - ptr >= minDur) gaps.push({ start: ptr, end: iv.end });

    const lastCapEnd = caps.at(-1)?.end ?? iv.start;
    if (iv.end - lastCapEnd >= minDur) {
      gaps.push({ start: lastCapEnd, end: iv.end });
    }
  }
  return gaps;
}

export async function transcribeGapAudioWithRetry(
  gapToProcess: RepairableGap,
  baseChunkLogIdx: number,
  filePrefix: string,
  allKnownSegmentsForContext: SrtSegment[],
  {
    audioPath,
    tempDir,
    operationId,
    signal,
    ffmpeg,
    openai,
    createdChunkPaths,
    mediaDuration,
  }: {
    audioPath: string;
    tempDir: string;
    operationId: string;
    signal: AbortSignal;
    ffmpeg: FFmpegContext;
    openai: OpenAI;
    createdChunkPaths: string[];
    mediaDuration: number;
  }
): Promise<SrtSegment[]> {
  throwIfAborted(signal);
  const gapDuration = gapToProcess.end - gapToProcess.start;

  const promptForOriginalGap = buildContextPrompt(
    allKnownSegmentsForContext,
    gapToProcess
  );

  const originalGapAudioFilePath = path.join(
    tempDir,
    `${filePrefix}_${baseChunkLogIdx}_${operationId}.flac`
  );
  createdChunkPaths.push(originalGapAudioFilePath);

  await extractAudioSegment(ffmpeg, {
    input: audioPath,
    output: originalGapAudioFilePath,
    start: gapToProcess.start,
    duration: gapDuration,
    operationId,
    signal,
  });
  throwIfAborted(signal);
  maybeCopyForDebug(originalGapAudioFilePath, operationId, baseChunkLogIdx);

  let segments = await transcribeChunk({
    chunkIndex: baseChunkLogIdx,
    chunkPath: originalGapAudioFilePath,
    startTime: gapToProcess.start,
    signal,
    openai,
    operationId,
    promptContext: promptForOriginalGap,
    mediaDuration,
  });

  const goodSegs = segments.filter(isGood);

  if (
    goodSegs.length === 0 &&
    gapDuration >= MIN_DURATION_FOR_RETRY_SPLIT_SEC
  ) {
    const retriedSegmentsFromHalves: SrtSegment[] = [];

    const vadIntervals = await detectSpeechIntervals({
      inputPath: originalGapAudioFilePath,
      operationId,
      signal,
    });
    throwIfAborted(signal);

    const normalizedIntervals = normalizeSpeechIntervals({
      intervals: vadIntervals,
    });
    const mergedIntervals = mergeAdjacentIntervals(
      normalizedIntervals,
      MERGE_GAP_SEC
    );

    if (mergedIntervals.length === 0) {
      const midPoint = gapToProcess.start + gapDuration / 2;
      const halves = [
        {
          id: 'a',
          start: gapToProcess.start,
          end: midPoint,
          retryLogIdxOffset: 1,
        },
        {
          id: 'b',
          start: midPoint,
          end: gapToProcess.end,
          retryLogIdxOffset: 2,
        },
      ];

      for (const half of halves) {
        throwIfAborted(signal);
        const halfDur = half.end - half.start;

        if (halfDur < MIN_CHUNK_DURATION_SEC * MIN_HALF_DURATION_FACTOR) {
          continue;
        }

        const halfAudioFilePath = path.join(
          tempDir,
          `${filePrefix}_${baseChunkLogIdx}_half_${half.id}_${operationId}.flac`
        );
        createdChunkPaths.push(halfAudioFilePath);
        const halfLogIdx = baseChunkLogIdx * 100 + half.retryLogIdxOffset;

        await extractAudioSegment(ffmpeg, {
          input: audioPath,
          output: halfAudioFilePath,
          start: half.start,
          duration: halfDur,
          operationId,
          signal,
        });
        throwIfAborted(signal);
        maybeCopyForDebug(halfAudioFilePath, operationId, halfLogIdx);

        const segmentsFromHalf = await transcribeChunk({
          chunkIndex: halfLogIdx,
          chunkPath: halfAudioFilePath,
          startTime: half.start,
          signal,
          openai,
          operationId,
          promptContext: promptForOriginalGap,
          mediaDuration,
        });
        retriedSegmentsFromHalves.push(...segmentsFromHalf.filter(isGood));
      }
    } else {
      let intervalIndex = 0;
      for (const interval of mergedIntervals) {
        throwIfAborted(signal);
        const intervalStart = gapToProcess.start + interval.start;
        const intervalEnd = gapToProcess.start + interval.end;
        const intervalDur = intervalEnd - intervalStart;

        if (intervalDur < MIN_CHUNK_DURATION_SEC * MIN_HALF_DURATION_FACTOR) {
          log.warn(
            `[${operationId}] Skipping retry for interval ${intervalIndex} of gap ${baseChunkLogIdx} (${filePrefix}) due to very short duration: ${intervalDur.toFixed(2)}s`
          );
          intervalIndex++;
          continue;
        }

        const intervalAudioFilePath = path.join(
          tempDir,
          `${filePrefix}_${baseChunkLogIdx}_interval_${intervalIndex}_${operationId}.flac`
        );
        createdChunkPaths.push(intervalAudioFilePath);
        const intervalLogIdx = baseChunkLogIdx * 100 + intervalIndex + 1;

        await extractAudioSegment(ffmpeg, {
          input: audioPath,
          output: intervalAudioFilePath,
          start: intervalStart,
          duration: intervalDur,
          operationId,
          signal,
        });
        throwIfAborted(signal);
        maybeCopyForDebug(intervalAudioFilePath, operationId, intervalLogIdx);

        const segmentsFromInterval = await transcribeChunk({
          chunkIndex: intervalLogIdx,
          chunkPath: intervalAudioFilePath,
          startTime: intervalStart,
          signal,
          openai,
          operationId,
          promptContext: promptForOriginalGap,
          mediaDuration,
        });
        retriedSegmentsFromHalves.push(...segmentsFromInterval.filter(isGood));
        intervalIndex++;
      }
    }
    segments = retriedSegmentsFromHalves;
  } else {
    segments = goodSegs;
  }

  log.debug(
    `[${operationId}] gapIdx=${baseChunkLogIdx} after retry whisper segments=${segments.length}`
  );

  return segments;
}

function isGood(seg: SrtSegment): boolean {
  const WORDS = seg.original.trim().split(/\s+/).length;
  const DUR = seg.end - seg.start;
  return (
    (seg.no_speech_prob ?? 1) < NO_SPEECH_PROB_THRESHOLD &&
    (seg.avg_logprob ?? 0) > LOG_PROB_THRESHOLD &&
    WORDS >= 2 &&
    DUR > 0.35
  );
}

function maybeCopyForDebug(srcPath: string, opId: string, _idx: number) {
  if (!SAVE_WHISPER_CHUNKS) return;
  const debugDir = path.join(os.homedir(), 'Desktop', 'whisper_chunks', opId);
  mkdirSync(debugDir, { recursive: true });
  const dst = path.join(debugDir, path.basename(srcPath));
  copyFileSync(srcPath, dst);
}
