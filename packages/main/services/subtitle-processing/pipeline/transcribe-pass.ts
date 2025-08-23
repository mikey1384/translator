import { FFmpegContext } from '../../ffmpeg-runner.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import log from 'electron-log';
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
  GAP_SEC,
  MERGE_GAP_SEC,
  PROGRESS_ANALYSIS_DONE,
  TRANSCRIPTION_BATCH_SIZE,
  MAX_PROMPT_CHARS,
} from '../constants.js';
import { WHISPER_PARALLEL } from '../../../../shared/constants/runtime-config.js';
import { SubtitleProcessingError } from '../errors.js';
import { Stage, scaleProgress } from './progress.js';
import { extractAudioSegment, mkTempAudioName } from '../audio-extractor.js';
import pLimit from 'p-limit';
import { throwIfAborted } from '../utils.js';
import { refineOvershoots } from '../gap-repair.js';
import { cleanTranscriptBatch } from '../utils.js';

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
  const overallSegments: SrtSegment[] = [];
  const tempDir = path.dirname(audioPath);
  const createdChunkPaths: string[] = [];

  // anti-duplicate helpers are defined below (near repair loop)

  try {
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
      ffmpegPath: ffmpeg.ffmpegPath,
    });
    if (signal?.aborted) throw new Error('Cancelled');

    const cleanedIntervals = normalizeSpeechIntervals({ intervals: raw });
    const merged = mergeAdjacentIntervals(
      cleanedIntervals,
      MERGE_GAP_SEC
    ).flatMap(iv =>
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
    const CONCURRENCY = Math.max(1, WHISPER_PARALLEL);
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

        const chunkAudioPath = mkTempAudioName(
          path.join(tempDir, `chunk_${meta.index}_${operationId}`)
        );
        createdChunkPaths.push(chunkAudioPath);

        try {
          await extractAudioSegment(ffmpeg, {
            input: audioPath,
            output: chunkAudioPath,
            start: meta.start,
            duration: meta.end - meta.start,
            operationId: operationId ?? '',
            signal,
          });

          if (signal?.aborted) throw new Error('Cancelled');

          const segs = await transcribeChunk({
            chunkIndex: meta.index,
            chunkPath: chunkAudioPath,
            startTime: meta.start,
            signal,
            operationId: operationId ?? '',
            promptContext: promptForSlice,
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
        stage: `__i18n__:transcribed_chunks:${done}:${chunks.length}`,
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
    });

    overallSegments.sort((a, b) => a.start - b.start);

    const additionalGaps = sanityScan({
      vadIntervals: merged,
      segments: overallSegments,
      minGap: GAP_SEC,
    });
    log.info(
      `[${operationId}] Sanity scan found ${additionalGaps.length} additional gaps.`
    );

    const repairGapsInput = [
      ...identifyGaps(overallSegments, GAP_SEC),
      ...additionalGaps,
    ];

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
    // --- END anti-duplicate helpers ---

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
          stage: `__i18n__:repairing_captions:${iteration}:${maxIterations}:0:${repairGaps.length}`,
        });
      }

      repairGaps.sort((a, b) => a.end - a.start - (b.end - b.start));
      const tasks = repairGaps.map((gap, i) =>
        limit(async () => {
          throwIfAborted(signal);
          if (signal?.aborted) return [];

          const gapIndex = i + 1;
          const baseLogIdx = 10000 * iteration + gapIndex;

          const contextSegmentsForThisGap = [
            ...overallSegments,
            ...newlyRepairedSegments,
          ].sort((a, b) => a.start - b.start);

          const newSegs = await transcribeGapAudioWithRetry(
            gap,
            baseLogIdx,
            `repair_gap_iter_${iteration}`,
            contextSegmentsForThisGap,
            {
              audioPath,
              tempDir,
              operationId,
              signal,
              ffmpeg,
              createdChunkPaths,
            }
          );
          const filteredNewSegs = newSegs.filter(
            seg => seg.end > gap.start && seg.start < gap.end
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
              stage: `__i18n__:gap_repair:${iteration}:${processedInPass}:${totalGaps}`,
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
        progressCallback?.({
          percent: Math.min(
            scaleProgress(
              (processedInPass / totalGaps) * 100,
              Stage.TRANSCRIBE,
              Stage.TRANSLATE
            ),
            99
          ),
          stage: `Gap repair #${iteration}/${maxIterations}`,
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
      repairGaps = dedupeGaps(identifyGaps(overallSegments, GAP_SEC));
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

    if (signal?.aborted) {
      throwIfAborted(signal);
    }

    // 1) AI scrub (repetition-aware) with progress allocated across TRANSCRIBE→TRANSLATE window
    const totalToScrub = overallSegments.length;
    progressCallback?.({
      percent: scaleProgress(0, Stage.TRANSCRIBE, Stage.TRANSLATE),
      stage: `__i18n__:scrubbing_hallucinations:0:${totalToScrub}`,
    });
    const cleaned = await cleanTranscriptBatch({
      segments: overallSegments,
      operationId,
      signal,
      mediaDuration: duration,
      onProgress: (done, total) => {
        progressCallback?.({
          percent: scaleProgress(
            (done / Math.max(1, total)) * 100,
            Stage.TRANSCRIBE,
            Stage.TRANSLATE
          ),
          stage: `__i18n__:scrubbing_hallucinations:${done}:${total}`,
          current: done,
          total,
        });
      },
    });

    cleaned
      .sort((a, b) => a.start - b.start)
      .forEach((s, i) => (s.index = i + 1));

    const finalSrt = buildSrt({ segments: cleaned, mode: 'original' });
    await fs.promises.writeFile(
      path.join(tempDir, `${operationId}_final_after_repair.srt`),
      finalSrt,
      'utf8'
    );
    log.info(
      `[${operationId}] ✏️  Wrote debug SRT with ${cleaned.length} segments`
    );

    return {
      segments: cleaned,
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

  function appendRepaired(arr: SrtSegment[], repaired: SrtSegment[]) {
    let nextIdx = (arr.at(-1)?.index ?? 0) + 1;
    for (const seg of repaired) {
      seg.index = nextIdx++;
      arr.push(seg);
    }
  }

  function dedupeGaps(gaps: RepairableGap[]) {
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
  }
}
