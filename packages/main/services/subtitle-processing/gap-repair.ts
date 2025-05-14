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
  SAVE_WHISPER_CHUNKS,
} from './constants.js';
import os from 'os';
import { mkdirSync, copyFileSync } from 'fs';
import { throwIfAborted } from './utils.js';

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

export function identifyGaps(caps: SrtSegment[], minDur = 1): RepairableGap[] {
  const gaps: RepairableGap[] = [];
  if (!caps.length) return gaps;

  if (caps[0].start >= minDur) {
    gaps.push({ start: 0, end: caps[0].start });
  }

  for (let i = 1; i < caps.length; i++) {
    const prevEnd = caps[i - 1].end;
    const curStart = caps[i].start;
    if (curStart - prevEnd >= minDur) {
      gaps.push({ start: prevEnd, end: curStart });
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

export function trimPhantomTail(seg: SrtSegment) {
  if (!('words' in seg) || !Array.isArray(seg.words) || !seg.words.length)
    return;

  const last = seg.words[seg.words.length - 1];
  const tail = seg.end - last.end;
  const PHANTOM_TAIL_SEC = 0.5;
  const TAIL_PADDING = 0.1;

  if (tail >= PHANTOM_TAIL_SEC) {
    seg.end = last.end + TAIL_PADDING;
  }
}

export async function refineOvershoots({
  segments,
  ffmpeg,
  signal,
  audioPath,
  tempDir,
  operationId,
  createdChunkPaths,
}: {
  segments: SrtSegment[];
  ffmpeg: FFmpegContext;
  signal: AbortSignal;
  audioPath: string;
  tempDir: string;
  operationId: string;
  createdChunkPaths: string[];
}): Promise<void> {
  const isBloated = (seg: SrtSegment) => {
    const duration = seg.end - seg.start;
    const wordCount = seg.original.trim().split(/\s+/).length;
    const wps = wordCount / duration;
    return duration > 4 || wps < 1.2;
  };

  const splits: Array<[number, SrtSegment, SrtSegment]> = [];

  for (let i = 0; i < segments.length; i++) {
    throwIfAborted(signal);
    const seg = segments[i];
    if (!isBloated(seg)) continue;

    const segAudioPath = path.join(
      tempDir,
      `seg_refine_${seg.index}_${operationId}.flac`
    );
    createdChunkPaths.push(segAudioPath);

    await extractAudioSegment(ffmpeg, {
      input: audioPath,
      output: segAudioPath,
      start: seg.start,
      duration: seg.end - seg.start,
      operationId,
      signal,
    });

    throwIfAborted(signal);

    const vadResults = await detectSpeechIntervals({
      inputPath: segAudioPath,
      operationId,
      signal,
    });

    throwIfAborted(signal);

    const speech = normalizeSpeechIntervals({ intervals: vadResults });
    let prev = 0;
    const silences = [];
    const segDur = seg.end - seg.start;
    for (const iv of speech) {
      if (iv.start - prev >= 0.6) {
        silences.push({ start: prev, end: iv.start });
      }
      prev = iv.end;
    }
    if (segDur - prev >= 0.6) {
      silences.push({ start: prev, end: segDur });
    }

    const cut = silences.find(
      sil =>
        sil.end - sil.start >= 0.6 && sil.start > 0.3 && segDur - sil.end > 0.3
    );
    if (cut) {
      const cutTime = seg.start + (cut.start + cut.end) / 2;
      const newSeg1 = { ...seg, end: cutTime };
      const newSeg2 = { ...seg, start: cutTime };
      splits.push([i, newSeg1, newSeg2]);
      log.info(
        `[${operationId}] Split seg ${seg.index}: ${(seg.end - seg.start).toFixed(1)}s ➜ ${(newSeg1.end - newSeg1.start).toFixed(1)}s + ${(newSeg2.end - newSeg2.start).toFixed(1)}s`
      );
    }
  }

  for (const [idx, left, right] of splits.reverse()) {
    segments.splice(idx, 1, left, right);
  }

  segments.sort((a, b) => a.start - b.start);
  segments.forEach((s, i) => (s.index = i + 1));
}

export function sanityScan({
  vadIntervals,
  segments,
  minGap,
}: {
  vadIntervals: Array<{ start: number; end: number }>;
  segments: SrtSegment[];
  minGap: number;
}): RepairableGap[] {
  const additionalGaps: RepairableGap[] = [];
  let vadIndex = 0;
  let segIndex = 0;

  while (vadIndex < vadIntervals.length) {
    const vad = vadIntervals[vadIndex];
    if (segIndex >= segments.length) segIndex = segments.length - 1;
    let covered = false;
    while (segIndex < segments.length) {
      const seg = segments[segIndex];
      if (seg.end < vad.start) {
        segIndex++;
        continue;
      }
      if (seg.start <= vad.end && seg.end >= vad.start) {
        covered = true;
        break;
      }
      if (seg.start > vad.end) {
        break;
      }
      segIndex++;
    }
    if (!covered && vad.end - vad.start >= minGap) {
      additionalGaps.push({ start: vad.start, end: vad.end });
    }
    vadIndex++;
  }
  return additionalGaps;
}
