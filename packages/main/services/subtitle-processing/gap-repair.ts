import { SrtSegment } from '@shared-types/app';
import { transcribeChunk } from './transcriber.js';
import path from 'path';
import log from 'electron-log';
import { extractAudioSegment, mkTempAudioName } from './audio-extractor.js';
import { FFmpegContext } from '../ffmpeg-runner.js';
import { SAVE_WHISPER_CHUNKS, GAP_SEC } from './constants.js';
import os from 'os';
import { mkdirSync, copyFileSync } from 'fs';
import { throwIfAborted } from './utils.js';

export interface RepairableGap {
  start: number;
  end: number;
}

export function identifyGaps(
  caps: SrtSegment[],
  minDur = GAP_SEC
): RepairableGap[] {
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
  mediaDuration,
}: {
  segments: SrtSegment[];
  ffmpeg: FFmpegContext;
  signal: AbortSignal;
  audioPath: string;
  tempDir: string;
  operationId: string;
  createdChunkPaths: string[];
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

    const origEnd = seg.end;
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
      const tailEnd = Math.min(origEnd, nextAbs);

      if (tailEnd - tailStart >= 0.2) {
        const tailSegs = await transcribeTailDirect({
          ffmpeg,
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
  wordsPerSide = 5
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
  const outPath = mkTempAudioName(
    path.join(outputDir, `overshoot_tail_${segIndex}_${operationId}`)
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
