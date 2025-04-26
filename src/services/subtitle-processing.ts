import path from 'path';
import { FFmpegService } from './ffmpeg-service.js';
import { parseSrt, buildSrt } from '../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import { getApiKey as getSecureApiKey } from './secure-store.js';
import { AI_MODELS } from '../shared/constants/index.js';
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  SrtSegment,
} from '../types/interface.js';
import log from 'electron-log';
import OpenAI from 'openai';
import { FileManager } from './file-manager.js';
import { spawn } from 'child_process';
import * as webrtcvadPackage from 'webrtcvad';

const Vad = webrtcvadPackage.default.default;

// --- Configuration Constants ---
const VAD_NORMALIZATION_MIN_GAP_SEC = 0.2; // merge intervals closer than this
const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.25; // 0 ⇒ keep even 1‑frame blips
const PRE_PAD_SEC = 0.15;
const POST_PAD_SEC = 0;
const MERGE_GAP_SEC = 0.3;
const MAX_SPEECHLESS_SEC = 8;

const MIN_CHUNK_DURATION_SEC = 1;
const SUBTITLE_GAP_THRESHOLD = 3;
const GAP_SEC = 3;

// --- Concurrency Setting ---
const TRANSCRIPTION_BATCH_SIZE = 50;

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
}): Promise<GenerateSubtitlesResult> {
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
    const rawSubtitlesContent = await generateSubtitlesFromAudio({
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

    let processedSegments: SrtSegment[]; // Variable to hold segments after initial processing

    // Step 2: Process based on whether translation is needed
    if (!isTranslationNeeded) {
      // Just parse the raw content if no translation
      processedSegments = parseSrt(rawSubtitlesContent);
      progressCallback?.({
        percent: STAGE_FINALIZING.start, // Move completion % later
        stage: 'Transcription complete, preparing final SRT',
        partialResult: rawSubtitlesContent, // Show the raw SRT here
      });
    } else {
      // Translation needed - run translation and review logic
      const segmentsInProcess = parseSrt(rawSubtitlesContent); // Start with parsed segments
      const totalSegments = segmentsInProcess.length;
      const TRANSLATION_BATCH_SIZE = 10;

      // --- Translation Loop ---
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
        const translatedBatch = await translateBatch({
          batch: {
            segments: currentBatchOriginals.map(seg => ({ ...seg })),
            startIndex: batchStart,
            endIndex: batchEnd,
          },
          targetLang,
          operationId,
          signal,
        });
        for (let i = 0; i < translatedBatch.length; i++) {
          segmentsInProcess[batchStart + i] = translatedBatch[i];
        }
        const overallProgress = (batchEnd / totalSegments) * 100;
        progressCallback?.({
          percent: scaleProgress(overallProgress, STAGE_TRANSLATION),
          stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(
            totalSegments / TRANSLATION_BATCH_SIZE
          )}`,
          partialResult: buildSrt(segmentsInProcess),
          current: batchEnd,
          total: totalSegments,
        });
      }

      // --- Review Loop ---
      const REVIEW_BATCH_SIZE = 50;
      for (
        let batchStart = 0;
        batchStart < segmentsInProcess.length;
        batchStart += REVIEW_BATCH_SIZE
      ) {
        const batchEnd = Math.min(
          batchStart + REVIEW_BATCH_SIZE,
          segmentsInProcess.length
        );
        const currentBatchTranslated = segmentsInProcess.slice(
          batchStart,
          batchEnd
        );
        const reviewedBatch = await reviewTranslationBatch({
          batch: {
            segments: currentBatchTranslated.map(seg => ({ ...seg })),
            startIndex: batchStart,
            endIndex: batchEnd,
            targetLang,
          },
          operationId,
          signal,
        });
        for (let i = 0; i < reviewedBatch.length; i++) {
          segmentsInProcess[batchStart + i] = reviewedBatch[i];
        }
        const overallProgress = (batchEnd / segmentsInProcess.length) * 100;
        progressCallback?.({
          percent: scaleProgress(overallProgress, STAGE_REVIEW),
          stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(
            segmentsInProcess.length / REVIEW_BATCH_SIZE
          )}`,
          // Show cumulative reviewed SRT here if desired
          partialResult: buildSrt(segmentsInProcess),
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
    extendShortSubtitleGaps(indexedSegments, SUBTITLE_GAP_THRESHOLD);

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

    // Step 6: Build Final SRT
    const finalSrtContent = buildSrt(finalSegments);

    // --- Final Steps ---
    await fileManager.writeTempFile(finalSrtContent, '.srt'); // Write the final version
    log.info(
      `[${operationId}] FINAL SRT CONTENT being returned:\n${finalSrtContent}`
    ); // Log the actual final string

    // --- ADDED: Send final result through progress callback for consistency ---
    progressCallback?.({
      percent: 100,
      stage: 'Processing complete!',
      partialResult: finalSrtContent, // Send the final SRT string
      current: finalSegments.length, // Use length of the final segments array
      total: finalSegments.length,
    });
    // --- END ADDED ---

    return { subtitles: finalSrtContent };
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
}): Promise<string> {
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

    // detect + normalize + merge
    const raw = await detectSpeechIntervals({ inputPath: inputAudioPath });
    const cleaned = normalizeSpeechIntervals({ intervals: raw });
    const merged = mergeAdjacentIntervals(cleaned, MERGE_GAP_SEC).flatMap(iv =>
      iv.end - iv.start > MAX_SPEECHLESS_SEC
        ? chunkSpeechInterval({ interval: iv, duration: MAX_SPEECHLESS_SEC })
        : [iv]
    );

    // build minimum-length chunks, applying pre-/post-padding
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
          `[${operationId}] Skipping zero/negative duration VAD block after padding: ${s.toFixed(2)}-${e.toFixed(2)}`
        );
        continue;
      }

      if (chunkStart === null) {
        chunkStart = s;
      }
      currEnd = e;

      // If chunk reaches min length, push it
      if (currEnd - chunkStart >= MIN_CHUNK_DURATION_SEC) {
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
          `[${operationId}] Skipping final chunk due to zero/negative duration: ${chunkStart.toFixed(2)}-${currEnd.toFixed(2)}`
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
    // 3. Parallel transcription
    // -------------------------------------------------------------------------
    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_START,
      stage: `Starting transcription of ${chunks.length} chunks...`,
    });

    let done = 0;

    for (let b = 0; b < chunks.length; b += TRANSCRIPTION_BATCH_SIZE) {
      const slice = chunks.slice(b, b + TRANSCRIPTION_BATCH_SIZE);

      log.info(
        `[${operationId}] Processing transcription batch ${Math.ceil((b + slice.length) / TRANSCRIPTION_BATCH_SIZE)}/` +
          `${Math.ceil(chunks.length / TRANSCRIPTION_BATCH_SIZE)} (Chunks ${b + 1}-${b + slice.length})`
      );

      const segArraysPromises = slice.map(async meta => {
        if (signal?.aborted) throw new Error('Cancelled');

        if (meta.end <= meta.start) {
          log.warn(
            `[${operationId}] Skipping chunk ${meta.index} due to zero/negative duration: ${meta.start.toFixed(2)}-${meta.end.toFixed(2)}`
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
            operationId,
            signal,
          });

          if (signal?.aborted) throw new Error('Cancelled');

          // Now transcribe that chunk (implementation not shown here)
          const segs = await transcribeChunk({
            chunkIndex: meta.index,
            chunkPath: mp3Path,
            startTime: meta.start,
            signal,
            openai,
            operationId: operationId as string,
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
      segArrays.flat().forEach(s => overallSegments.push(s));

      // intermediate progress
      done += slice.length;
      const p =
        PROGRESS_TRANSCRIPTION_START +
        (done / chunks.length) *
          (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

      // build partial SRT
      const intermediateSrt = buildSrt(
        overallSegments.slice().sort((a, b) => a.start - b.start)
      );
      log.debug(
        `[Transcription Loop] Built intermediateSrt (first 100 chars): ` +
          `"${intermediateSrt.substring(0, 100)}", Percent: ${Math.round(p)}`
      );
      progressCallback?.({
        percent: Math.round(p),
        stage: `Transcribed ${done}/${chunks.length} chunks`,
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
          index: ++tmpIdx,
          start: overallSegments[i - 1].end,
          end: overallSegments[i - 1].end + 0.5, // half-second blank
          text: '', // or '♪' if you'd like a visible note
        });
      }
    }
    overallSegments.push(...anchors);
    overallSegments.sort((a, b) => a.start - b.start);

    log.info(
      `[${operationId}] Transcription complete. Generated ${overallSegments.length} final segments.`
    );
    progressCallback?.({ percent: 100, stage: 'Transcription complete!' });

    // re-index
    const reIndexed = overallSegments.map((seg, i) => ({
      ...seg,
      index: i + 1,
    }));
    return buildSrt(reIndexed);
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
    // -------------------------------------------------------------------------
    // 10. Clean-up section
    // -------------------------------------------------------------------------
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
}

async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
}): Promise<SrtSegment[]> {
  // Check for cancellation signal before proceeding
  if (signal?.aborted) {
    log.info(
      `[${operationId}] Transcription for chunk ${chunkIndex} cancelled before API call.`
    );
    throw new Error('Cancelled'); // Use 'Cancelled' to match other checks
  }

  let fileStream: fs.ReadStream;
  try {
    fileStream = createFileFromPath(chunkPath);
  } catch (streamError: any) {
    log.error(
      `[${operationId}] Failed to create read stream for chunk ${chunkIndex} (${chunkPath}):`,
      streamError?.message || streamError
    );
    return []; // Cannot proceed without stream
  }

  try {
    log.debug(
      `[${operationId}] Sending chunk ${chunkIndex} (${(fs.statSync(chunkPath).size / (1024 * 1024)).toFixed(2)} MB) to Whisper API.`
    );

    const res = await openai.audio.transcriptions.create(
      {
        model: AI_MODELS.WHISPER.id,
        file: fileStream,
        response_format: 'verbose_json',
        temperature: 0,
        prompt: '',
      },
      { signal } // Pass signal for cancellation during API call
    );

    log.debug(
      `[${operationId}] Received transcription response for chunk ${chunkIndex}.`
    );

    // Define simpler type for expected segment structure
    type WhisperSegment = {
      start: number;
      end: number;
      text: string;
      avg_logprob: number;
      no_speech_prob: number;
    };

    // Safely cast and access segments
    const segments = (res as any)?.segments as WhisperSegment[] | undefined;

    if (!Array.isArray(segments)) {
      log.warn(
        `[${operationId}] Chunk ${chunkIndex}: Invalid or missing segments in Whisper response.`
      );
      return [];
    }

    log.debug(
      `[${operationId}] Chunk ${chunkIndex}: Received ${segments.length} raw segments from Whisper.`
    );

    // Filter based on Whisper's confidence and map to SrtSegment
    const srtSegments: SrtSegment[] = segments
      .filter(s => {
        const isSpeech = s.no_speech_prob < 0.6 && s.avg_logprob > -1.5;
        if (!isSpeech) {
          log.debug(
            `[${operationId}] Chunk ${chunkIndex}: Filtering out segment (no_speech_prob: ${s.no_speech_prob.toFixed(2)}, avg_logprob: ${s.avg_logprob.toFixed(2)}) Text: "${s.text.trim()}"`
          );
        }
        return isSpeech;
      })
      .map((s, i) => {
        const absoluteStart = s.start + startTime;
        const absoluteEnd = Math.max(s.end + startTime, absoluteStart); // Ensure end >= start
        return {
          index: i + 1, // Re-index after filtering
          start: absoluteStart,
          end: absoluteEnd,
          text: s.text.trim(),
        };
      });

    log.debug(
      `[${operationId}] Chunk ${chunkIndex}: Produced ${srtSegments.length} segments after confidence filtering.`
    );
    return srtSegments;
  } catch (error: any) {
    // Handle API errors, including cancellations
    if (
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Cancelled') ||
      signal?.aborted
    ) {
      log.info(
        `[${operationId}] Transcription for chunk ${chunkIndex} was cancelled.`
      );
      return []; // Don't re-throw cancellation, allow batch to continue
    } else {
      log.error(
        `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
        error?.message || error
      );
      // Consider if specific API errors (like 429 rate limit) need retry logic here or rely on higher level retries
      return []; // Return empty on other errors as well
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
    return `Line ${absoluteIndex + 1}: ${segment.text}`;
  });

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles 
into natural, fluent ${targetLang}.

Here are the subtitles to translate:
${batchContextPrompt.join('\n')}

Translate EACH line individually, preserving the line order. 
- **Never merge** multiple lines into one, and never skip or omit a line. 
- If a line's content was already translated in the previous line, LEAVE IT BLANK. WHEN THERE ARE LIKE 1~2 WORDS THAT ARE LEFT OVERS FROM THE PREVIOUS SENTENCE, THEN THIS IS ALMOST ALWAYS THE CASE. DO NOT ATTEMPT TO FILL UP THE BLANK WITH THE NEXT TRANSLATION. AVOID SYNCHRONIZATION ISSUES AT ALL COSTS.
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
        let translatedText = segment.text;
        const originalSegmentText = segment.text;

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
          text: `${originalSegmentText}###TRANSLATION_MARKER###${translatedText}`,
          originalText: originalSegmentText,
          translatedText,
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
        text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
        originalText: segment.text,
        translatedText: segment.text,
      }));
    }
  }

  log.warn(
    `[${operationId}] Translation failed after ${MAX_RETRIES} retries, using original text`
  );

  return batch.segments.map(segment => ({
    ...segment,
    text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
    originalText: segment.text,
    translatedText: segment.text,
  }));
}

async function reviewTranslationBatch({
  batch,
  operationId,
  signal,
}: {
  batch: any;
  operationId: string;
  signal?: AbortSignal;
}): Promise<any[]> {
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
  );

  const batchItemsWithContext = batch.segments.map(
    (block: any, idx: number) => {
      const absoluteIndex = batch.startIndex + idx;
      const [original, translation] = block.text.split(
        '###TRANSLATION_MARKER###'
      );
      return {
        index: absoluteIndex + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
        isPartOfBatch: true,
      };
    }
  );

  const originalTexts = batchItemsWithContext
    .map((item: any) => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map((item: any) => `[${item.index}] ${item.translation}`)
    .join('\n');

  const prompt = `
You are a professional subtitle reviewer for ${batch.targetLang}.
Your task is to review and improve the provided batch of translated subtitles based on their original counterparts, focusing *only* on translation accuracy, natural phrasing, grammar, and style.

**Input:**
You will receive ${batch.segments.length} pairs of original and translated subtitles, prefixed with their line number (e.g., "[index] Original Text").

**Original Texts:**
${originalTexts}

**Translations to Review:**
${translatedTexts}

**Strict Instructions:**
1.  **Review Individually:** Review each translation line-by-line against its corresponding original text.
2.  **Improve Wording & Style ONLY:** Correct errors in translation, grammar, or style. Ensure the translation is natural and fluent in ${batch.targetLang}.
3.  **DO NOT CHANGE STRUCTURE:** You MUST **NOT** merge multiple lines into one, split a line into multiple lines, or reorder lines. Maintain the exact one-to-one correspondence.
4.  **Synchronization Rule (Handling Leftovers):** If a translated line's content (often short phrases like one or two words) clearly belongs linguistically to the *previous* line's translation and makes no sense on its own, output a **COMPLETELY BLANK** line for the current translation's review. Do *not* pull content from the *next* line to fill it.
5.  **Consistency:** Ensure consistent terminology and style throughout the batch.

**Output Format:**
- **Prefix EVERY line** you output with the exact delimiter \`@@SUB_LINE@@\` (including blank lines required by the Synchronization Rule).
- Provide **ONLY** the reviewed and improved translation text for **each** line in the batch, respecting the structure.
- Output exactly one reviewed translation per line, in the **exact same order** as the input batch.
- **DO NOT add extra blank lines between translations.** Only output a blank line if the Synchronization Rule explicitly requires it.
- **DO NOT** include the "[index]" prefixes in your output.
- If a line's translation should be blank according to the Synchronization Rule, output ONLY the prefix \`@@SUB_LINE@@\` followed by a newline.

Now, provide the reviewed translations for the ${batch.segments.length} lines above, adhering strictly to all instructions and ensuring each line starts with \`@@SUB_LINE@@\`:
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

    const splitByDelimiter = reviewedContent.split('@@SUB_LINE@@');
    const parsedLines = splitByDelimiter.slice(1);

    // Check if the number of parsed lines matches the expected batch size
    if (parsedLines.length !== batch.segments.length) {
      log.warn(
        `[Review Fallback] Review output line count (${parsedLines.length}) does not match batch size (${batch.segments.length}). Expected ${batch.segments.length}. Falling back to original translations for this batch.`
      );
      log.info('--- Faulty Review Output ---');
      log.info(reviewedContent); // Log the faulty content for debugging
      log.info('--- End Faulty Review Output ---');
      // Return the original, unreviewed segments for this batch
      return batch.segments;
    }

    // If the line count is correct, proceed to map the results
    log.info(
      `[Review] Successfully parsed ${parsedLines.length} reviewed lines.`
    );
    return batch.segments.map((segment: any, idx: number) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      // IMPORTANT: Ensure trimming happens correctly here if needed based on AI output habits
      const reviewedTranslation = parsedLines[idx]?.trim() ?? '';

      // Keep blank if the review explicitly returned blank, otherwise use the review.
      const finalTranslation = reviewedTranslation; // Simplified

      return {
        ...segment,
        text: `${originalText}###TRANSLATION_MARKER###${finalTranslation}`,
        originalText: originalText,
        // Keep a record of the reviewed text if needed, adjust property name if desired
        reviewedText: finalTranslation,
      };
    });
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

function extendShortSubtitleGaps(
  segments: SrtSegment[],
  threshold: number = 3
): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments; // Return original if no adjustments possible
  }

  log.debug(
    `[extendShortSubtitleGaps IN-PLACE] Input segments (first 5): ${JSON.stringify(segments.slice(0, 5), null, 2)}`
  );

  // Iterate through the segments array directly
  // Loop up to length - 1 because we access i and i + 1
  for (let i = 0; i < segments.length - 1; i++) {
    // Read directly from the input/mutating array
    const currentSegment = segments[i];
    const nextSegment = segments[i + 1];

    const currentEndTime = Number(currentSegment.end);
    const nextStartTime = Number(nextSegment.start);

    log.debug(
      `[GapCheck IN-PLACE Index ${i}] Current End: ${currentEndTime.toFixed(4)}, Next Start: ${nextStartTime.toFixed(4)}`
    );

    if (isNaN(currentEndTime) || isNaN(nextStartTime)) {
      log.warn(
        `[GapCheck IN-PLACE Index ${i}] Invalid time encountered, skipping gap adjustment.`
      );
      continue;
    }

    const gap = nextStartTime - currentEndTime;
    const localThreshold = threshold;

    log.debug(
      `[GapCheck IN-PLACE Index ${i}] Gap: ${gap.toFixed(4)}, Threshold: ${localThreshold}, Condition (gap > 0 && gap < threshold): ${gap > 0 && gap < localThreshold}`
    );

    if (gap > 0 && gap < localThreshold) {
      log.info(
        `[GapCheck IN-PLACE Index ${i}] ADJUSTING end time for segment at index ${i} from ${currentEndTime.toFixed(4)} to ${nextStartTime.toFixed(4)}.`
      );
      // --- Apply the change DIRECTLY to the segment in the input array ---
      currentSegment.end = nextStartTime; // Modify the .end property of the object at index i
      // --- End Change ---
    } else {
      log.debug(`[GapCheck IN-PLACE Index ${i}] NO adjustment needed.`);
    }
  }

  log.debug(
    `[extendShortSubtitleGaps IN-PLACE] Output segments (first 5): ${JSON.stringify(segments.slice(0, 5), null, 2)}`
  );

  // Return the mutated array
  return segments;
}

function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment }));
  let lastGoodTranslation = ''; // Track the last non-blank translation

  for (const currentSegment of adjustedSegments) {
    const currentParts = currentSegment.text.split('###TRANSLATION_MARKER###');
    const currentOriginal = currentParts[0] || '';
    const currentTranslation = currentParts[1] || ''; // Default to blank if no marker/translation

    // Check if the current translation is effectively blank
    if (currentTranslation.trim() !== '') {
      // Not blank: update lastGoodTranslation and continue
      lastGoodTranslation = currentTranslation.trim();
      continue;
    }

    if (lastGoodTranslation) {
      currentSegment.text = `${currentOriginal}###TRANSLATION_MARKER###${lastGoodTranslation}`;
    }
  }

  const remainingBlanks = adjustedSegments.filter(
    s =>
      s.text.endsWith('###TRANSLATION_MARKER###') ||
      s.text.split('###TRANSLATION_MARKER###')[1]?.trim() === ''
  ).length;
  if (remainingBlanks > 0) {
    // Only log if there are blanks
    log.debug(
      `[fillBlankTranslations] Found ${remainingBlanks} segments still blank after processing.`
    );
  }
  // --- END CHANGE 3 ---

  return adjustedSegments;
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
      const content = response.choices[0]?.message?.content;
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
  vadMode = 3, // 0–3 (3 = most aggressive)
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
  // Initialize with the first interval
  if (intervals[0]) {
    merged.push({ ...intervals[0] });
  }

  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i];
    const last = merged.at(-1); // Use .at(-1) for safety

    // Ensure last interval exists before attempting merge logic
    if (last && cur.start - last.end < minGapSec) {
      // Merge: extend the end time of the last interval
      last.end = Math.max(last.end, cur.end); // Ensure end time covers both
    } else {
      // No merge: add the current interval as a new one
      merged.push({ ...cur });
    }
  }
  // Filter based on minimum duration AFTER merging
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
  merged.push({ ...intervals[0] }); // Start with the first interval

  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const last = merged[merged.length - 1];

    if (current.start - last.end < maxGapSec) {
      // Merge if gap is small enough
      last.end = Math.max(last.end, current.end);
    } else {
      // Otherwise, start a new merged interval
      merged.push({ ...current });
    }
  }
  return merged;
}
