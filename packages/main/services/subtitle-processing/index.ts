import path from 'path';
import { FFmpegService } from '../ffmpeg-service.js';
import { buildSrt } from '../../../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import {
  GenerateSubtitlesOptions,
  GenerateProgressCallback,
  SrtSegment,
} from '@shared-types/app';
import log from 'electron-log';
import OpenAI from 'openai';
import { FileManager } from '../file-manager.js';
import pLimit from 'p-limit';
import crypto from 'crypto';
import {
  MAX_PROMPT_CHARS,
  PRE_PAD_SEC,
  POST_PAD_SEC,
  MERGE_GAP_SEC,
  MAX_SPEECHLESS_SEC,
  SUBTITLE_GAP_THRESHOLD,
  MISSING_GAP_SEC,
  REPAIR_PROGRESS_START,
  REPAIR_PROGRESS_END,
  MIN_CHUNK_DURATION_SEC,
  MAX_CHUNK_DURATION_SEC,
  GAP_SEC,
  TRANSCRIPTION_BATCH_SIZE,
  REVIEW_BATCH_SIZE,
  REVIEW_OVERLAP_CTX,
  REVIEW_STEP,
  STAGE_AUDIO_EXTRACTION,
  STAGE_TRANSCRIPTION,
  PROGRESS_ANALYSIS_DONE,
  PROGRESS_TRANSCRIPTION_START,
  PROGRESS_TRANSCRIPTION_END,
} from './constants.js';
import { GenerateSubtitlesFullResult } from './types.js';
import {
  chunkSpeechInterval,
  mergeAdjacentIntervals,
  normalizeSpeechIntervals,
  detectSpeechIntervals,
} from './audio-chunker.js';
import { getApiKey } from './openai-client.js';
import { transcribeChunk } from './transcriber.js';
import { reviewTranslationBatch, translateBatch } from './translator.js';
import {
  extendShortSubtitleGaps,
  fillBlankTranslations,
  fuseOrphans,
} from './post-process.js';
import { buildContextPrompt, findCaptionGaps } from './gap-repair.js';
import { SubtitleProcessingError } from './errors.js';

export async function extractSubtitlesFromVideo({
  options,
  operationId,
  signal,
  progressCallback,
  services,
}: {
  options: GenerateSubtitlesOptions;
  operationId: string;
  signal: AbortSignal;
  progressCallback?: GenerateProgressCallback;
  services: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  };
}): Promise<GenerateSubtitlesFullResult> {
  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!services?.ffmpegService || !services?.fileManager) {
    log.error('[subtitle-processing] Required services were not provided.');
    throw new SubtitleProcessingError(
      'Required services (ffmpegService, fileManager) were not provided.'
    );
  }

  const { ffmpegService, fileManager } = services;
  const targetLang = options.targetLanguage.toLowerCase();
  const isTranslationNeeded = targetLang !== 'original';

  const STAGE_TRANSLATION = isTranslationNeeded
    ? { start: 50, end: 75 }
    : { start: 50, end: 100 };
  const STAGE_REVIEW = isTranslationNeeded
    ? { start: 75, end: 95 }
    : { start: -1, end: -1 };
  const STAGE_FINALIZING = {
    start: isTranslationNeeded ? 95 : STAGE_TRANSLATION.end,
    end: 100,
  };

  function scaleProgress(
    percent: number,
    stage: { start: number; end: number }
  ) {
    const span = stage.end - stage.start;
    return Math.round(stage.start + (percent / 100) * span);
  }

  let audioPath: string | null = null;

  try {
    progressCallback?.({
      percent: STAGE_AUDIO_EXTRACTION.start,
      stage: 'Starting subtitle generation',
    });

    try {
      audioPath = await ffmpegService.extractAudio({
        videoPath: options.videoPath,
        progressCallback: extractionProgress => {
          const stagePercent =
            STAGE_AUDIO_EXTRACTION.start +
            (extractionProgress.percent / 100) *
              (STAGE_AUDIO_EXTRACTION.end - STAGE_AUDIO_EXTRACTION.start);
          progressCallback?.({
            percent: stagePercent,
            stage: extractionProgress.stage || '',
          });
        },
        operationId,
        signal,
      });

      if (signal.aborted) throw new Error('Cancelled');

      const { segments: firstPassSegments, speechIntervals } =
        await generateSubtitlesFromAudio({
          inputAudioPath: audioPath || '',
          progressCallback: p => {
            progressCallback?.({
              percent: scaleProgress(p.percent, STAGE_TRANSCRIPTION),
              stage: p.stage,
              partialResult: p.partialResult,
              current: p?.current,
              total: p.total,
              error: p.error,
            });
          },
          signal,
          operationId,
          services,
        });

      let processedSegments = firstPassSegments;

      if (!isTranslationNeeded) {
        progressCallback?.({
          percent: STAGE_FINALIZING.start,
          stage: 'Transcription complete, preparing final SRT',
          partialResult: buildSrt({
            segments: processedSegments,
            mode: 'dual',
          }),
        });
      } else {
        const segmentsInProcess = fuseOrphans(processedSegments).map(
          (seg, i) => ({ ...seg, index: i + 1 })
        );
        const totalSegments = segmentsInProcess.length;
        const TRANSLATION_BATCH_SIZE = 10;

        const CONCURRENT_TRANSLATIONS = Math.min(
          4,
          Number(process.env.MAX_OPENAI_PARALLEL || 4)
        );
        const limit = pLimit(CONCURRENT_TRANSLATIONS);

        const batchPromises = [];

        let batchesDone = 0;

        for (
          let batchStart = 0;
          batchStart < totalSegments;
          batchStart += TRANSLATION_BATCH_SIZE
        ) {
          const batchEnd = Math.min(
            batchStart + TRANSLATION_BATCH_SIZE,
            totalSegments
          );
          const currentBatchOriginals = segmentsInProcess.slice(
            batchStart,
            batchEnd
          );
          const contextBefore = segmentsInProcess.slice(
            Math.max(0, batchStart - REVIEW_OVERLAP_CTX),
            batchStart
          );
          const contextAfter = segmentsInProcess.slice(
            batchEnd,
            Math.min(batchEnd + REVIEW_OVERLAP_CTX, segmentsInProcess.length)
          );

          const promise = limit(() =>
            translateBatch({
              batch: {
                segments: currentBatchOriginals.map(seg => ({ ...seg })),
                startIndex: batchStart,
                endIndex: batchEnd,
                contextBefore,
                contextAfter,
              },
              targetLang,
              operationId,
              signal,
            }).then(translatedBatch => {
              for (let i = 0; i < translatedBatch.length; i++) {
                segmentsInProcess[batchStart + i] = translatedBatch[i];
              }
            })
          )
            .catch(err => {
              log.error(`[${operationId}] translate batch failed`, err);
            })
            .finally(() => {
              batchesDone++;
              const doneSoFar = Math.min(
                batchesDone * TRANSLATION_BATCH_SIZE,
                totalSegments
              );
              progressCallback?.({
                percent: scaleProgress(
                  (doneSoFar / totalSegments) * 100,
                  STAGE_TRANSLATION
                ),
                stage: `Translating ${doneSoFar}/${totalSegments}`,
                partialResult: buildSrt({
                  segments: segmentsInProcess,
                  mode: 'dual',
                }),
                current: doneSoFar,
                total: totalSegments,
              });
            });

          batchPromises.push(promise);
        }

        await Promise.all(batchPromises);

        for (
          let batchStart = 0;
          batchStart < segmentsInProcess.length;
          batchStart += REVIEW_STEP
        ) {
          const batchEnd = Math.min(
            batchStart + REVIEW_BATCH_SIZE,
            segmentsInProcess.length
          );

          const reviewSlice = segmentsInProcess.slice(batchStart, batchEnd);
          const contextBefore = segmentsInProcess.slice(
            Math.max(0, batchStart - REVIEW_OVERLAP_CTX),
            batchStart
          );
          const contextAfter = segmentsInProcess.slice(
            batchEnd,
            Math.min(batchEnd + REVIEW_OVERLAP_CTX, segmentsInProcess.length)
          );

          const reviewed = await reviewTranslationBatch({
            batch: {
              segments: reviewSlice,
              startIndex: batchStart,
              endIndex: batchEnd,
              targetLang,
              contextBefore,
              contextAfter,
            },
            operationId,
            signal,
          });

          for (let i = 0; i < reviewed.length; i++) {
            const globalIdx = batchStart + i;
            if (
              !segmentsInProcess[globalIdx].reviewedInBatch ||
              segmentsInProcess[globalIdx].reviewedInBatch < batchStart
            ) {
              segmentsInProcess[globalIdx] = {
                ...reviewed[i],
                reviewedInBatch: batchStart,
              };
            }
          }

          const overall = (batchEnd / segmentsInProcess.length) * 100;
          progressCallback?.({
            percent: scaleProgress(overall, STAGE_REVIEW),
            stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(
              segmentsInProcess.length / REVIEW_BATCH_SIZE
            )}`,
            partialResult: buildSrt({
              segments: segmentsInProcess,
              mode: 'dual',
            }),
            current: batchEnd,
            total: segmentsInProcess.length,
            batchStartIndex: batchStart,
          });
        }

        processedSegments = segmentsInProcess;
      }

      progressCallback?.({
        percent: STAGE_FINALIZING.start,
        stage: 'Applying final adjustments',
      });

      const indexedSegments = processedSegments.map((block, idx) => ({
        ...block,
        index: idx + 1,
        start: Number(block.start),
        end: Number(block.end),
      }));

      log.debug(
        `[${operationId}] Segments BEFORE calling extendShortSubtitleGaps (indices 25-27):`,
        JSON.stringify(indexedSegments.slice(25, 28), null, 2)
      );

      extendShortSubtitleGaps({
        segments: indexedSegments,
        threshold: SUBTITLE_GAP_THRESHOLD,
      });

      log.debug(
        `[${operationId}] Segments AFTER IN-PLACE gap fill, BEFORE blank fill (indices 25-27):`,
        JSON.stringify(indexedSegments.slice(25, 28), null, 2)
      );

      const finalSegments = fillBlankTranslations(indexedSegments);

      log.debug(
        `[${operationId}] Segments BEFORE buildSrt (indices 25-27):`,
        JSON.stringify(finalSegments.slice(25, 28), null, 2)
      );

      finalSegments.sort((a, b) => a.start - b.start);
      const anchors: SrtSegment[] = [];
      let tmpIdx = 0;
      for (let i = 1; i < finalSegments.length; i++) {
        const gap = finalSegments[i].start - finalSegments[i - 1].end;
        if (gap > GAP_SEC) {
          anchors.push({
            id: crypto.randomUUID(),
            index: ++tmpIdx,
            start: finalSegments[i - 1].end,
            end: finalSegments[i - 1].end + 0.5,
            original: '',
          });
        }
      }
      finalSegments.push(...anchors);
      finalSegments.sort((a, b) => a.start - b.start);

      const reIndexed = finalSegments.map((seg, i) => ({
        ...seg,
        index: i + 1,
      }));

      const finalSrtContent = buildSrt({
        segments: reIndexed,
        mode: 'dual',
      });

      await fileManager.writeTempFile(finalSrtContent, '.srt');
      log.info(
        `[${operationId}] FINAL SRT CONTENT being returned:\n${finalSrtContent}`
      );

      progressCallback?.({
        percent: 100,
        stage: 'Processing complete!',
        partialResult: finalSrtContent,
        current: finalSegments.length,
        total: finalSegments.length,
      });

      return {
        subtitles: finalSrtContent,
        segments: reIndexed,
        speechIntervals: speechIntervals,
      };
    } catch (error: any) {
      console.error(
        `[${operationId}] Error during subtitle generation:`,
        error
      );

      const isCancel =
        error.name === 'AbortError' ||
        (error instanceof Error && error.message === 'Operation cancelled') ||
        signal.aborted;

      if (isCancel) {
        progressCallback?.({
          percent: 100,
          stage: 'Process cancelled',
        });
        log.info(`[${operationId}] Process cancelled by user.`);
      } else {
        progressCallback?.({
          percent: 100,
          stage: isCancel
            ? 'Process cancelled'
            : `Error: ${error?.message || String(error)}`,
          error: !isCancel ? error?.message || String(error) : undefined,
        });
      }

      throw error;
    }
  } catch (error: any) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);

    const isCancel =
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled') ||
      signal.aborted;

    if (isCancel) {
      progressCallback?.({
        percent: 100,
        stage: 'Process cancelled',
      });
      log.info(`[${operationId}] Process cancelled by user.`);
    } else {
      progressCallback?.({
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: !isCancel ? error?.message || String(error) : undefined,
      });
    }

    throw error;
  } finally {
    if (audioPath) {
      try {
        await fileManager.deleteFile(audioPath);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary audio file ${audioPath}:`,
          cleanupError
        );
      }
    }
  }
}

export async function generateSubtitlesFromAudio({
  inputAudioPath,
  progressCallback,
  signal,
  operationId,
  services,
}: {
  inputAudioPath: string;
  progressCallback?: (info: any) => void;
  signal?: AbortSignal;
  operationId?: string;
  services?: {
    ffmpegService?: {
      getMediaDuration: (p: string, signal?: AbortSignal) => Promise<number>;
      extractAudioSegment: (opts: {
        inputPath: string;
        outputPath: string;
        startTime: number;
        duration: number;
        operationId?: string;
        signal?: AbortSignal;
      }) => Promise<string>;
    };
  };
}): Promise<{
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  srt: string;
}> {
  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const tempDir = path.dirname(inputAudioPath);
  const createdChunkPaths: string[] = [];

  try {
    const openaiApiKey = await getApiKey('openai');
    openai = new OpenAI({ apiKey: openaiApiKey });

    if (!services?.ffmpegService) {
      throw new SubtitleProcessingError('FFmpegService is required.');
    }
    const { ffmpegService } = services;

    if (!fs.existsSync(inputAudioPath)) {
      throw new SubtitleProcessingError(
        `Audio file not found: ${inputAudioPath}`
      );
    }

    const duration = await ffmpegService.getMediaDuration(
      inputAudioPath,
      signal
    );
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
      percent: 0,
      stage: 'Analyzing audio for chunk boundaries...',
    });

    const raw = await detectSpeechIntervals({
      inputPath: inputAudioPath,
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
      percent: PROGRESS_ANALYSIS_DONE,
      stage: `Chunked audio into ${chunks.length} parts`,
    });

    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_START,
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
            inputPath: inputAudioPath,
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
      const p =
        PROGRESS_TRANSCRIPTION_START +
        (done / chunks.length) *
          (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

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
      const finalSrt = buildSrt({ segments: overallSegments, mode: 'dual' });
      return {
        segments: overallSegments,
        speechIntervals: merged.slice(),
        srt: finalSrt,
      };
    }

    if (repairGaps.length > 0) {
      progressCallback?.({
        percent: REPAIR_PROGRESS_START,
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
        inputPath: inputAudioPath,
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

      const pct =
        REPAIR_PROGRESS_START +
        ((i + 1) / repairGaps.length) *
          (REPAIR_PROGRESS_END - REPAIR_PROGRESS_START);
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
        percent: REPAIR_PROGRESS_END,
        stage: 'Gap-repair pass complete',
      });
    }

    overallSegments.sort((a, b) => a.start - b.start);

    const finalSrt = buildSrt({ segments: overallSegments, mode: 'dual' });

    return {
      segments: overallSegments,
      speechIntervals: merged.slice(),
      srt: finalSrt,
    };
  } catch (error: any) {
    console.error(
      `[${operationId}] Error in generateSubtitlesFromAudio:`,
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
