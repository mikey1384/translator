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
  RepairableGap,
  transcribeGapAudioWithRetry,
  identifyGaps,
  trimPhantomTail,
  sanityScan,
} from '../gap-repair.js';
import {
  SAVE_WHISPER_CHUNKS,
  PRE_PAD_SEC,
  POST_PAD_SEC,
  MAX_SPEECHLESS_SEC,
  MAX_CHUNK_DURATION_SEC,
  MIN_CHUNK_DURATION_SEC,
  MIN_REPAIR_GAP_SEC,
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
import pLimit from 'p-limit';
import { throwIfAborted } from '../utils.js';
import { refineOvershoots } from '../gap-repair.js';

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
    const CONCURRENCY = Math.max(
      1,
      parseInt(process.env.WHISPER_PARALLEL ?? '3', 10)
    );
    const limit = pLimit(CONCURRENCY);
    signal?.addEventListener('abort', () => limit.clearQueue());
    for (let b = 0; b < chunks.length; b += TRANSCRIPTION_BATCH_SIZE) {
      throwIfAborted(signal);
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
        throwIfAborted(signal);
        if (meta.end <= meta.start) {
          log.warn(
            `[${operationId}] Skipping chunk ${meta.index} due to zero/negative duration: ${meta.start.toFixed(
              2
            )}-${meta.end.toFixed(2)}`
          );
          return [];
        }

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

      if (signal?.aborted) {
        throwIfAborted(signal);
        return {
          segments: overallSegments,
          speechIntervals: merged.slice(),
        };
      }
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
    const filteredSegments = overallSegments.filter(
      s => s.original.trim() !== ''
    );
    overallSegments.length = 0;
    overallSegments.push(...filteredSegments);
    overallSegments.forEach(trimPhantomTail);

    await refineOvershoots({
      segments: overallSegments,
      signal,
      operationId,
      mediaDuration: duration,
      ffmpeg,
      audioPath,
      tempDir,
      createdChunkPaths,
      openai,
    });

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

    overallSegments.forEach((s, i) => (s.index = i + 1));

    const additionalGaps = sanityScan({
      vadIntervals: merged,
      segments: overallSegments,
      minGap: MIN_REPAIR_GAP_SEC,
    });
    log.info(
      `[${operationId}] Sanity scan found ${additionalGaps.length} additional gaps.`
    );

    const repairGapsInput = [
      ...identifyGaps(overallSegments, MIN_REPAIR_GAP_SEC),
      ...additionalGaps,
    ];

    const dedupeGaps = (gaps: RepairableGap[]): RepairableGap[] => {
      if (!gaps.length) return [];
      const sortedGaps = [...gaps].sort((a, b) => a.start - b.start);
      if (sortedGaps.length === 0) return [];
      const deduped: RepairableGap[] = [sortedGaps[0]];
      for (let i = 1; i < sortedGaps.length; i++) {
        const g = sortedGaps[i];
        if (g.start <= deduped.at(-1)!.end + 0.01) {
          deduped.at(-1)!.end = Math.max(deduped.at(-1)!.end, g.end);
        } else {
          deduped.push(g);
        }
      }
      return deduped;
    };

    let repairGaps = dedupeGaps(repairGapsInput);

    log.info(
      `[${operationId}] Found ${repairGaps.length} big gap(s) in speech (after deduplication). Attempting to fill...`
    );

    if (repairGaps.length === 0) {
      return {
        segments: overallSegments,
        speechIntervals: merged.slice(),
      };
    }

    let iteration = 1;
    const maxIterations = 2;

    while (
      repairGaps.length > 0 &&
      iteration <= maxIterations &&
      !signal?.aborted
    ) {
      let processedInPass = 0;
      const totalGaps = repairGaps.length;
      const newlyRepairedSegments: SrtSegment[] = [];
      log.info(
        `[${operationId}] Starting gap repair iteration ${iteration}/${maxIterations} with ${repairGaps.length} gaps to repair.`
      );

      if (repairGaps.length > 0) {
        progressCallback?.({
          percent: scaleProgress(90, Stage.TRANSCRIBE, Stage.TRANSLATE),
          stage: `Repairing missing captions (Iteration ${iteration}/${maxIterations}) 0 / ${repairGaps.length}`,
        });
      }

      repairGaps.sort((a, b) => a.end - a.start - (b.end - b.start));
      const tasks = repairGaps.map((gap, i) =>
        limit(async () => {
          throwIfAborted(signal);
          if (signal?.aborted) return [];

          let adjustedGap = { ...gap };
          if (gap.start < 10) {
            const pad = 15;
            const winStart = Math.max(0, gap.start - pad);
            let winEnd = gap.end + pad;
            if (winEnd - winStart > MAX_CHUNK_DURATION_SEC) {
              winEnd = winStart + MAX_CHUNK_DURATION_SEC;
            }
            adjustedGap = { start: winStart, end: winEnd };
          }
          const gapIndex = i + 1;
          const baseLogIdx = 10000 * iteration + gapIndex;

          const contextSegmentsForThisGap = [
            ...overallSegments,
            ...newlyRepairedSegments,
          ].sort((a, b) => a.start - b.start);

          const newSegs = await transcribeGapAudioWithRetry(
            adjustedGap,
            baseLogIdx,
            `repair_gap_iter_${iteration}`,
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
          const filteredNewSegs = newSegs.filter(
            seg => seg.end > adjustedGap.start && seg.start < adjustedGap.end
          );

          processedInPass += 1;
          if (processedInPass % 3 === 0 || processedInPass === totalGaps) {
            const calcPct = scaleProgress(
              (processedInPass / totalGaps) * 100,
              Stage.TRANSCRIBE,
              Stage.TRANSLATE
            );
            const cappedPct = Math.min(calcPct, 99);
            progressCallback?.({
              percent: cappedPct,
              stage: `Gap repair #${iteration} (${processedInPass}/${totalGaps})`,
              current: processedInPass,
              total: totalGaps,
            });
          }

          if (signal?.aborted) {
            throwIfAborted(signal);
            return filteredNewSegs;
          }
          return filteredNewSegs;
        })
      );

      try {
        const results = await Promise.all(tasks);
        for (const segs of results) {
          if (segs) {
            appendRepaired(overallSegments, segs);
            newlyRepairedSegments.push(...segs);
          }
        }
        // Final update for this wave
        progressCallback?.({
          percent: Math.min(
            scaleProgress(
              (processedInPass / totalGaps) * 100,
              Stage.TRANSCRIBE,
              Stage.TRANSLATE
            ),
            99
          ),
          stage: `Gap repair #${iteration} (${processedInPass}/${totalGaps})`,
          current: processedInPass,
          total: totalGaps,
        });
      } catch (error) {
        log.error(`[${operationId}] Error in gap repair tasks:`, error);
      }

      overallSegments.sort((a, b) => a.start - b.start);

      if (newlyRepairedSegments.length) {
        progressCallback?.({
          percent: scaleProgress(
            90 + (iteration - 1) * 5,
            Stage.TRANSCRIBE,
            Stage.TRANSLATE
          ),
          stage: `Gap-repair pass ${iteration}/${maxIterations}`,
        });
      }

      iteration++;
      repairGaps = dedupeGaps(
        identifyGaps(overallSegments, MIN_REPAIR_GAP_SEC)
      );
      log.info(
        `[${operationId}] After iteration ${iteration - 1}, found ${repairGaps.length} remaining gap(s) for next pass.`
      );
    }

    if (iteration > maxIterations) {
      log.warn(
        `[${operationId}] Reached maximum gap repair iterations (${maxIterations}). ${repairGaps.length} gap(s) may remain unfilled.`
      );
    }

    overallSegments.forEach((segment, index) => {
      segment.index = index + 1;
    });

    if (repairGaps.length > 0) {
      progressCallback?.({
        percent: scaleProgress(100, Stage.TRANSCRIBE, Stage.TRANSLATE),
        stage: 'Gap-repair pass complete',
      });
    }

    const finalSrt = buildSrt({ segments: overallSegments, mode: 'original' });
    await fs.promises.writeFile(
      path.join(tempDir, `${operationId}_final_after_repair.srt`),
      finalSrt,
      'utf8'
    );
    log.info(
      `[${operationId}] ✏️  Wrote debug SRT with ${overallSegments.length} segments`
    );

    if (signal?.aborted) {
      throwIfAborted(signal);
    }

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

  function appendRepaired(overall: SrtSegment[], repaired: SrtSegment[]) {
    let nextIdx = (overall.at(-1)?.index ?? 0) + 1;
    for (const seg of repaired) {
      seg.index = nextIdx++;
      overall.push(seg);
    }
  }
}
