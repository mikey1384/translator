import { FFmpegService } from '../../ffmpeg-service.js';
import { GenerateProgressCallback, SrtSegment } from '@shared-types/app';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import log from 'electron-log';
import { getApiKey } from '../openai-client.js';
import {
  detectSpeechIntervals,
  normalizeSpeechIntervals,
  mergeAdjacentIntervals,
  chunkSpeechInterval,
} from '../audio-chunker.js';
import { transcribeChunk } from '../transcriber.js';
import { buildSrt } from '../../../../shared/helpers/index.js';
import { findCaptionGaps, buildContextPrompt } from '../gap-repair.js';
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
  MISSING_GAP_SEC,
} from '../constants.js';
import { SubtitleProcessingError } from '../errors.js';
import { Stage, scaleProgress } from './progress.js';

export async function transcribePass({
  audioPath,
  services,
  progressCallback,
  operationId,
  signal,
}: {
  audioPath: string;
  services: { ffmpegService: FFmpegService };
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

    if (!services?.ffmpegService) {
      throw new SubtitleProcessingError('FFmpegService is required.');
    }
    const { ffmpegService } = services;

    if (!fs.existsSync(audioPath)) {
      throw new SubtitleProcessingError(`Audio file not found: ${audioPath}`);
    }

    const duration = await ffmpegService.getMediaDuration(audioPath, signal);
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

    // flush tail-end if leftover
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
        const mp3Path = path.join(
          tempDir,
          `chunk_${meta.index}_${operationId}.mp3`
        );
        createdChunkPaths.push(mp3Path);

        try {
          await ffmpegService.extractAudioSegment({
            inputPath: audioPath,
            outputPath: mp3Path,
            startTime: meta.start,
            duration: meta.end - meta.start,
            operationId: operationId ?? '',
            signal,
          });

          if (signal?.aborted) throw new Error('Cancelled');

          const segs = await transcribeChunk({
            chunkIndex: meta.index,
            chunkPath: mp3Path,
            startTime: meta.start,
            signal,
            openai,
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
        stage: `Transcribed & scrubbed ${done}/${chunks.length} chunks`,
        current: done,
        total: chunks.length,
        partialResult: intermediateSrt,
      });

      if (signal?.aborted) throw new Error('Cancelled');
    }

    overallSegments.sort((a, b) => a.start - b.start);

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

    const repairGaps = findCaptionGaps(
      merged,
      overallSegments,
      MISSING_GAP_SEC
    );

    log.info(
      `[${operationId}] Found ${repairGaps.length} big gap(s) in speech. Attempting to fill...`
    );

    if (repairGaps.length === 0) {
      return {
        segments: overallSegments,
        speechIntervals: merged.slice(),
      };
    }

    if (repairGaps.length > 0) {
      progressCallback?.({
        percent: scaleProgress(90, Stage.TRANSCRIBE, Stage.TRANSLATE),
        stage: `Repairing missing captions 0 / ${repairGaps.length}`,
      });
    }
    let lastPct = -1;
    for (let i = 0; i < repairGaps.length; i++) {
      if (signal?.aborted) break; // Respect cancellation

      const gap = repairGaps[i];
      const gapIndex = i + 1;

      const promptCtx = buildContextPrompt(overallSegments, gap);

      const repairPath = path.join(
        tempDir,
        `repair_gap_${gapIndex}_${operationId}.mp3`
      );
      createdChunkPaths.push(repairPath);

      await ffmpegService.extractAudioSegment({
        inputPath: audioPath,
        outputPath: repairPath,
        startTime: gap.start,
        duration: gap.end - gap.start,
        operationId: operationId ?? '',
        signal,
      });

      const newSegs = await transcribeChunk({
        chunkIndex: 10_000 + gapIndex,
        chunkPath: repairPath,
        startTime: gap.start,
        signal,
        openai,
        operationId: operationId ?? '',
        promptContext: promptCtx,
      });

      overallSegments.push(...newSegs);

      const pct = scaleProgress(
        ((i + 1) / repairGaps.length) * 100,
        Stage.TRANSCRIBE,
        Stage.TRANSLATE
      );
      if (Math.round(pct) !== lastPct) {
        progressCallback?.({
          percent: Math.round(pct),
          stage: `Repairing missing captions ${i + 1} / ${repairGaps.length}`,
          current: i + 1,
          total: repairGaps.length,
        });
        lastPct = Math.round(pct);
      }
    }
    if (repairGaps.length > 0) {
      progressCallback?.({
        percent: scaleProgress(100, Stage.TRANSCRIBE, Stage.TRANSLATE),
        stage: 'Gap-repair pass complete',
      });
    }

    overallSegments.sort((a, b) => a.start - b.start);

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
    log.info(`[${operationId}] Finished cleaning up temporary chunk files.`);
  }

  function buildPrompt(history: string) {
    return history.length <= MAX_PROMPT_CHARS
      ? history
      : history.slice(-MAX_PROMPT_CHARS);
  }
}
