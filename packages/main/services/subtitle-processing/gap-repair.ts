import { SrtSegment } from '@shared-types/app';
import { transcribeChunk } from './transcriber.js';
import path from 'path';
import log from 'electron-log';
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
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
} from './audio-chunker.js';

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
    promptContext:
      gapDuration <= MIN_DURATION_FOR_RETRY_SPLIT_SEC
        ? promptForOriginalGap
        : undefined,
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
  if (!seg.words || !Array.isArray(seg.words) || !seg.words.length) {
    return;
  }

  const last = seg.words[seg.words.length - 1];
  const lastAbsEnd = last.end + seg.start;
  const tail = seg.end - lastAbsEnd;
  const PHANTOM_TAIL_SEC = 0.5;
  const TAIL_PADDING = 0.1;

  if (tail >= PHANTOM_TAIL_SEC) {
    seg.end = lastAbsEnd + TAIL_PADDING;
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
  openai,
  mediaDuration,
}: {
  segments: SrtSegment[];
  ffmpeg: FFmpegContext;
  signal: AbortSignal;
  audioPath: string;
  tempDir: string;
  operationId: string;
  createdChunkPaths: string[];
  openai: OpenAI;
  mediaDuration: number;
}): Promise<void> {
  const MAX_SEC_PER_WORD = 0.55;
  const SILENCE_CAP = 5;

  function isBloated(seg: SrtSegment) {
    const dur = seg.end - seg.start;
    if (dur <= 0) return false;
    const words = seg.original.trim().split(/\s+/).filter(Boolean).length;
    if (words === 0) return false;
    const speechBudget = words * MAX_SEC_PER_WORD;
    const silence = dur - speechBudget;
    return silence > SILENCE_CAP;
  }

  const maxReasonableDur = (word: string) => {
    const syll = Math.max(1, Math.ceil(word.length / 3));
    return 0.66 * syll + 0.2;
  };

  for (let i = 0; i < segments.length; i++) {
    throwIfAborted(signal);
    const seg = segments[i];
    if (!isBloated(seg) || !seg.words?.length) continue;

    let trustedEndAbs = seg.start;
    for (const w of seg.words) {
      const dur = w.end - w.start;
      if (dur <= 0 || dur > maxReasonableDur(w.word)) break;
      trustedEndAbs = seg.start + w.end;
    }

    const cutAbs = trustedEndAbs + 0.1;
    const nextAbs = segments[i + 1]?.start ?? mediaDuration;
    const newEnd = Math.min(cutAbs, nextAbs - 0.05, mediaDuration);

    if (newEnd < seg.end - 0.2) {
      log.debug(
        `[${operationId}] Trim seg ${seg.index}: ${seg.end.toFixed(2)} → ${newEnd.toFixed(2)}`
      );
      seg.end = newEnd;

      const tailStart = newEnd;
      const tailEnd = nextAbs;

      if (tailEnd - tailStart >= 0.2) {
        const tailSegs = await transcribeTailDirect({
          ffmpeg,
          openai,
          inputPath: audioPath,
          outputDir: tempDir,
          start: tailStart,
          end: tailEnd,
          segIndex: seg.index,
          operationId,
          promptContext: buildContextPrompt(segments, {
            start: tailStart,
            end: tailEnd,
          }),
          signal,
          createdChunkPaths,
        });

        segments.push(...tailSegs);
      }
    }
  }

  segments.sort((a, b) => a.start - b.start);
  segments.forEach((s, idx) => (s.index = idx + 1));
}

function buildContextPrompt(
  allSegments: SrtSegment[],
  gap: { start: number; end: number },
  wordsPerSide = 80
): string {
  const collect = (segs: SrtSegment[], takeLast: boolean): string => {
    let words: string[] = [];
    const segmentsToProcess = takeLast ? [...segs].reverse() : segs;

    for (const s of segmentsToProcess) {
      if (!s.original?.trim()) {
        continue;
      }
      const pieces = s.original.trim().split(/\s+/);
      words = takeLast ? [...pieces, ...words] : [...words, ...pieces];
      if (words.length >= wordsPerSide) {
        break;
      }
    }
    const collectedWords = takeLast
      ? words.slice(-wordsPerSide)
      : words.slice(0, wordsPerSide);
    return collectedWords.join(' ');
  };

  const beforeText =
    collect(
      allSegments.filter(s => s.end < gap.start - 0.01),
      true
    ) || '<none>';

  const afterText =
    collect(
      allSegments.filter(s => s.start > gap.end + 0.01),
      false
    ) || '<none>';

  return `<before>\n${beforeText}\n</before>\n<after>\n${afterText}\n</after>\n<transcript>`;
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

async function transcribeTailDirect({
  ffmpeg,
  openai,
  inputPath,
  outputDir,
  start,
  end,
  segIndex,
  operationId,
  promptContext = '',
  signal,
  createdChunkPaths,
}: {
  ffmpeg: FFmpegContext;
  openai: OpenAI;
  inputPath: string;
  outputDir: string;
  start: number;
  end: number;
  segIndex: number;
  operationId: string;
  promptContext?: string;
  signal: AbortSignal;
  createdChunkPaths: string[];
}): Promise<SrtSegment[]> {
  const outPath = path.join(
    outputDir,
    `overshoot_tail_${segIndex}_${operationId}.flac`
  );
  await extractAudioSegment(ffmpeg, {
    input: inputPath,
    output: outPath,
    start,
    duration: end - start,
    operationId,
    signal,
  });

  createdChunkPaths.push(outPath);
  maybeCopyForDebug(outPath, operationId, segIndex);

  const segs = await transcribeChunk({
    chunkIndex:
      segIndex * 1000000 + Number(process.hrtime.bigint() % BigInt(1000000)),
    chunkPath: outPath,
    startTime: start,
    signal,
    openai,
    operationId,
    promptContext,
  });

  if (segs.length === 0) {
    log.debug(
      `[${operationId}] No segments returned from Whisper for tail of seg ${segIndex}`
    );
  }

  return segs;
}
