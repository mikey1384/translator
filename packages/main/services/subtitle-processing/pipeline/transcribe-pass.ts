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
  SAVE_WHISPER_CHUNKS,
  PRE_PAD_SEC,
  POST_PAD_SEC,
  MAX_SPEECHLESS_SEC,
  MAX_CHUNK_DURATION_SEC,
  MIN_CHUNK_DURATION_SEC,
  MERGE_GAP_SEC,
  MAX_PROMPT_CHARS,
} from '../constants.js';
import { SubtitleProcessingError } from '../errors.js';
import { Stage } from './progress.js';
import { extractAudioSegment, mkTempAudioName } from '../audio-extractor.js';
import { throwIfAborted } from '../utils.js';

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
      percent: Stage.TRANSCRIBE,
      stage: `Chunked audio into ${chunks.length} parts`,
    });

    // Keep progress continuous: transcription spans 10%..70%
    progressCallback?.({
      percent: Stage.TRANSCRIBE,
      stage: `Starting transcription of ${chunks.length} chunks...`,
    });

    // Maintain a rolling, char-capped textual context for prompts
    let batchContext = '';

    // Process chunks sequentially for maximum contextual correctness
    let done = 0;
    for (const meta of chunks) {
      throwIfAborted(signal);

      if (meta.end <= meta.start) {
        log.warn(
          `[${operationId}] Skipping chunk ${meta.index} due to zero/negative duration: ${meta.start.toFixed(
            2
          )}-${meta.end.toFixed(2)}`
        );
        done++;
        continue;
      }

      const promptForChunk = buildPrompt(batchContext);

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
          promptContext: promptForChunk,
        });

        if (signal?.aborted) throw new Error('Cancelled');

        const ordered = (segs || []).slice().sort((a, b) => a.start - b.start);
        overallSegments.push(...ordered);

        // Update rolling context with the new text, capped by MAX_PROMPT_CHARS
        const orderedText = ordered.map(s => s.original).join(' ');
        batchContext = buildPrompt((batchContext + ' ' + orderedText).trim());
      } catch (chunkError: any) {
        // If credits ran out, abort the entire transcription flow.
        if (
          chunkError?.message === 'insufficient-credits' ||
          /Insufficient credits/i.test(
            String(chunkError?.message || chunkError)
          )
        ) {
          throw chunkError;
        }
        if (chunkError?.message === 'Cancelled') {
          log.info(
            `[${operationId}] Chunk ${meta.index} processing cancelled.`
          );
          // Respect cancellation by propagating after progress update below
        } else {
          log.error(
            `[${operationId}] Error processing chunk ${meta.index}:`,
            chunkError?.message || chunkError
          );
          progressCallback?.({
            percent: -1,
            stage: `Error in chunk ${meta.index}`,
            error: chunkError?.message || String(chunkError),
          });
        }
      }

      done++;
      // Map local transcription progress (0..100) to global 10..95 range
      const p = 10 + Math.round((done / chunks.length) * 85);

      const partialSegs = overallSegments
        .slice()
        .sort((a, b) => a.start - b.start)
        .filter(
          s =>
            (s.original ?? '').trim() !== '' &&
            !isLikelyHallucination({
              s,
              merged,
            })
        );
      const intermediateSrt = buildSrt({
        segments: partialSegs,
        mode: 'dual',
      });

      log.debug(
        `[Transcription Loop] Built intermediateSrt (first 100 chars): "${intermediateSrt.substring(
          0,
          100
        )}", Percent: ${Math.round(p)}`
      );
      progressCallback?.({
        percent: Math.min(p, 95),
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

    // Drop empty segments first
    let filteredSegments = overallSegments.filter(
      s => s.original.trim() !== ''
    );
    filteredSegments = filteredSegments.filter(
      s =>
        !isLikelyHallucination({
          s,
          merged,
        })
    );
    overallSegments.length = 0;
    overallSegments.push(...filteredSegments);

    overallSegments.sort((a, b) => a.start - b.start);

    // Legacy gap-repair phase removed: finalize after transcription/overshoot refinement
    {
      if (signal?.aborted) {
        throwIfAborted(signal);
      }

      const cleaned = overallSegments
        .filter(s => (s.original ?? '').trim() !== '')
        .sort((a, b) => a.start - b.start)
        .map((s, i) => ({
          ...s,
          index: i + 1,
          original: (s.original ?? '').replace(/\s{2,}/g, ' ').trim(),
        }));

      const finalSrt = buildSrt({ segments: cleaned, mode: 'original' });
      await fs.promises.writeFile(
        path.join(tempDir, `${operationId}_final.srt`),
        finalSrt,
        'utf8'
      );
      log.info(
        `[${operationId}] ✏️  Wrote debug SRT with ${cleaned.length} segments`
      );
      progressCallback?.({ percent: 100, stage: 'Completed' });
      return { segments: cleaned, speechIntervals: merged.slice() };
    }
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
          fsp.unlink(p).catch((err: any) => {
            if (err?.code === 'ENOENT') {
              log.debug(`[${operationId}] Temp chunk already removed: ${p}`);
            } else {
              log.warn(
                `[${operationId}] Failed to delete temp chunk file ${p}:`,
                err?.message || err
              );
            }
          })
        )
      );
    }
    log.info(`[${operationId}] Finished cleaning up temporary chunk files.`);
  }

  function isLikelyHallucination({
    s,
    merged,
  }: {
    s: SrtSegment;
    merged: Array<{ start: number; end: number }>;
  }): boolean {
    const text = (s.original || '').trim();
    if (!text) return true;

    const noSpeech =
      typeof s.no_speech_prob === 'number' ? s.no_speech_prob : -1;
    const avgLog = typeof s.avg_logprob === 'number' ? s.avg_logprob : 0;
    const overlap = intervalOverlap(s, merged);

    if (noSpeech >= 0.92 && overlap < 0.15 && avgLog <= -1.3) return true;

    return false;
  }

  function intervalOverlap(
    s: { start: number; end: number },
    intervals: Array<{ start: number; end: number }>
  ): number {
    const dur = Math.max(0, s.end - s.start);
    if (dur <= 0) return 0;
    let ov = 0;
    for (const iv of intervals) {
      const a = Math.max(s.start, iv.start);
      const b = Math.min(s.end, iv.end);
      if (b > a) ov += b - a;
      if (iv.start > s.end) break;
    }
    return ov / dur;
  }

  function buildPrompt(history: string) {
    // Normalize whitespace but keep non-Latin scripts intact; cap by characters
    const normalized = (history || '').replace(/\s{2,}/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= MAX_PROMPT_CHARS) return normalized;
    return normalized.slice(-MAX_PROMPT_CHARS);
  }
}
