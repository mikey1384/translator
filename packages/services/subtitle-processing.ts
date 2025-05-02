import path from 'path';
import { FFmpegService } from './ffmpeg-service.js';
import { buildSrt } from '../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import { getApiKey as getSecureApiKey } from './secure-store.js';
import { AI_MODELS } from '../shared/constants/index.js';
import {
  GenerateSubtitlesOptions,
  GenerateProgressCallback,
  SrtSegment,
} from '@shared-types/app';
import log from 'electron-log';
import OpenAI from 'openai';
import { FileManager } from './file-manager.js';
import { spawn } from 'child_process';
import Vad from 'webrtcvad';
import pLimit from 'p-limit';

// --- Configuration Constants ---
const VAD_NORMALIZATION_MIN_GAP_SEC = 0.5;
const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.2;
const PRE_PAD_SEC = 0.1;
const POST_PAD_SEC = 0.15;
const MERGE_GAP_SEC = 0.5;
const MAX_SPEECHLESS_SEC = 15;
const NO_SPEECH_PROB_THRESHOLD = 0.7;
const AVG_LOGPROB_THRESHOLD = -4.5;
const MAX_PROMPT_CHARS = 600;
const SUBTITLE_GAP_THRESHOLD = 5;
const MAX_GAP_TO_FUSE = 0.3;

const MISSING_GAP_SEC = 10;
const REPAIR_PROGRESS_START = 90;
const REPAIR_PROGRESS_END = 100;

const MIN_CHUNK_DURATION_SEC = 8;
const MAX_CHUNK_DURATION_SEC = 15;
const GAP_SEC = 3;

// --- Concurrency Setting ---
const TRANSCRIPTION_BATCH_SIZE = 50;

// --------------------------------------------------------------------------
// ★ NEW – review/polish constants (put just after TRANSCRIPTION_BATCH_SIZE)
const REVIEW_BATCH_SIZE = 50;
const REVIEW_OVERLAP_CTX = 8;
const REVIEW_STEP = REVIEW_BATCH_SIZE - REVIEW_OVERLAP_CTX;

type ReviewBatch = {
  segments: SrtSegment[];
  startIndex: number;
  endIndex: number;
  targetLang: string;
  contextBefore: SrtSegment[];
  contextAfter: SrtSegment[];
};

type TranslateBatchArgs = {
  batch: {
    segments: SrtSegment[];
    startIndex: number;
    endIndex: number;
    contextBefore: SrtSegment[];
    contextAfter: SrtSegment[];
  };
  targetLang: string;
  operationId: string;
  signal?: AbortSignal;
};

// Add after imports or type section
export type GenerateSubtitlesFullResult = {
  subtitles: string;
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  error?: string;
};

async function getApiKey(keyType: 'openai'): Promise<string> {
  const key = await getSecureApiKey(keyType);
  if (key) return key;
  throw new SubtitleProcessingError('OpenAI API key not found.');
}

export class SubtitleProcessingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SubtitleProcessingError';
  }
}

function createFileFromPath(filePath: string) {
  try {
    return fs.createReadStream(filePath);
  } catch (e) {
    throw new SubtitleProcessingError(`File stream error: ${e}`);
  }
}

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

  const STAGE_AUDIO_EXTRACTION = { start: 0, end: 10 };
  const STAGE_TRANSCRIPTION = { start: 10, end: 50 };
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
      });
    } catch (extractionError: any) {
      if (
        extractionError.name === 'AbortError' ||
        (extractionError instanceof Error &&
          extractionError.message === 'Operation cancelled') ||
        signal.aborted
      ) {
        console.info(`[${operationId}] Audio extraction cancelled.`);
      } else {
        console.error(
          `[${operationId}] Error during audio extraction:`,
          extractionError
        );
        throw new Error(
          `Audio extraction failed: ${extractionError.message || extractionError}`
        );
      }
    }

    // Step 1: Get initial subtitle content (string)
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

    // Step 2: Process based on whether translation is needed
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
      // Translation needed - run translation and review logic
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

        // overwrite slice – newest version wins for overlaps
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

      // After loops, segmentsInProcess contains the translated/reviewed segments
      processedSegments = segmentsInProcess;
    }

    // --- Post-Processing Steps (Applied to EITHER original or translated segments) ---

    progressCallback?.({
      percent: STAGE_FINALIZING.start, // Or adjust percentage as needed
      stage: 'Applying final adjustments',
    });

    // Step 3: Indexing (Common step)
    const indexedSegments = processedSegments.map((block, idx) => ({
      ...block,
      index: idx + 1,
      // --- Ensure start/end are numbers EARLY ---
      start: Number(block.start),
      end: Number(block.end),
      // --- End Change ---
    }));

    // --- ADD LOG BEFORE CALL ---
    log.debug(
      `[${operationId}] Segments BEFORE calling extendShortSubtitleGaps (indices 25-27):`,
      JSON.stringify(indexedSegments.slice(25, 28), null, 2)
    );
    // --- END ADD LOG ---

    // Step 4: Apply Gap Filling (IN-PLACE)
    extendShortSubtitleGaps({
      segments: indexedSegments,
      threshold: SUBTITLE_GAP_THRESHOLD,
    });

    // Log the state of indexedSegments *after* the in-place modification
    log.debug(
      `[${operationId}] Segments AFTER IN-PLACE gap fill, BEFORE blank fill (indices 25-27):`,
      JSON.stringify(indexedSegments.slice(25, 28), null, 2)
    );

    // Step 5: Apply Blank Filling (Pass the mutated array)
    const finalSegments = fillBlankTranslations(indexedSegments);

    // Keep our previous log
    log.debug(
      `[${operationId}] Segments BEFORE buildSrt (indices 25-27):`,
      JSON.stringify(finalSegments.slice(25, 28), null, 2)
    );

    // After all segments are collected and sorted:
    finalSegments.sort((a, b) => a.start - b.start);
    // optional "anchor" silence segments
    const anchors: SrtSegment[] = [];
    let tmpIdx = 0;
    for (let i = 1; i < finalSegments.length; i++) {
      const gap = finalSegments[i].start - finalSegments[i - 1].end;
      if (gap > GAP_SEC) {
        anchors.push({
          index: ++tmpIdx,
          start: finalSegments[i - 1].end,
          end: finalSegments[i - 1].end + 0.5,
          original: '',
        });
      }
    }
    finalSegments.push(...anchors);
    finalSegments.sort((a, b) => a.start - b.start);

    /* --- NEW: Fuse orphans before SRT build --- */
    const reIndexed = finalSegments.map((seg, i) => ({ ...seg, index: i + 1 }));

    const finalSrtContent = buildSrt({
      segments: reIndexed,
      mode: 'dual',
    });

    // --- Final Steps ---
    await fileManager.writeTempFile(finalSrtContent, '.srt'); // Write the final version
    log.info(
      `[${operationId}] FINAL SRT CONTENT being returned:\n${finalSrtContent}`
    ); // Log the actual final string

    // --- ADDED: Send final result through progress callback for consistency ---
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
    console.error(`[${operationId}] Error during subtitle generation:`, error);

    // Detect if cancellation caused this error
    const isCancel =
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled') ||
      signal.aborted;

    // If cancellation, set stage = "Process cancelled"
    if (isCancel) {
      progressCallback?.({
        percent: 100,
        stage: 'Process cancelled',
      });
      log.info(`[${operationId}] Process cancelled by user.`);
    } else {
      // Otherwise, it's an actual error
      progressCallback?.({
        percent: 100,
        stage: isCancel
          ? 'Process cancelled'
          : `Error: ${error?.message || String(error)}`,
        error: !isCancel ? error?.message || String(error) : undefined,
      });
    }

    // Rethrow the error so upper layers know we failed/cancelled
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
      getMediaDuration: (p: string) => Promise<number>;
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
  // progress constants
  const PROGRESS_ANALYSIS_DONE = 5;
  const PROGRESS_TRANSCRIPTION_START = 20;
  const PROGRESS_TRANSCRIPTION_END = 95;

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

    const duration = await ffmpegService.getMediaDuration(inputAudioPath);
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

    const raw = await detectSpeechIntervals({ inputPath: inputAudioPath });
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

    // -------------------------------------------------------------------------
    // 3. Parallel transcription, batch by batch
    // -------------------------------------------------------------------------
    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_START,
      stage: `Starting transcription of ${chunks.length} chunks...`,
    });

    // NEW: Rolling context string for each batch
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

      // Build a prompt for THIS batch from the previous batch's transcript
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

          // Pass the batch-level prompt
          const segs = await transcribeChunk({
            chunkIndex: meta.index,
            chunkPath: mp3Path,
            startTime: meta.start,
            signal,
            openai,
            operationId: operationId ?? '',
            promptContext: promptForSlice,
          });

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

      // gather all segments from this batch
      const segArrays = await Promise.all(segArraysPromises);
      const thisBatchSegments = segArrays
        .flat()
        .sort((a, b) => a.start - b.start);

      // Merge them into the global store
      overallSegments.push(...thisBatchSegments);

      const orderedText = thisBatchSegments.map(s => s.original).join(' ');
      batchContext += ' ' + orderedText;
      batchContext = buildPrompt(batchContext);

      // intermediate progress
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

    // optional "anchor" silence segments
    const anchors: SrtSegment[] = [];
    let tmpIdx = 0;
    for (let i = 1; i < overallSegments.length; i++) {
      const gap = overallSegments[i].start - overallSegments[i - 1].end;
      if (gap > GAP_SEC) {
        anchors.push({
          index: ++tmpIdx,
          start: overallSegments[i - 1].end,
          end: overallSegments[i - 1].end + 0.5,
          original: '',
        });
      }
    }
    overallSegments.push(...anchors);
    overallSegments.sort((a, b) => a.start - b.start);

    // REPAIR PASS – find large holes (≥5s) in speech intervals that have no captions
    const repairGaps = findCaptionGaps(
      merged,
      overallSegments,
      MISSING_GAP_SEC
    );

    log.info(
      `[${operationId}] Found ${repairGaps.length} big gap(s) in speech. Attempting to fill...`
    );

    // Early return if no repair gaps
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

      // Build a short context prompt from neighboring captions
      const promptCtx = buildContextPrompt(overallSegments, gap);

      // Create a temp file for this gap
      const repairPath = path.join(
        tempDir,
        `repair_gap_${gapIndex}_${operationId}.mp3`
      );
      createdChunkPaths.push(repairPath); // so it's cleaned up later

      // Extract that audio segment from the big audio
      await ffmpegService.extractAudioSegment({
        inputPath: inputAudioPath,
        outputPath: repairPath,
        startTime: gap.start,
        duration: gap.end - gap.start,
        operationId: operationId ?? '',
        signal,
      });

      // Transcribe the gap using your existing transcribeChunk helper
      const newSegs = await transcribeChunk({
        chunkIndex: 10_000 + gapIndex, // just an arbitrary high index
        chunkPath: repairPath,
        startTime: gap.start,
        signal,
        openai,
        operationId: operationId ?? '',
        promptContext: promptCtx, // we pass the mini context here
      });

      // Add them to the main array
      overallSegments.push(...newSegs);

      // --- Emit progress for this repair ---
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

    // After the loop, re-sort
    overallSegments.sort((a, b) => a.start - b.start);

    // Build final SRT
    const finalSrt = buildSrt({ segments: overallSegments, mode: 'dual' });

    // Return segments, intervals, and SRT
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

async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  promptContext,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  promptContext?: string;
}): Promise<SrtSegment[]> {
  if (signal?.aborted) {
    log.info(
      `[${operationId}] Transcription for chunk ${chunkIndex} cancelled before API call.`
    );
    throw new Error('Cancelled');
  }

  let fileStream: fs.ReadStream;
  try {
    fileStream = createFileFromPath(chunkPath);
  } catch (streamError: any) {
    log.error(
      `[${operationId}] Failed to create read stream for chunk ${chunkIndex} (${chunkPath}):`,
      streamError?.message || streamError
    );
    return [];
  }

  // Helper: is a word inside a valid segment?
  function isWordInValidSegment(
    word: any,
    validSegments: Array<{ start: number; end: number }>,
    startTime: number
  ) {
    // If no valid segments, accept all words (fallback)
    if (!validSegments.length) return true;
    const wStart = word.start + startTime;
    const wEnd = word.end + startTime;
    return validSegments.some(seg => wStart >= seg.start && wEnd <= seg.end);
  }

  try {
    log.debug(
      `[${operationId}] Sending chunk ${chunkIndex} (${(
        fs.statSync(chunkPath).size /
        (1024 * 1024)
      ).toFixed(2)} MB) to Whisper API.`
    );

    // Request word-level and segment-level timestamps
    const res = await openai.audio.transcriptions.create(
      {
        model: AI_MODELS.WHISPER.id,
        file: fileStream,
        response_format: 'verbose_json',
        temperature: 0,
        prompt: promptContext ?? '',
        timestamp_granularities: ['word', 'segment'],
      },
      { signal }
    );

    log.debug(
      `[${operationId}] Received transcription response for chunk ${chunkIndex}.`
    );

    // Parse segments and words arrays
    const segments = (res as any)?.segments as Array<any> | undefined;
    const words = (res as any)?.words as Array<any> | undefined;
    if (!Array.isArray(words) || words.length === 0) {
      log.warn(
        `[${operationId}] Chunk ${chunkIndex}: No word-level timestamps in Whisper response.`
      );
      return [];
    }

    // Filter valid segments by speech probability and logprob
    const validSegments: Array<{ start: number; end: number }> = [];
    if (Array.isArray(segments)) {
      for (const seg of segments) {
        if (
          seg.no_speech_prob < NO_SPEECH_PROB_THRESHOLD &&
          seg.avg_logprob > AVG_LOGPROB_THRESHOLD
        ) {
          validSegments.push({
            start: seg.start + startTime,
            end: seg.end + startTime,
          });
        }
      }
    }

    // Group words into captions: ≤8s, ideally 6–12 words, break at segment boundaries
    const MAX_SEG_LEN = 8; // seconds
    const MAX_WORDS = 12;
    const MIN_WORDS = 3; // NEW – avoid 1- or 2-word orphans
    const srtSegments: SrtSegment[] = [];
    let currentWords: any[] = [];
    let groupStart = null;
    let groupEnd = null;
    let segIdx = 1;

    // Build a set of segment end times for easy lookup
    const segmentEnds = new Set<number>();
    if (Array.isArray(segments)) {
      for (const seg of segments) {
        segmentEnds.add(Number((seg.end + startTime).toFixed(3)));
      }
    }

    for (let i = 0; i < words.length; ++i) {
      const w = words[i];
      if (!isWordInValidSegment(w, validSegments, startTime)) continue;
      const wStart = w.start + startTime;
      const wEnd = w.end + startTime;
      if (currentWords.length === 0) {
        groupStart = wStart;
      }
      currentWords.push(w);
      groupEnd = wEnd;
      const isSegmentEnd = segmentEnds.has(Number(wEnd.toFixed(3)));
      const isLastWord = i === words.length - 1;
      const groupDuration = groupEnd - groupStart;
      const groupWordCount = currentWords.length;
      // decide if we *could* break here
      const hardBoundary = isSegmentEnd || isLastWord;
      const sizeBoundary =
        groupDuration >= MAX_SEG_LEN || groupWordCount >= MAX_WORDS;
      // *** DON'T commit if the fragment would be too short ***
      const shouldBreak = hardBoundary || sizeBoundary;
      if (shouldBreak) {
        if (groupWordCount < MIN_WORDS && !hardBoundary) {
          // keep accumulating – we don't want a tiny tail like "use"
          continue;
        }
        // Join words, attach punctuation to previous word (Unicode-aware)
        let text = '';
        for (let j = 0; j < currentWords.length; ++j) {
          const word = currentWords[j].word;
          const isPunctuation = /^[\p{P}$+<=>^`|~]/u.test(word);
          if (j > 0 && !isPunctuation) {
            text += ' ';
          }
          text += word;
        }
        srtSegments.push({
          index: segIdx++,
          start: groupStart,
          end: groupEnd,
          original: text.trim(),
        });
        // Prepare for next group
        if (!isLastWord) {
          groupStart = null;
          groupEnd = null;
          currentWords = [];
        }
      }
    }

    // Always scrub hallucinations before returning
    const cleanSegs = await scrubHallucinationsBatch({
      segments: srtSegments,
      operationId: operationId ?? '',
      signal,
    });
    return cleanSegs;
  } catch (error: any) {
    if (
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Cancelled') ||
      signal?.aborted
    ) {
      log.info(
        `[${operationId}] Transcription for chunk ${chunkIndex} was cancelled.`
      );
      return [];
    } else {
      log.error(
        `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
        error?.message || error
      );
      return [];
    }
  }
}

async function translateBatch({
  batch,
  targetLang,
  operationId,
  signal,
}: TranslateBatchArgs): Promise<any[]> {
  log.info(
    `[${operationId}] Starting translation batch: ${batch.startIndex}-${batch.endIndex}`
  );

  const MAX_RETRIES = 3;
  let retryCount = 0;
  const batchContextPrompt = batch.segments.map((segment, idx) => {
    const absoluteIndex = batch.startIndex + idx;
    return `Line ${absoluteIndex + 1}: ${segment.original}`;
  });

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles
into natural, fluent ${targetLang}.

Here are the subtitles to translate:
${batchContextPrompt.join('\n')}

Translate EACH line individually, preserving the line order.
- Never skip, omit, or merge lines.
- Always finish translating the given line and do NOT defer to the next line.
- You may leave a line blank only if that entire thought (not just a few repeated words) is already in the previous line.
- Provide exactly one translation for every line, in the same order, 
  prefixed by "Line X:" where X is the line number.
- If you're unsure, err on the side of literal translations.
- For languages with different politeness levels, ALWAYS use polite/formal style for narrations.
`;

  while (retryCount < MAX_RETRIES) {
    try {
      log.info(`[${operationId}] Sending translation batch via callChatModel`);
      const translation = await callAIModel({
        messages: [{ role: 'user', content: combinedPrompt }],
        max_tokens: AI_MODELS.MAX_TOKENS,
        signal,
        operationId,
        retryAttempts: 3,
      });
      log.info(`[${operationId}] Received response for translation batch`);
      log.info(
        `[${operationId}] Received response for translation batch (Attempt ${retryCount + 1})`
      );

      const translationLines = translation
        .split('\n')
        .filter((line: string) => line.trim() !== '');
      const lineRegex = /^Line\s+(\d+):\s*(.*)$/;

      let lastNonEmptyTranslation = '';
      return batch.segments.map((segment, idx) => {
        const absoluteIndex = batch.startIndex + idx;
        let translatedText = segment.translation ?? '';
        const originalSegmentText = segment.original;

        for (const line of translationLines) {
          const match = line.match(lineRegex);
          if (match && parseInt(match[1]) === absoluteIndex + 1) {
            const potentialTranslation = match[2].trim();
            if (potentialTranslation === originalSegmentText) {
              translatedText = lastNonEmptyTranslation;
            } else {
              translatedText = potentialTranslation || lastNonEmptyTranslation;
            }
            lastNonEmptyTranslation = translatedText;
            break;
          }
        }

        return {
          ...segment,
          translation: translatedText,
        };
      });
    } catch (err: any) {
      log.error(
        `[${operationId}] Error during translation batch (Attempt ${retryCount + 1}):`,
        err.name,
        err.message
      );

      if (err.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch detected cancellation signal/error.`
        );
      }

      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET')) &&
        retryCount < MAX_RETRIES - 1
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        log.info(
          `[${operationId}] Retrying translation batch in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      log.error(
        `[${operationId}] Unhandled error or retries exhausted in translateBatch. Falling back.`
      );
      return batch.segments.map(segment => ({
        ...segment,
        translation: segment.original,
      }));
    }
  }

  log.warn(
    `[${operationId}] Translation failed after ${MAX_RETRIES} retries, using original text`
  );

  return batch.segments.map(segment => ({
    ...segment,
    translation: segment.original,
  }));
}

async function reviewTranslationBatch({
  batch,
  operationId,
  signal,
}: {
  batch: ReviewBatch;
  operationId: string;
  signal?: AbortSignal;
}): Promise<any[]> {
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
  );

  const batchItemsWithContext = batch.segments.map((seg, idx) => ({
    index: batch.startIndex + idx + 1,
    original: seg.original.trim(),
    translation: (seg.translation ?? seg.original).trim(),
    isPartOfBatch: true,
  }));

  const originalTexts = batchItemsWithContext
    .map(i => `[${i.index}] ${i.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map(i => `[${i.index}] ${i.translation}`)
    .join('\n');

  const beforeContext = batch.contextBefore
    .map(seg => `[${seg.index}] ${seg.original}`)
    .join('\n');
  const afterContext = batch.contextAfter
    .map(seg => `[${seg.index}] ${seg.original}`)
    .join('\n');

  const prompt = `
You are an **assertive subtitle editor** working into ${batch.targetLang}.  
Your goal: every line must read like it was **originally written** in ${batch.targetLang} by a native speaker.

══════════ Context (may help with pronouns, jokes, carries) ══════════
${beforeContext}

══════════ Parallel batch to review (source ⇄ draft) ══════════
${originalTexts}

══════════ Following context ══════════
${afterContext}

══════════ Draft translations to edit ══════════
${translatedTexts}

******************** HOW TO EDIT ********************
1. **Line-by-line**: keep the *count* and *order* of lines exactly the same.
2. **Be bold**: You may change word choice, syntax, tone, register.
3. **Terminology & style** must stay consistent inside this batch.
4. **Quality bar**: every final line must be fluent at CEFR C1+ level.  
   If the draft already meets that bar, you may leave it unchanged.
5. **You may NOT merge, split, reorder, add, or delete lines.**

******************** OUTPUT ********************
• Output **one line per input line**.
• **Prefix every line** with \`@@SUB_LINE@@ <ABS_INDEX>:\` (even blank ones).
  For example: \`@@SUB_LINE@@ 123: 이것은 번역입니다\`
  (A blank line is: \`@@SUB_LINE@@ 124:  \`)
• No extra commentary, no blank lines except those required by rule 3.

Now provide the reviewed translations for the ${batch.segments.length} lines above:
`;

  try {
    const reviewedContent = await callAIModel({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: AI_MODELS.MAX_TOKENS,
      signal,
      operationId,
      retryAttempts: 3,
    });

    if (!reviewedContent) {
      log.warn(
        '[Review] Review response content was empty or null. Using original translations.'
      );
      return batch.segments;
    }

    const lines = reviewedContent.split('@@SUB_LINE@@').slice(1);

    const map = new Map<number, string>();
    const lineRE = /^\s*(\d+)\s*:\s*([\s\S]*)$/;

    for (const raw of lines) {
      const m = raw.match(lineRE);
      if (!m) continue;
      const id = Number(m[1]);
      const txt = (m[2] ?? '').replace(/[\uFEFF\u200B]/g, '').trim();
      map.set(id, txt);
    }

    // Optional: reject batches that look fishy
    const ids = [...map.keys()];
    const hasDupes = ids.length !== new Set(ids).size;
    if (hasDupes || map.size / batch.segments.length < 0.9) {
      log.warn(
        `[Review] Duplicate or missing IDs in review batch – falling back.`
      );
      return batch.segments;
    }

    const reviewedSegments = batch.segments.map(seg => ({
      ...seg,
      translation: map.has(seg.index)
        ? map.get(seg.index)!
        : (seg.translation ?? seg.original),
    }));

    reviewedSegments.forEach((s, i, arr) => {
      if (!s.translation?.trim() && arr[i].original.trim().length > 0) {
        log.debug(`[SYNC-CHECK] Blank at #${s.index}: "${arr[i].original}"`);
      }
    });

    return reviewedSegments;
  } catch (error: any) {
    log.error(
      `[Review] Error during initial review batch (${operationId}):`, // Updated log message slightly
      error.name,
      error.message
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(`[Review] Review batch (${operationId}) cancelled. Rethrowing.`);
      throw error;
    }
    log.error(
      `[Review] Unhandled error in reviewTranslationBatch (${operationId}). Falling back to original batch segments.`
    );
    return batch.segments;
  }
}

function extendShortSubtitleGaps({
  segments,
  threshold = SUBTITLE_GAP_THRESHOLD,
}: {
  segments: SrtSegment[];
  threshold?: number;
}): SrtSegment[] {
  if (!segments || segments.length < 2) return segments;

  for (let i = 0; i < segments.length - 1; i++) {
    const currentEnd = Number(segments[i].end);
    const nextStart = Number(segments[i + 1].start);
    const gap = nextStart - currentEnd;

    if (gap > 0 && gap < threshold) {
      segments[i].end = nextStart;
    }
  }
  return segments;
}

function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  return segments; // blanks stay blank, no carry-over
}

export async function callOpenAIChat({
  model,
  messages,
  max_tokens,
  signal,
  retryAttempts = 3,
}: {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  max_tokens?: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  let openai: OpenAI;
  try {
    const openaiApiKey = await getApiKey('openai');
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not found');
    }
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    const message =
      keyError instanceof Error ? keyError.message : String(keyError);
    throw new Error(`OpenAI initialization failed: ${message}`);
  }

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;
    try {
      const response = await openai.chat.completions.create(
        {
          model: model,
          messages: messages,
          max_tokens: max_tokens,
          temperature: 0.1,
        },
        { signal }
      );
      const content = response.choices[0]?.message?.content ?? '';
      if (content) {
        return content;
      } else {
        throw new Error('Unexpected response format from OpenAI Chat API.');
      }
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        throw new Error('Operation cancelled');
      }

      if (
        (error instanceof OpenAI.APIError &&
          (error.status === 429 ||
            error.status === 500 ||
            error.status === 503)) ||
        (error.message &&
          error.message.includes('timeout') &&
          currentAttempt < retryAttempts)
      ) {
        const delay = 1000 * Math.pow(2, currentAttempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw new Error(
        `OpenAI Chat API call failed: ${error.message || String(error)}`
      );
    }
  }

  throw new Error(
    `OpenAI Chat API call failed after ${retryAttempts} attempts.`
  );
}

export async function callAIModel({
  messages,
  max_tokens,
  signal,
  operationId,
  retryAttempts = 3,
}: {
  messages: any[];
  max_tokens?: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  return callOpenAIChat({
    model: AI_MODELS.GPT,
    messages,
    max_tokens: max_tokens ?? 1000,
    signal,
    operationId,
    retryAttempts,
  });
}

export async function detectSpeechIntervals({
  inputPath,
  vadMode = 2,
  frameMs = 30,
  operationId = '',
}: {
  inputPath: string;
  vadMode?: 0 | 1 | 2 | 3;
  frameMs?: 10 | 20 | 30;
  operationId?: string;
}): Promise<Array<{ start: number; end: number }>> {
  return new Promise((resolve, reject) => {
    log.info(`[${operationId}] Starting streamed VAD for: ${inputPath}`);
    const sampleRate = 16_000;
    const bytesPerSample = 2; // 16-bit
    const frameSizeSamples = (sampleRate * frameMs) / 1000;
    const bytesPerFrame = frameSizeSamples * bytesPerSample; // 16‑bit mono

    const vad = new Vad(sampleRate, vadMode);
    const intervals: Array<{ start: number; end: number }> = [];
    let speechOpen = false;
    let segStart = 0;
    let currentFrameIndex = 0;
    let leftoverBuffer = Buffer.alloc(0);

    const ffmpeg = spawn('ffmpeg', [
      '-i',
      inputPath,
      '-f',
      's16le', // Signed 16-bit Little Endian PCM
      '-ac',
      '1', // Mono
      '-ar',
      String(sampleRate), // Target sample rate
      '-loglevel',
      'error', // Reduce ffmpeg noise
      '-', // Output to stdout
    ]);

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      // Combine leftover data from previous chunk with the new chunk
      const currentBuffer = Buffer.concat([leftoverBuffer, chunk]);
      let offset = 0;

      // Process as many full frames as possible from the current buffer
      while (offset + bytesPerFrame <= currentBuffer.length) {
        const frame = currentBuffer.subarray(offset, offset + bytesPerFrame);
        const t = currentFrameIndex * (frameMs / 1000);

        try {
          const isSpeech = vad.process(frame);

          if (isSpeech && !speechOpen) {
            segStart = t;
            speechOpen = true;
          }
          if (!isSpeech && speechOpen) {
            intervals.push({ start: segStart, end: t });
            speechOpen = false;
          }
        } catch (vadError) {
          log.error(
            `[${operationId}] VAD process error on frame ${currentFrameIndex}`,
            vadError
          );
          // Decide if you want to stop or continue
        }

        offset += bytesPerFrame;
        currentFrameIndex++;
      }

      // Keep any remaining incomplete frame data for the next chunk
      leftoverBuffer = currentBuffer.subarray(offset);
    });

    ffmpeg.stderr.on('data', (data: Buffer) => {
      log.error(`[${operationId}] ffmpeg stderr: ${data.toString()}`);
    });

    ffmpeg.on('close', code => {
      log.info(`[${operationId}] ffmpeg process exited with code ${code}`);
      if (speechOpen) {
        // Flush the last segment if speech was open at the end
        const endTime = currentFrameIndex * (frameMs / 1000);
        intervals.push({ start: segStart, end: endTime });
        speechOpen = false; // Reset state
      }
      if (code !== 0 && code !== null) {
        // Allow null code for graceful exit/cancel
        // Check if the intervals array is empty, might indicate early failure
        if (intervals.length === 0 && leftoverBuffer.length === 0) {
          log.error(
            `[${operationId}] FFmpeg exited abnormally (code ${code}) before processing any frames. Check input file/FFmpeg installation.`
          );
          return reject(
            new Error(
              `FFmpeg process failed with code ${code}. No VAD intervals generated.`
            )
          );
        } else {
          log.warn(
            `[${operationId}] FFmpeg process exited with code ${code}, but some intervals may have been processed.`
          );
          // Continue with potentially partial results
        }
      }
      log.info(
        `[${operationId}] Finished streamed VAD. Found ${intervals.length} raw intervals.`
      );
      resolve(intervals);
    });

    ffmpeg.on('error', err => {
      log.error(`[${operationId}] Failed to start ffmpeg process:`, err);
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}

export function normalizeSpeechIntervals({
  intervals,
  minGapSec = VAD_NORMALIZATION_MIN_GAP_SEC, // Use constant as default
  minDurSec = VAD_NORMALIZATION_MIN_DURATION_SEC, // Uses new default of 0
}: {
  intervals: Array<{ start: number; end: number }>;
  minGapSec?: number;
  minDurSec?: number;
}) {
  if (!intervals || intervals.length === 0) return []; // Handle empty input

  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  if (intervals[0]) {
    merged.push({ ...intervals[0] });
  }

  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i];
    const last = merged.at(-1);

    if (last && cur.start - last.end < minGapSec) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged.filter(i => i.end - i.start >= minDurSec);
}

function chunkSpeechInterval({
  interval,
  duration,
}: {
  interval: { start: number; end: number };
  duration: number;
}): Array<{ start: number; end: number }> {
  if (interval.end - interval.start <= duration) {
    return [interval];
  }

  const mid = (interval.start + interval.end) / 2;
  return [
    ...chunkSpeechInterval({
      interval: { start: interval.start, end: mid },
      duration,
    }),
    ...chunkSpeechInterval({
      interval: { start: mid, end: interval.end },
      duration,
    }),
  ];
}

function mergeAdjacentIntervals(
  intervals: Array<{ start: number; end: number }>,
  maxGapSec: number
): Array<{ start: number; end: number }> {
  if (!intervals || intervals.length === 0) {
    return [];
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  merged.push({ ...intervals[0] });

  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];

    if (current.start - last.end < maxGapSec) {
      // Merge if gap is small enough
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function fuseOrphans(segments: SrtSegment[]): SrtSegment[] {
  const MIN_WORDS = 4; // fewer than this = “orphan”

  if (!segments.length) return [];

  const fused: SrtSegment[] = [];

  for (const seg of segments) {
    const wordCount = seg.original.trim().split(/\s+/).length;

    if (wordCount < MIN_WORDS && fused.length) {
      const prev = fused[fused.length - 1];
      const gap = seg.start - prev.end;

      if (gap < MAX_GAP_TO_FUSE) {
        // → just a hiccup in the waveform: stretch timing & append text
        prev.end = seg.end;
        prev.original = `${prev.original} ${seg.original}`.trim();
        continue; // don’t push a new caption
      }
    }

    // normal case – keep caption as is
    fused.push({ ...seg });
  }

  // re-index before returning
  return fused.map((s, i) => ({ ...s, index: i + 1 }));
}

async function scrubHallucinationsBatch({
  segments,
  operationId,
  signal,
}: {
  segments: SrtSegment[];
  operationId: string;
  signal?: AbortSignal;
}): Promise<SrtSegment[]> {
  const videoLen = segments.at(-1)?.end ?? 0;
  const SYSTEM_HEADER = `
VIDEO_LENGTH_SEC = ${Math.round(videoLen)}
An outro is only valid if caption.start_sec > 0.9 * VIDEO_LENGTH_SEC.
`;
  /* ───────────────────────── 1. PROMPT ───────────────────────── */
  const systemPrompt = String.raw`
You are a subtitle noise-filter.

${SYSTEM_HEADER}

TASK
────
For every caption decide whether to
  • clean  – remove emoji / ★★★★ / ░░░ / premature "please subscribe", "see you in the next video" etc.
  • delete – if it is only noise (no real words).

OUTPUT  (exactly one line per input, same order)
  @@LINE@@ <index>: <clean text>
If the caption should be deleted output nothing after the colon.

1. Use common sense - if the caption says something like "please subscribe" or "see you in the next video" etc when video is still far from the end, it's probably a hallucination and should be deleted.
2. If the caption is spammy, it's probably a hallucination and should be deleted.
3. Why would a subtitle have any emojis or other non-text characters?

EXAMPLES
────────
input  → 17: ★★★★★★★★★★
output → @@LINE@@ 17:

input  → 18: Thanks for watching!!! 👍👍👍
output → @@LINE@@ 18: Thanks for watching!
`;

  const userPayload = segments
    .map(s => `${s.index} @ ${s.start.toFixed(1)}: ${s.original.trim()}`)
    .join('\n');

  const raw = await callAIModel({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPayload },
    ],
    max_tokens: 4096,
    operationId,
    signal,
  });

  /* ──────────────────── 2. PARSE MODEL RESPONSE ─────────────────── */
  const lineRE = /^@@LINE@@\s+(\d+)\s*:\s*(.*)$/;
  const modelMap = new Map<number, string>(); // index → cleaned-or-blank
  raw.split('\n').forEach(row => {
    const m = row.match(lineRE);
    if (m) modelMap.set(Number(m[1]), (m[2] ?? '').trim());
  });

  /* ───────────────────── 3. LOCAL NOISE STRIPPER ─────────────────── */
  const stripNoise = (txt: string): string =>
    txt
      // collapse ★★★ / !!! / --- / ░░░ …
      .replace(/([\p{P}\p{S}])\1{2,}/gu, '$1')
      // drop single emoji / dingbats
      .replace(/\p{Extended_Pictographic}/gu, '')
      // tidy whitespace
      .replace(/\s{2,}/g, ' ')
      .trim();

  /* ─────────────────── 4. BUILD CLEAN ARRAY & LOG ────────────────── */
  const cleanedSegments: SrtSegment[] = [];

  segments.forEach(seg => {
    let out = modelMap.has(seg.index) ? modelMap.get(seg.index)! : seg.original;
    out = stripNoise(out);

    if (out !== '') {
      cleanedSegments.push({ ...seg, original: out });
    }
    // else: deleted → don't push
  });

  return cleanedSegments;
}

/**
 * Find sub-intervals within `speech` that have no existing caption coverage
 * for a minimum duration (5 seconds by default).
 */
function findCaptionGaps(
  speech: Array<{ start: number; end: number }>,
  captions: SrtSegment[],
  minGapSec = 5
) {
  // Convert captions into "covered" intervals
  const covered = captions.map(c => ({ start: c.start, end: c.end }));

  const gaps: Array<{ start: number; end: number }> = [];

  for (const iv of speech) {
    let cursor = iv.start;

    // For each caption that overlaps with this speech interval:
    //   if there's a chunk of speech from 'cursor' to caption.start ≥ minGapSec
    //   that's a missing gap -> push it
    for (const c of covered.filter(c => c.end > iv.start && c.start < iv.end)) {
      if (c.start - cursor >= minGapSec) {
        gaps.push({ start: cursor, end: c.start });
      }
      cursor = Math.max(cursor, c.end);
    }

    // Tail end leftover
    if (iv.end - cursor >= minGapSec) {
      gaps.push({ start: cursor, end: iv.end });
    }
  }

  return gaps;
}

/**
 * Build a short "before ... after" prompt for Whisper, to give context about
 * the missing gap. We take up to 3 lines before + 3 lines after, each truncated
 * to ~40 words to avoid huge prompts.
 */
function buildContextPrompt(
  allSegments: SrtSegment[],
  gap: { start: number; end: number },
  wordsPerSide = 40
) {
  // lines that end before gap
  const beforeText = allSegments
    .filter(s => s.end <= gap.start)
    .slice(-3) // last 3 lines
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(-wordsPerSide)
    .join(' ');

  // lines that start after gap
  const afterText = allSegments
    .filter(s => s.start >= gap.end)
    .slice(0, 3) // next 3 lines
    .map(s => s.original)
    .join(' ')
    .split(/\s+/)
    .slice(0, wordsPerSide)
    .join(' ');

  return `Context before:\n${beforeText}\n\n(You are continuing the same speaker)\n\nContext after:\n${afterText}\n\nTranscript:`;
}
