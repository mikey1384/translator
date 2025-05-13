import { FFmpegContext } from '../../ffmpeg-runner.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import log from 'electron-log';
import crypto from 'crypto';
import { getApiKey } from '../openai-client.js';
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
  chunkSpeechInterval,
} from '../audio-chunker.js';
import { transcribeChunk } from '../transcriber.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import {
  buildContextPrompt,
  RepairableGap,
  uncoveredSpeech,
} from '../gap-repair.js';
import {
  PRE_PAD_SEC,
  POST_PAD_SEC,
  MAX_SPEECHLESS_SEC,
  MAX_CHUNK_DURATION_SEC,
  MIN_CHUNK_DURATION_SEC,
  MERGE_GAP_SEC,
  PROGRESS_ANALYSIS_DONE,
  TRANSCRIPTION_BATCH_SIZE,
  GAP_SEC,
  MAX_PROMPT_CHARS,
  LOG_PROB_THRESHOLD,
} from '../constants.js';
import { SubtitleProcessingError } from '../errors.js';
import { Stage, scaleProgress } from './progress.js';
import { extractAudioSegment } from '../audio-extractor.js';
import os from 'os';
import { mkdirSync, copyFileSync } from 'fs';

const SAVE_WHISPER_CHUNKS = true;

const MIN_DURATION_FOR_RETRY_SPLIT_SEC = 5.0;
const MIN_HALF_DURATION_FACTOR = 0.8;

function maybeCopyForDebug(srcPath: string, opId: string, _idx: number) {
  if (!SAVE_WHISPER_CHUNKS) return;
  const debugDir = path.join(os.homedir(), 'Desktop', 'whisper_chunks', opId);
  mkdirSync(debugDir, { recursive: true });
  const dst = path.join(debugDir, path.basename(srcPath));
  copyFileSync(srcPath, dst);
}

export async function transcribePass({
  audioPath,
  services,
  progressCallback,
  operationId,
  signal,
}: {
  audioPath: string;
  services: { ffmpeg: FFmpegContext };
  progressCallback?: GenerateProgressCallback;
  operationId: string;
  signal: AbortSignal;
}): Promise<{
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
}> {
  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const tempDir = path.dirname(audioPath);
  const createdChunkPaths: string[] = [];

  try {
    const openaiApiKey = await getApiKey('openai');
    openai = new OpenAI({ apiKey: openaiApiKey });

    if (!services?.ffmpeg) {
      throw new SubtitleProcessingError('FFmpegContext is required.');
    }
    const { ffmpeg } = services;

    if (!fs.existsSync(audioPath)) {
      throw new SubtitleProcessingError(`Audio file not found: ${audioPath}`);
    }

    const duration = await ffmpeg.getMediaDuration(audioPath, signal);
    if (signal?.aborted) throw new Error('Cancelled');

    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Unable to determine valid audio duration.'
      );
    }

    // -------------------------------------------------------------------------
    // 2. VAD + chunking
    // -------------------------------------------------------------------------
    progressCallback?.({
      percent: Stage.TRANSCRIBE,
      stage: 'Analyzing audio for chunk boundaries...',
    });

    const raw = await detectSpeechIntervals({
      inputPath: audioPath,
      operationId,
      signal,
    });
    if (signal?.aborted) throw new Error('Cancelled');

    const cleaned = normalizeSpeechIntervals({ intervals: raw });
    const merged = mergeAdjacentIntervals(cleaned, MERGE_GAP_SEC).flatMap(iv =>
      iv.end - iv.start > MAX_SPEECHLESS_SEC
        ? chunkSpeechInterval({ interval: iv, duration: MAX_SPEECHLESS_SEC })
        : [iv]
    );

    let idx = 0;
    let chunkStart: number | null = null;
    let currEnd = 0;

    const chunks: Array<{ start: number; end: number; index: number }> = [];
    merged.sort((a, b) => a.start - b.start);
    for (const blk of merged) {
      const s = Math.max(0, blk.start - PRE_PAD_SEC);
      const e = Math.min(duration, blk.end + POST_PAD_SEC);

      if (e <= s) {
        log.warn(
          `[${operationId}] Skipping zero/negative duration VAD block after padding: ${s.toFixed(
            2
          )}-${e.toFixed(2)}`
        );
        continue;
      }

      if (chunkStart === null) {
        chunkStart = s;
      }
      currEnd = e;

      if (currEnd - chunkStart >= MAX_CHUNK_DURATION_SEC) {
        chunks.push({ start: chunkStart, end: currEnd, index: ++idx });
        chunkStart = null;
      }
    }

    // Flush any remaining short tail block
    if (chunkStart !== null) {
      if (currEnd > chunkStart) {
        chunks.push({ start: chunkStart, end: currEnd, index: ++idx });
      } else {
        log.warn(
          `[${operationId}] Skipping final chunk due to zero/negative duration: ${chunkStart.toFixed(
            2
          )}-${currEnd.toFixed(2)}`
        );
      }
    }

    log.info(
      `[${operationId}] VAD grouping produced ${chunks.length} chunk(s) (≥${MIN_CHUNK_DURATION_SEC}s).`
    );
    progressCallback?.({
      percent: scaleProgress(
        PROGRESS_ANALYSIS_DONE,
        Stage.TRANSCRIBE,
        Stage.TRANSCRIBE
      ),
      stage: `Chunked audio into ${chunks.length} parts`,
    });

    progressCallback?.({
      percent: scaleProgress(20, Stage.TRANSCRIBE, Stage.TRANSLATE),
      stage: `Starting transcription of ${chunks.length} chunks...`,
    });

    let batchContext = '';

    let done = 0;
    for (let b = 0; b < chunks.length; b += TRANSCRIPTION_BATCH_SIZE) {
      const slice = chunks.slice(b, b + TRANSCRIPTION_BATCH_SIZE);

      log.info(
        `[${operationId}] Processing transcription batch ${Math.ceil(
          (b + slice.length) / TRANSCRIPTION_BATCH_SIZE
        )}/${Math.ceil(chunks.length / TRANSCRIPTION_BATCH_SIZE)} (Chunks ${
          b + 1
        }-${b + slice.length})`
      );

      const promptForSlice = buildPrompt(batchContext);

      const segArraysPromises = slice.map(async meta => {
        if (signal?.aborted) throw new Error('Cancelled');

        if (meta.end <= meta.start) {
          log.warn(
            `[${operationId}] Skipping chunk ${meta.index} due to zero/negative duration: ${meta.start.toFixed(
              2
            )}-${meta.end.toFixed(2)}`
          );
          return [];
        }

        // Create a temp chunk
        const flacPath = path.join(
          tempDir,
          `chunk_${meta.index}_${operationId}.flac`
        );
        createdChunkPaths.push(flacPath);

        try {
          await extractAudioSegment(ffmpeg, {
            input: audioPath,
            output: flacPath,
            start: meta.start,
            duration: meta.end - meta.start,
            operationId: operationId ?? '',
            signal,
          });

          maybeCopyForDebug(flacPath, operationId, meta.index);

          if (signal?.aborted) throw new Error('Cancelled');

          const segs = await transcribeChunk({
            chunkIndex: meta.index,
            chunkPath: flacPath,
            startTime: meta.start,
            signal,
            openai,
            operationId: operationId ?? '',
            promptContext: promptForSlice,
            mediaDuration: duration,
          });

          if (signal?.aborted) throw new Error('Cancelled');

          return segs;
        } catch (chunkError: any) {
          if (chunkError?.message === 'Cancelled') {
            log.info(
              `[${operationId}] Chunk ${meta.index} processing cancelled.`
            );
            return [];
          }
          log.error(
            `[${operationId}] Error processing chunk ${meta.index}:`,
            chunkError?.message || chunkError
          );
          progressCallback?.({
            percent: -1,
            stage: `Error in chunk ${meta.index}`,
            error: chunkError?.message || String(chunkError),
          });
          return [];
        }
      });

      const segArrays = await Promise.all(segArraysPromises);
      const thisBatchSegments = segArrays
        .flat()
        .sort((a, b) => a.start - b.start);

      overallSegments.push(...thisBatchSegments);

      const orderedText = thisBatchSegments.map(s => s.original).join(' ');
      batchContext += ' ' + orderedText;
      batchContext = buildPrompt(batchContext);

      done += slice.length;
      const p = scaleProgress(
        (done / chunks.length) * 100,
        Stage.TRANSCRIBE,
        Stage.TRANSLATE
      );

      const intermediateSrt = buildSrt({
        segments: overallSegments.slice().sort((a, b) => a.start - b.start),
        mode: 'dual',
      });

      log.debug(
        `[Transcription Loop] Built intermediateSrt (first 100 chars): "${intermediateSrt.substring(
          0,
          100
        )}", Percent: ${Math.round(p)}`
      );
      progressCallback?.({
        percent: Math.round(p),
        stage: `Transcribed & scrubbed ${done}/${chunks.length} chunks`,
        current: done,
        total: chunks.length,
        partialResult: intermediateSrt,
      });

      if (signal?.aborted) throw new Error('Cancelled');
    }

    overallSegments.sort((a, b) => a.start - b.start);

    const isWeak = (seg: SrtSegment) => {
      const words = seg.original.trim().split(/\s+/).length;
      const avgLogprob = seg.avg_logprob ?? 0;
      return avgLogprob < LOG_PROB_THRESHOLD || words < 3;
    };
    overallSegments.forEach(s => {
      if (s.start < 30 && isWeak(s)) {
        s.original = '';
      }
    });
    // Filter out segments with empty original text
    const filteredSegments = overallSegments.filter(
      s => s.original.trim() !== ''
    );
    overallSegments.length = 0;
    overallSegments.push(...filteredSegments);

    const anchors: SrtSegment[] = [];
    let tmpIdx = 0;
    for (let i = 1; i < overallSegments.length; i++) {
      const gap = overallSegments[i].start - overallSegments[i - 1].end;
      if (gap > GAP_SEC) {
        anchors.push({
          id: crypto.randomUUID(),
          index: ++tmpIdx,
          start: overallSegments[i - 1].end,
          end: overallSegments[i - 1].end + 0.5,
          original: '',
        });
      }
    }
    overallSegments.push(...anchors);
    overallSegments.sort((a, b) => a.start - b.start);

    const repairGaps = uncoveredSpeech(merged, overallSegments, 1);

    // NEW: Deduplicate repair gaps to avoid duplicate head-gap ranges
    repairGaps.sort((a, b) => a.start - b.start);
    const dedupedRepairGaps: RepairableGap[] = [];
    for (const g of repairGaps) {
      if (
        !dedupedRepairGaps.length ||
        g.start >= dedupedRepairGaps.at(-1)!.end - 0.01
      ) {
        dedupedRepairGaps.push(g);
      }
    }
    log.info(
      `[${operationId}] Found ${dedupedRepairGaps.length} big gap(s) in speech after deduplication. Attempting to fill...`
    );

    if (dedupedRepairGaps.length === 0) {
      return {
        segments: overallSegments,
        speechIntervals: merged.slice(),
      };
    }

    if (dedupedRepairGaps.length > 0) {
      progressCallback?.({
        percent: scaleProgress(90, Stage.TRANSCRIBE, Stage.TRANSLATE),
        stage: `Repairing missing captions 0 / ${dedupedRepairGaps.length}`,
      });
    }
    let lastPct = -1;
    const newlyRepairedSegments: SrtSegment[] = [];
    for (let i = 0; i < dedupedRepairGaps.length; i++) {
      if (signal?.aborted) break;

      const gap = dedupedRepairGaps[i];
      // NEW: Wider window for early gaps with clamping
      let adjustedGap = { ...gap };
      if (gap.start < 10) {
        const pad = 15;
        const winStart = Math.max(0, gap.start - pad);
        let winEnd = gap.end + pad;
        // Clamp window size to avoid exceeding MAX_CHUNK_DURATION_SEC
        if (winEnd - winStart > MAX_CHUNK_DURATION_SEC) {
          winEnd = winStart + MAX_CHUNK_DURATION_SEC;
        }
        adjustedGap = { start: winStart, end: winEnd };
      }
      const gapIndex = i + 1;
      const baseLogIdx = 10000 + gapIndex;

      const contextSegmentsForThisGap = [
        ...overallSegments,
        ...newlyRepairedSegments,
      ].sort((a, b) => a.start - b.start);

      const newSegs = await transcribeGapAudioWithRetry(
        adjustedGap,
        baseLogIdx,
        'first_repair_gap',
        contextSegmentsForThisGap,
        {
          audioPath,
          tempDir,
          operationId,
          signal,
          ffmpeg,
          openai,
          createdChunkPaths,
          mediaDuration: duration,
        }
      );
      // NEW: Fix overlap filter to use adjustedGap
      const filteredNewSegs = newSegs.filter(
        seg => seg.end > adjustedGap.start && seg.start < adjustedGap.end
      );
      newlyRepairedSegments.push(...filteredNewSegs);

      const pct = scaleProgress(
        ((i + 1) / dedupedRepairGaps.length) * 100,
        Stage.TRANSCRIBE,
        Stage.TRANSLATE
      );
      if (Math.round(pct) !== lastPct) {
        progressCallback?.({
          percent: Math.round(pct),
          stage: `Repairing missing captions ${i + 1} / ${dedupedRepairGaps.length}`,
          current: i + 1,
          total: dedupedRepairGaps.length,
        });
        lastPct = Math.round(pct);
      }
    }
    overallSegments.push(...newlyRepairedSegments);
    overallSegments.sort((a, b) => a.start - b.start);
    overallSegments.forEach((segment, index) => {
      segment.index = index + 1;
    });
    if (dedupedRepairGaps.length > 0) {
      progressCallback?.({
        percent: scaleProgress(100, Stage.TRANSCRIBE, Stage.TRANSLATE),
        stage: 'Gap-repair pass complete',
      });
    }

    overallSegments.sort((a, b) => a.start - b.start);
    overallSegments.forEach((s, i) => (s.index = i + 1));

    return {
      segments: overallSegments,
      speechIntervals: merged.slice(),
    };
  } catch (error: any) {
    console.error(
      `[${operationId}] Error in transcribePass:`,
      error?.message || error
    );
    const isCancel =
      error.name === 'AbortError' ||
      error.message === 'Cancelled' ||
      signal?.aborted;

    progressCallback?.({
      percent: 100,
      stage: isCancel
        ? 'Process cancelled'
        : `Error: ${error?.message || String(error)}`,
      error: !isCancel ? error?.message || String(error) : undefined,
    });

    if (error instanceof SubtitleProcessingError || isCancel) {
      throw error;
    } else {
      throw new SubtitleProcessingError(error?.message || String(error));
    }
  } finally {
    log.info(
      `[${operationId}] Cleaning up ${createdChunkPaths.length} temporary chunk files...`
    );
    if (!SAVE_WHISPER_CHUNKS) {
      await Promise.allSettled(
        createdChunkPaths.map(p =>
          fsp.unlink(p).catch(err => {
            log.warn(
              `[${operationId}] Failed to delete temp chunk file ${p}:`,
              err?.message || err
            );
          })
        )
      );
    }
    log.info(`[${operationId}] Finished cleaning up temporary chunk files.`);
  }

  function buildPrompt(history: string) {
    return history.length <= MAX_PROMPT_CHARS
      ? history
      : history.slice(-MAX_PROMPT_CHARS);
  }

  async function transcribeGapAudioWithRetry(
    gapToProcess: RepairableGap, // The {start, end} of the current audio section to transcribe
    baseChunkLogIdx: number, // For unique logging and file naming (e.g., 10001, 30001)
    filePrefix: string, // e.g., 'first_repair_gap', 'final_repair_gap'
    allKnownSegmentsForContext: SrtSegment[], // All segments known so far (sorted) for building prompt
    {
      // Standard parameters
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
    const gapDuration = gapToProcess.end - gapToProcess.start;

    // Build context for the entire current gapToProcess
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

    function isGood(seg: any) {
      const WORDS = seg.original.trim().split(/\s+/).length;
      const DURATION = seg.end - seg.start;
      return (
        seg.avg_logprob > LOG_PROB_THRESHOLD && WORDS >= 2 && DURATION > 0.35
      );
    }

    const goodSegs = segments.filter(isGood);
    if (goodSegs.length === 0) {
      segments.length = 0; // force the VAD-split retry
    }

    // If initial attempt is empty and gap is long enough, try splitting and retrying using VAD
    if (
      segments.length === 0 &&
      gapDuration >= MIN_DURATION_FOR_RETRY_SPLIT_SEC
    ) {
      log.info(
        `[${operationId}] Gap chunk ${baseChunkLogIdx} (${filePrefix}) was empty. Using VAD to split (${gapDuration.toFixed(2)}s long) for retry.`
      );

      const retriedSegmentsFromHalves: SrtSegment[] = [];

      const vadIntervals = await detectSpeechIntervals({
        inputPath: originalGapAudioFilePath,
        operationId,
        signal,
      });

      if (signal?.aborted) return [];

      const normalizedIntervals = normalizeSpeechIntervals({
        intervals: vadIntervals,
      });
      const mergedIntervals = mergeAdjacentIntervals(
        normalizedIntervals,
        MERGE_GAP_SEC
      );

      if (mergedIntervals.length === 0) {
        log.info(
          `[${operationId}] No speech detected in gap ${baseChunkLogIdx} (${filePrefix}) during VAD retry. Falling back to 50:50 split.`
        );
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
          if (signal?.aborted) break;
          const halfDur = half.end - half.start;

          if (halfDur < MIN_CHUNK_DURATION_SEC * MIN_HALF_DURATION_FACTOR) {
            log.warn(
              `[${operationId}] Skipping retry for half ${half.id} of gap ${baseChunkLogIdx} (${filePrefix}) due to very short duration: ${halfDur.toFixed(2)}s`
            );
            continue;
          }

          const halfAudioFilePath = path.join(
            tempDir,
            `${filePrefix}_${baseChunkLogIdx}_half_${half.id}_${operationId}.flac`
          );
          createdChunkPaths.push(halfAudioFilePath);
          const halfLogIdx = baseChunkLogIdx * 100 + half.retryLogIdxOffset; // Ensure distinct log/debug index

          await extractAudioSegment(ffmpeg, {
            input: audioPath, // Extract from original audio
            output: halfAudioFilePath,
            start: half.start,
            duration: halfDur,
            operationId,
            signal,
          });
          maybeCopyForDebug(halfAudioFilePath, operationId, halfLogIdx);

          // Use the same context as the original full gap for the halves
          const segmentsFromHalf = await transcribeChunk({
            chunkIndex: halfLogIdx,
            chunkPath: halfAudioFilePath,
            startTime: half.start,
            signal,
            openai,
            operationId,
            promptContext: promptForOriginalGap, // Reuse context
            mediaDuration,
          });
          retriedSegmentsFromHalves.push(...segmentsFromHalf);
        }
      } else {
        log.info(
          `[${operationId}] Detected ${mergedIntervals.length} speech interval(s) in gap ${baseChunkLogIdx} (${filePrefix}) for retry.`
        );
        let intervalIndex = 0;
        for (const interval of mergedIntervals) {
          if (signal?.aborted) break;
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
          const intervalLogIdx = baseChunkLogIdx * 100 + intervalIndex + 1; // Ensure distinct log/debug index

          await extractAudioSegment(ffmpeg, {
            input: audioPath,
            output: intervalAudioFilePath,
            start: intervalStart,
            duration: intervalDur,
            operationId,
            signal,
          });
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
          retriedSegmentsFromHalves.push(...segmentsFromInterval);
          intervalIndex++;
        }
      }
      segments = retriedSegmentsFromHalves; // Replace original empty result
    }
    return segments;
  }
}
