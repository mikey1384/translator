import path from 'path';
import { FFmpegService, FFmpegError } from './ffmpeg-service.js';
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
const VAD_NORMALIZATION_MIN_GAP_SEC = 0.2; // Min gap between speech intervals to merge
const VAD_NORMALIZATION_MIN_DURATION_SEC = 0.2;

const MERGE_GAP_SEC = 0.3; // Max gap between VAD intervals to merge into a speech block
const PAD_SEC = 0.2; // Padding added around speech chunks
const MAX_CHUNK_DURATION_SEC = 60; // Max duration for a speech chunk before splitting

const PRUNING_MIN_DURATION_SEC = 0.1; // Min duration for a final pruned segment (Relaxed)
const PRUNING_MIN_WORDS = 1; // Min words for a final pruned segment

// --- Concurrency Setting ---
const TRANSCRIPTION_BATCH_SIZE = 50; // Number of chunks to process in parallel
const USE_WHISPER_GATE = true; // Master switch for Whisper's confidence filtering

async function getApiKey(keyType: 'openai'): Promise<string> {
  const key = await getSecureApiKey(keyType);
  if (key) {
    return key;
  }

  throw new SubtitleProcessingError(
    `OpenAI API key not found. Please set it in the application settings.`
  );
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

function createFileFromPath(filePath: string): fs.ReadStream {
  try {
    return fs.createReadStream(filePath);
  } catch (error) {
    throw new SubtitleProcessingError(`Failed to create file stream: ${error}`);
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

    const subtitlesContent = await generateSubtitlesFromAudio({
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

    if (!isTranslationNeeded) {
      await fileManager.writeTempFile(subtitlesContent, '.srt');
      progressCallback?.({
        percent: STAGE_FINALIZING.end,
        stage: 'Transcription complete',
        partialResult: subtitlesContent,
      });
      return { subtitles: subtitlesContent };
    }

    const segmentsInProcess = parseSrt(subtitlesContent);
    const totalSegments = segmentsInProcess.length;
    const TRANSLATION_BATCH_SIZE = 10;

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
        operationId: `${operationId}-trans-${batchStart}`,
        signal,
      });
      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }
      const overallProgress = (batchEnd / totalSegments) * 100;
      const cumulativeSrt = buildSrt(segmentsInProcess);
      progressCallback?.({
        percent: scaleProgress(overallProgress, STAGE_TRANSLATION),
        stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(
          totalSegments / TRANSLATION_BATCH_SIZE
        )}`,
        partialResult: cumulativeSrt,
        current: batchEnd,
        total: totalSegments,
      });
    }

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
      const reviewedBatch = await reviewTranslationBatch(
        {
          segments: currentBatchTranslated.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
          targetLang,
        },
        signal,
        `${operationId}-review-${batchStart}`
      );
      for (let i = 0; i < reviewedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = reviewedBatch[i];
      }
      const overallProgress = (batchEnd / segmentsInProcess.length) * 100;
      const cumulativeReviewedSrt = buildSrt(segmentsInProcess);
      progressCallback?.({
        percent: scaleProgress(overallProgress, STAGE_REVIEW),
        stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(
          segmentsInProcess.length / REVIEW_BATCH_SIZE
        )}`,
        partialResult: cumulativeReviewedSrt,
        current: batchEnd,
        total: segmentsInProcess.length,
        batchStartIndex: batchStart,
      });
    }

    progressCallback?.({
      percent: STAGE_FINALIZING.start,
      stage: 'Finalizing subtitles',
    });

    const indexedSegments = segmentsInProcess.map((block, idx) => ({
      ...block,
      index: idx + 1,
    }));
    const gapFilledSegments = extendShortSubtitleGaps(indexedSegments, 3);
    const finalSegments = fillBlankTranslations(gapFilledSegments);

    log.debug(
      `[${operationId}] Segments after fillBlankTranslations (${finalSegments.length} segments):`,
      JSON.stringify(finalSegments.slice(0, 5), null, 2)
    );

    const finalSrtContent = buildSrt(finalSegments);

    await fileManager.writeTempFile(finalSrtContent, '.srt');
    progressCallback?.({
      percent: STAGE_FINALIZING.end,
      stage: 'Translation and review complete',
      partialResult: finalSrtContent,
    });

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
        stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
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
}: GenerateSubtitlesFromAudioArgs): Promise<string> {
  const PROGRESS_ANALYSIS_DONE = 5;
  const PROGRESS_TRANSCRIPTION_START = 20;
  const PROGRESS_TRANSCRIPTION_END = 95;
  const PROGRESS_FINALIZING = 100;

  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const createdWindowFilePaths: string[] = []; // For combined wav/txt files
  const tempDir = path.dirname(inputAudioPath);

  try {
    try {
      const openaiApiKey = await getApiKey('openai');
      openai = new OpenAI({ apiKey: openaiApiKey });
    } catch (keyError) {
      const message =
        keyError instanceof Error ? keyError.message : String(keyError);
      progressCallback?.({ percent: 0, stage: 'Error', error: message });
      throw new SubtitleProcessingError(message);
    }

    if (!fs.existsSync(inputAudioPath)) {
      throw new SubtitleProcessingError(
        `Audio file not found: ${inputAudioPath}`
      );
    }

    progressCallback?.({ percent: 0, stage: 'Analyzing audio file...' });

    if (!services?.ffmpegService) {
      throw new SubtitleProcessingError('FFmpegService is required.');
    }
    const { ffmpegService } = services;

    const duration = await ffmpegService.getMediaDuration(inputAudioPath);
    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Unable to determine valid audio duration.'
      );
    }

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Audio analyzed',
    });

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE,
      stage: 'Detecting initial speech boundaries...',
    });

    // --- Detect Initial Intervals ---
    const rawIntervals = await detectSpeechIntervals({
      inputPath: inputAudioPath,
    });
    // Use normalization defaults from constants
    const speechIntervals = normalizeSpeechIntervals({
      intervals: rawIntervals,
    });
    log.info(
      `[${operationId}] Initial VAD found ${rawIntervals.length} raw intervals, normalized to ${speechIntervals.length} speech intervals.`
    );
    // --- End Detect Initial Intervals ---

    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE + 5, // Slightly advance progress
      stage: 'Calculating audio chunk metadata...',
    });

    // --- Generate Chunk Metadata (Silence-Based) ---
    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE + 5, // Keep existing progress steps
      stage: 'Merging adjacent speech intervals...',
    });

    // 1. Get Raw Intervals (you already have this from the detectSpeechIntervals call)
    // const rawIntervals = await detectSpeechIntervals(...)

    // 2. Merge adjacent raw intervals into larger speech blocks
    const speechBlocks = mergeAdjacentIntervals(speechIntervals, MERGE_GAP_SEC);
    log.info(
      `[${operationId}] Merged ${rawIntervals.length} raw VAD intervals into ${speechBlocks.length} speech blocks (Merge Gap: ${MERGE_GAP_SEC}s).`
    );

    // 3. Split any speech blocks longer than MAX_CHUNK_DURATION_SEC
    const splitSpeechBlocks = speechBlocks.flatMap(block =>
      splitLongInterval(block, rawIntervals, MAX_CHUNK_DURATION_SEC)
    );
    log.info(
      `[${operationId}] Split long blocks into ${splitSpeechBlocks.length} final speech segments (Max Duration: ${MAX_CHUNK_DURATION_SEC}s).`
    );

    // 4. Pad speech chunks and clamp to audio boundaries
    const paddedSpeechChunks = splitSpeechBlocks
      .map(block => ({
        start: Math.max(0, block.start - PAD_SEC),
        end: Math.min(duration, block.end + PAD_SEC), // 'duration' is the total audio duration from getMediaDuration
        isSilence: false,
      }))
      .sort((a, b) => a.start - b.start); // Sort by start time

    log.info(
      `[${operationId}] Padded ${paddedSpeechChunks.length} speech segments (Pad: ${PAD_SEC}s).`
    );

    // 5. Create the final chunk list, inserting silence chunks to fill gaps
    progressCallback?.({
      percent: PROGRESS_ANALYSIS_DONE + 10,
      stage: 'Identifying silence gaps...',
    });

    const finalChunkMetadata: Array<{
      start: number;
      end: number;
      isSilence: boolean;
      index: number;
    }> = [];
    let cursor = 0;
    let chunkIndex = 0; // Use a separate index for the final list

    for (const speechChunk of paddedSpeechChunks) {
      // Ensure start/end times are valid
      if (speechChunk.start < cursor) {
        log.warn(
          `[${operationId}] Overlapping speech chunk detected. Adjusting start from ${speechChunk.start.toFixed(2)} to ${cursor.toFixed(2)}.`
        );
        speechChunk.start = cursor; // Prevent overlap by clamping start
      }

      // Prevent zero or negative duration chunks after adjustment
      if (speechChunk.end <= speechChunk.start) {
        log.warn(
          `[${operationId}] Skipping zero/negative duration speech chunk after padding/overlap adjustment: ${speechChunk.start.toFixed(2)}-${speechChunk.end.toFixed(2)}`
        );
        continue; // Skip this invalid chunk
      }

      // Add silence chunk if there's a gap before this speech chunk
      if (speechChunk.start > cursor) {
        chunkIndex++;
        finalChunkMetadata.push({
          start: cursor,
          end: speechChunk.start,
          isSilence: true,
          index: chunkIndex,
        });
      }

      // Add the speech chunk itself
      chunkIndex++;
      finalChunkMetadata.push({
        start: speechChunk.start,
        end: speechChunk.end,
        isSilence: false,
        index: chunkIndex,
      });

      // Update cursor to the end of the current speech chunk
      cursor = speechChunk.end;
    }

    // Add final silence chunk if needed
    if (cursor < duration) {
      chunkIndex++;
      finalChunkMetadata.push({
        start: cursor,
        end: duration,
        isSilence: true,
        index: chunkIndex,
      });
    }

    log.info(
      `[${operationId}] Generated ${finalChunkMetadata.length} total chunks (speech and silence) covering full duration.`
    );

    // --- Add requested logging for the first 10 chunks ---
    log.info(`[${operationId}] First 10 generated chunks:`);
    finalChunkMetadata.slice(0, 10).forEach(chunk => {
      const duration = chunk.end - chunk.start;
      log.info(
        `  Chunk ${chunk.index}: start=${chunk.start.toFixed(2)}, end=${chunk.end.toFixed(2)}, duration=${duration.toFixed(2)}s, isSilence=${chunk.isSilence}`
      );
    });
    // --- End Logging ---

    // --- End New Chunk Metadata Generation ---

    // --- Concurrent Transcription Window Processing ---
    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_START,
      stage: `Starting transcription for ${finalChunkMetadata.length} chunks...`,
    });

    const totalChunks = finalChunkMetadata.length;
    let completedChunks = 0;
    const resultsSegments: SrtSegment[] = [];

    // Check for cancellation before starting the loop
    if (signal?.aborted) throw new Error('Operation cancelled');

    for (
      let batchStart = 0;
      batchStart < totalChunks;
      batchStart += TRANSCRIPTION_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + TRANSCRIPTION_BATCH_SIZE,
        totalChunks
      );
      const batch = finalChunkMetadata.slice(batchStart, batchEnd);
      log.info(
        `[${operationId}] Processing transcription batch ${Math.ceil(batchEnd / TRANSCRIPTION_BATCH_SIZE)}/${Math.ceil(totalChunks / TRANSCRIPTION_BATCH_SIZE)} (Chunks ${batchStart + 1}-${batchEnd})`
      );

      const promises = batch.map(meta =>
        (async () => {
          if (signal?.aborted) throw new Error('Operation cancelled'); // Check within promise too

          const { index: chunkIndex, start, end, isSilence } = meta;
          const chunkAudioPath = path.join(
            tempDir,
            `chunk_${chunkIndex}_${operationId}.wav`
          );
          createdWindowFilePaths.push(chunkAudioPath); // Track for cleanup

          try {
            if (isSilence) {
              log.debug(
                `[${operationId}] Skipping transcription for silence chunk ${chunkIndex}.`
              );
              return []; // Return empty array for silence chunks
            }

            if (end <= start) {
              log.warn(
                `[${operationId}] Skipping zero/negative duration speech chunk: ${start.toFixed(2)}-${end.toFixed(2)}`
              );
              return []; // Skip this invalid chunk
            }

            log.debug(
              `[${operationId}] Extracting chunk ${chunkIndex}: ${start.toFixed(2)}s (Duration: ${end - start})`
            );

            // 1. Extract the audio segment for THIS chunk
            await ffmpegService.extractAudioSegment({
              inputPath: inputAudioPath,
              outputPath: chunkAudioPath,
              startTime: start,
              duration: end - start,
              operationId: `${operationId}-extract-chunk-${chunkIndex}`,
              // Pass signal for potential cancellation during extraction
              signal: signal,
            });

            // Check signal again after extraction
            if (signal?.aborted) throw new Error('Operation cancelled');

            // 2. Transcribe THIS chunk
            const windowSegments = await transcribeChunk({
              chunkIndex,
              chunkPath: chunkAudioPath,
              startTime: start,
              signal,
              openai,
              operationId: operationId as string,
              isSilence,
            });

            if (windowSegments.length > 0) {
              log.info(
                `[${operationId}] Successfully transcribed chunk ${chunkIndex}. Added ${windowSegments.length} segments.`
              );
            } else {
              log.warn(
                `[${operationId}] Chunk ${chunkIndex} returned no segments post-transcription.`
              );
            }
            return windowSegments; // Return segments (can be empty)
          } catch (chunkError: any) {
            // Don't re-throw cancellation errors, just return empty
            if (
              chunkError instanceof Error &&
              chunkError.message === 'Operation cancelled'
            ) {
              log.info(
                `[${operationId}] Chunk ${chunkIndex} processing cancelled.`
              );
              return [];
            }
            // Log other errors
            console.error(
              `[${operationId}] Error processing chunk ${chunkIndex}:`,
              chunkError?.message || chunkError
            );
            // Optionally report error via progress callback
            progressCallback?.({
              percent: -1, // Indicate error maybe?
              stage: `Error in chunk ${chunkIndex}`,
              error: chunkError?.message || String(chunkError),
            });
            return []; // Return empty array on error to not break Promise.all
          } finally {
            // Optional: Cleanup individual chunk file immediately after use?
            // Or keep the bulk cleanup at the end. Current logic keeps bulk cleanup.
            // await fsp.unlink(chunkAudioPath).catch(err => log.warn(`Failed to delete chunk ${chunkIndex} immediately: ${err}`));
          }
        })()
      ); // End of async IIFE

      // Await all promises in the current batch
      // Promise.allSettled might be safer if you want to guarantee progress update even if one promise unexpectedly throws (despite inner catch)
      const batchResults = await Promise.all(promises);

      // Aggregate segments from successful results
      batchResults.forEach(winSegs => {
        if (Array.isArray(winSegs)) {
          // Ensure it's an array (handles errors returning [])
          resultsSegments.push(...winSegs);
        }
      });
      completedChunks += batch.length; // Increment by actual batch size processed

      // Update progress after batch completion
      const currentProgressPercent = (completedChunks / totalChunks) * 100;
      const scaledProgress = Math.round(
        PROGRESS_TRANSCRIPTION_START +
          (currentProgressPercent / 100) *
            (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START)
      );
      progressCallback?.({
        percent: scaledProgress,
        stage: `Transcribing... (${completedChunks}/${totalChunks} chunks processed)`,
        current: completedChunks,
        total: totalChunks,
        partialResult: buildSrt(
          resultsSegments.slice().sort((a, b) => a.start - b.start)
        ), // Show intermediate results maybe?
      });

      // Check for cancellation between batches
      if (signal?.aborted) throw new Error('Operation cancelled');
    } // --- End of Batch Processing Loop ---

    // Push all aggregated segments into the main array
    overallSegments.push(...resultsSegments);

    // Ensure sorting happens after all batches are done
    overallSegments.sort((a, b) => a.start - b.start);

    // --- Add Post-Transcription VAD Filtering ---
    log.info(
      `[${operationId}] Performing post-transcription filtering on ${overallSegments.length} segments...`
    );

    let filteredSegmentsAfterTranscription: SrtSegment[];

    if (USE_WHISPER_GATE) {
      log.info(
        `[${operationId}] Skipping IoU VAD filtering because USE_WHISPER_GATE is true.`
      );
      filteredSegmentsAfterTranscription = [...overallSegments]; // Use segments as-is (already filtered by Whisper)
    } else {
      log.info(
        `[${operationId}] Applying IoU VAD filtering (USE_WHISPER_GATE is false).`
      );
      const postVadRawIntervals = await detectSpeechIntervals({
        inputPath: inputAudioPath,
      });
      const postVadSpeechIntervals = normalizeSpeechIntervals({
        intervals: postVadRawIntervals,
        minGapSec: VAD_NORMALIZATION_MIN_GAP_SEC, // Use existing constants
        minDurSec: VAD_NORMALIZATION_MIN_DURATION_SEC,
      });
      log.info(
        `[${operationId}] Post-VAD found ${postVadSpeechIntervals.length} speech intervals for IoU check.`
      );
      filteredSegmentsAfterTranscription = overallSegments.filter(seg =>
        hasSufficientSpeech({
          seg,
          postVadSpeechIntervals,
          minIoU: 0.25, // Keep the 0.25 threshold for when this filter IS used
        })
      );
      log.info(
        `[${operationId}] IoU VAD filtering reduced ${overallSegments.length} segments down to ${filteredSegmentsAfterTranscription.length}.`
      );
    }

    // Replace overallSegments with the filtered list
    overallSegments.length = 0; // Clear the array
    overallSegments.push(...filteredSegmentsAfterTranscription); // Add filtered segments back
    // --- End Post-Transcription Filtering ---

    // --- Add Pruning Step ---
    log.info(
      `[${operationId}] Pruning ${overallSegments.length} segments before finalization...`
    );
    const prunedSegments = pruneSegments({
      segments: overallSegments,
      minDurSec: PRUNING_MIN_DURATION_SEC, // Use constant
      minWords: PRUNING_MIN_WORDS, // Use constant
    });
    log.info(
      `[${operationId}] Pruned down to ${prunedSegments.length} segments.`
    );
    // --- End Pruning Step ---

    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_END,
      stage: `Finalizing ${prunedSegments.length} subtitle segments...`,
    });

    // Use prunedSegments for the final output
    const finalSrtContent = buildSrt(prunedSegments);

    progressCallback?.({
      percent: PROGRESS_FINALIZING,
      stage: 'Transcription complete!',
    });

    return finalSrtContent;
  } catch (error: any) {
    console.error(
      `[${operationId}] Error in generateSubtitlesFromAudio:`,
      error
    );
    progressCallback?.({
      percent: 100,
      stage: 'Error',
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof SubtitleProcessingError) {
      throw error;
    }
    throw new SubtitleProcessingError(
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    // Combine original chunk paths and window file paths for cleanup
    const allTempFilesToDelete = [
      ...createdWindowFilePaths, // Only window files remain
    ];
    log.info(
      `[${operationId}] Cleaning up ${allTempFilesToDelete.length} temporary files (chunks, windows, lists)...`
    );
    const deletionTasks = allTempFilesToDelete.map(filePath =>
      fsp.unlink(filePath).catch(err =>
        console.warn(
          `[${operationId}] Failed to delete temp file ${filePath}:`,
          err?.message || err // Log error message if available
        )
      )
    );
    await Promise.allSettled(deletionTasks);
    console.info(`[${operationId}] Finished cleaning up temporary files.`);
  }

  function hasSufficientSpeech({
    seg,
    postVadSpeechIntervals,
    minIoU = 0.25,
  }: {
    seg: SrtSegment;
    postVadSpeechIntervals: Array<{ start: number; end: number }>;
    minIoU?: number;
  }): boolean {
    const segmentDuration = seg.end - seg.start;
    if (segmentDuration <= 0) {
      return false;
    }

    const overlapDuration = calculateOverlapDuration(
      seg,
      postVadSpeechIntervals
    );
    const iouApproximation = overlapDuration / segmentDuration;

    return iouApproximation >= minIoU;
  }
}

async function transcribeChunk({
  chunkIndex,
  chunkPath,
  startTime,
  signal,
  openai,
  operationId,
  isSilence,
  options,
}: {
  chunkIndex: number;
  chunkPath: string;
  startTime: number;
  signal?: AbortSignal;
  openai: OpenAI;
  operationId: string;
  isSilence: boolean;
  options?: GenerateSubtitlesOptions;
}): Promise<SrtSegment[]> {
  try {
    if (signal?.aborted) {
      log.info(
        `[${operationId}] Transcription for chunk ${chunkIndex} cancelled before API call.`
      );
      throw new Error('Operation cancelled');
    }

    if (isSilence) {
      log.debug(
        `[${operationId}] Skipping transcription for silence chunk ${chunkIndex}.`
      );
      return []; // Return empty array for silence chunks
    }

    console.info(
      `[${operationId}] Sending chunk ${chunkIndex} (${(fs.statSync(chunkPath).size / (1024 * 1024)).toFixed(2)} MB) to OpenAI Whisper API.`
    );
    const fileStream = createFileFromPath(chunkPath);
    const response = await openai.audio.transcriptions.create(
      {
        model: AI_MODELS.WHISPER.id,
        file: fileStream,
        response_format: 'verbose_json',
        temperature: 0,
        language: options?.sourceLang,
      },
      { signal }
    );

    console.info(
      `[${operationId}] Received transcription for chunk ${chunkIndex}.`
    );

    // Define an interface for the verbose_json segment structure
    interface WhisperSegment {
      id: number; // Whisper segment ID (0-based)
      seek: number; // Seek offset in the chunk audio (seconds)
      start: number; // Segment start time relative to chunk audio (seconds)
      end: number; // Segment end time relative to chunk audio (seconds)
      text: string;
      tokens: number[]; // Token IDs
      temperature: number;
      avg_logprob: number;
      compression_ratio: number;
      no_speech_prob: number;
    }

    // Cast the response (ensure it matches the expected structure)
    const verboseResponse = response as unknown as {
      text: string; // Full transcript text
      segments: WhisperSegment[];
      language: string;
    };

    if (!verboseResponse || !Array.isArray(verboseResponse.segments)) {
      log.warn(
        `[${operationId}] Chunk ${chunkIndex}: Invalid verbose_json response structure. Discarding.`
      );
      return [];
    }

    log.debug(
      `[${operationId}] Raw verbose_json received for chunk ${chunkIndex} (startTime: ${startTime}): Found ${verboseResponse.segments.length} segments.`
    );

    // Filter segments based on confidence scores (conditionally)
    const speechSegments = verboseResponse.segments.filter(seg => {
      if (!USE_WHISPER_GATE) {
        return true; // Skip filtering if the gate is off
      }
      // --- Apply Whisper gate filtering ---
      const isSpeech = seg.no_speech_prob < 0.6 && seg.avg_logprob > -1.0;
      if (!isSpeech) {
        log.debug(
          `[${operationId}] Chunk ${chunkIndex}: Filtering out segment ${seg.id} via Whisper Gate (no_speech_prob: ${seg.no_speech_prob.toFixed(2)}, avg_logprob: ${seg.avg_logprob.toFixed(2)}) Text: "${seg.text.trim()}"`
        );
      }
      return isSpeech;
      // --- End Whisper gate filtering ---
    });

    // Map filtered segments to SrtSegment format with absolute timestamps
    const absoluteSegments = speechSegments.map((segment, index) => {
      // Calculate absolute time relative to the original audio
      const absoluteStart = segment.start + startTime;
      let absoluteEnd = segment.end + startTime;
      // Ensure end >= start
      absoluteEnd = Math.max(absoluteStart, absoluteEnd);

      return {
        index: index + 1, // Re-index based on the filtered list
        start: absoluteStart,
        end: absoluteEnd,
        text: segment.text.trim(), // Trim whitespace
      };
    });

    log.debug(
      `[${operationId}] Chunk ${chunkIndex}: Produced ${absoluteSegments.length} segments after confidence filtering.`
    );

    return absoluteSegments;
  } catch (error: any) {
    console.error(
      `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
      error.name,
      error.message
    );

    if (
      signal?.aborted ||
      error.name === 'AbortError' ||
      (error instanceof Error && error.message === 'Operation cancelled')
    ) {
      log.info(
        `[${operationId}] Transcription for chunk ${chunkIndex} was cancelled.`
      );
      return [];
    }

    // Handle other errors
    return [];
  }
}

export async function mergeSubtitlesWithVideo({
  options,
  operationId,
  services,
  progressCallback,
}: MergeSubtitlesWithVideoArgs): Promise<{ outputPath: string }> {
  const { ffmpegService } = services;
  log.info(`[${operationId}] mergeSubtitlesWithVideo called.`);

  const inputPathForNaming = options.videoFileName || options.videoPath;
  if (!inputPathForNaming) {
    throw new SubtitleProcessingError(
      'Either videoFileName or videoPath is required for naming output.'
    );
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required for merging');
  }
  if (!options.subtitlesPath) {
    throw new SubtitleProcessingError('Subtitles path is required');
  }

  progressCallback?.({ percent: 0, stage: 'Starting subtitle merging' });

  const videoExt = path.extname(inputPathForNaming);
  const baseName = path.basename(inputPathForNaming, videoExt);
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles.mp4`;
  const outputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  progressCallback?.({ percent: 25, stage: 'Analyzing input file' });
  log.info(`[${operationId}] Checking if input has a video stream...`);
  let hasVideo: boolean;
  try {
    hasVideo = await ffmpegService.hasVideoTrack(options.videoPath);
  } catch (probeError) {
    log.error(`[${operationId}] Error probing for video track:`, probeError);
    throw new SubtitleProcessingError(
      `Failed to analyze input file: ${probeError instanceof Error ? probeError.message : String(probeError)}`
    );
  }

  log.info(
    `[${operationId}] Input is ${hasVideo ? 'video' : 'audio-only'}. Output path: ${outputPath}`
  );

  try {
    let mergeResultPath: string;
    if (hasVideo) {
      log.info(
        `[${operationId}] Input has video. Calling standard mergeSubtitles for: ${options.videoPath}`
      );
      mergeResultPath = await ffmpegService.mergeSubtitles(
        options.videoPath!,
        options.subtitlesPath!,
        outputPath,
        operationId,
        options.fontSize,
        options.stylePreset,
        progressCallback
      );
    } else {
      log.info(
        `[${operationId}] Input is audio only. Calling mergeAudioOnlyWithSubtitles for: ${options.videoPath}`
      );
      mergeResultPath = await ffmpegService.mergeAudioOnlyWithSubtitles({
        audioPath: options.videoPath!,
        subtitlesPath: options.subtitlesPath!,
        outputPath,
        operationId,
        fontSize: options.fontSize,
        stylePreset: options.stylePreset,
        progressCallback,
      });
    }

    if (
      !mergeResultPath ||
      mergeResultPath === '' ||
      !fs.existsSync(outputPath)
    ) {
      log.info(
        `[${operationId}] Merge operation (video or audio) was cancelled or failed to create output file.`
      );
      progressCallback?.({ percent: 100, stage: 'Merge cancelled' });
      return { outputPath: '' };
    }

    progressCallback?.({
      percent: 100,
      stage: hasVideo ? 'Merge complete' : 'Audio + Subtitles complete',
    });
    return { outputPath };
  } catch (error: any) {
    log.error(`[${operationId}] Error during merge process:`, error);

    const isCancellation =
      error instanceof FFmpegError && error.message === 'Operation cancelled';

    progressCallback?.({
      percent: 100,
      stage: isCancellation
        ? 'Merge cancelled'
        : `Error: ${error instanceof Error ? error.message : String(error)}`,
    });

    if (isCancellation) {
      log.info(`[${operationId}] Merge operation was cancelled.`);
      return { outputPath: '' };
    } else {
      throw error;
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
        operationId: `${operationId}-translate`,
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

async function reviewTranslationBatch(
  batch: {
    segments: any[];
    startIndex: number;
    endIndex: number;
    targetLang: string;
  },
  signal?: AbortSignal,
  parentOperationId: string = 'review-batch'
): Promise<any[]> {
  const operationId = `${parentOperationId}-review-${batch.startIndex}-${batch.endIndex}`;
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
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map(item => `[${item.index}] ${item.translation}`)
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
      operationId: `${operationId}-review`,
      retryAttempts: 3,
    });

    if (!reviewedContent) {
      log.warn(
        '[Review] Review response content was empty or null. Using original translations.'
      );
      return batch.segments;
    }

    // Split by delimiter. Result will have an empty string at the start if content begins with the delimiter.
    const splitByDelimiter = reviewedContent.split('@@SUB_LINE@@');
    // Filter out potential empty first element and any trailing empty strings from final delimiter.
    const parsedLines = splitByDelimiter.filter(
      (line, index) => index > 0 || line.trim() !== ''
    );

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
    return batch.segments.map((segment, idx) => {
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
      `[Review] Error during initial review batch (${parentOperationId}):`, // Updated log message slightly
      error.name,
      error.message
    );
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(
        `[Review] Review batch (${parentOperationId}) cancelled. Rethrowing.`
      );
      throw error;
    }
    log.error(
      `[Review] Unhandled error in reviewTranslationBatch (${parentOperationId}). Falling back to original batch segments.`
    );
    return batch.segments;
  }
}

function extendShortSubtitleGaps(
  segments: SrtSegment[],
  threshold: number = 3
): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment }));

  for (let i = 0; i < adjustedSegments.length - 1; i++) {
    const currentSegment = adjustedSegments[i];
    const nextSegment = adjustedSegments[i + 1];

    const currentEndTime = Number(currentSegment.end);
    const nextStartTime = Number(nextSegment.start);

    if (isNaN(currentEndTime) || isNaN(nextStartTime)) {
      log.warn(
        `Invalid time encountered at index ${i}, skipping gap adjustment.`
      );
      continue;
    }

    const gap = nextStartTime - currentEndTime;

    if (gap > 0 && gap < threshold) {
      currentSegment.end = nextStartTime;
    }
  }

  return adjustedSegments;
}

function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment }));

  for (let i = 1; i < adjustedSegments.length; i++) {
    const currentSegment = adjustedSegments[i];
    const prevSegment = adjustedSegments[i - 1];

    const currentParts = currentSegment.text.split('###TRANSLATION_MARKER###');
    const currentHasMarker = currentParts.length > 1;
    const currentOriginal = currentParts[0] || '';
    const currentTranslation = currentParts[1] || '';
    const isCurrentBlank =
      currentHasMarker &&
      currentOriginal.trim() !== '' &&
      currentTranslation.trim() === '';

    if (isCurrentBlank) {
      const prevParts = prevSegment.text.split('###TRANSLATION_MARKER###');
      const prevTranslation = prevParts[1] || '';

      if (prevTranslation.trim() !== '') {
        currentSegment.text = `${currentOriginal}###TRANSLATION_MARKER###${prevTranslation}`;
      }
    }
  }

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
  frameMs = 30, // WebRTC supports 10/20/30 ms
  // Add operationId for logging
  operationId = 'vad-process',
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
        const t = currentFrameIndex * (frameMs / 1000); // Frame start time in seconds

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
  minDurSec = VAD_NORMALIZATION_MIN_DURATION_SEC, // Use constant as default
}: {
  intervals: Array<{ start: number; end: number }>;
  minGapSec?: number;
  minDurSec?: number;
}) {
  intervals.sort((a, b) => a.start - b.start);
  const merged: typeof intervals = [];
  for (const cur of intervals) {
    const last = merged.at(-1);
    if (last && cur.start - last.end < minGapSec) last.end = cur.end;
    else merged.push({ ...cur });
  }
  return merged.filter(i => i.end - i.start >= minDurSec);
}

export function chunkSpeechInterval({
  interval,
  duration,
}: {
  interval: { start: number; end: number };
  duration: number;
}): Array<{ start: number; end: number }> {
  const span = interval.end - interval.start;
  if (span <= MAX_CHUNK_DURATION_SEC) {
    // Use constant
    return [
      {
        start: Math.max(0, interval.start),
        end: Math.min(duration, interval.end),
      },
    ];
  }
  // recursively split at mid‑point (cheap), or call a stronger‑pause finder
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

export function pruneSegments({
  segments,
  minDurSec = PRUNING_MIN_DURATION_SEC, // Use constant as default
  minWords = PRUNING_MIN_WORDS, // Use constant as default
}: {
  segments: SrtSegment[];
  minDurSec?: number;
  minWords?: number;
}) {
  return segments.filter(seg => {
    const dur = seg.end - seg.start;
    // Handle potential NaN or infinite values from bad timestamps
    if (!Number.isFinite(dur) || dur < 0) {
      log.warn(`Pruning segment ${seg.index} due to invalid duration: ${dur}`);
      return false;
    }

    const wordCount = seg.text.trim().split(/\s+/).filter(Boolean).length; // Ensure empty strings aren't counted

    // Basic duration and word count check
    const meetsBasicCriteria = dur >= minDurSec && wordCount >= minWords;
    // Log why something is pruned (optional but helpful)
    // if (!meetsBasicCriteria) {
    //   log.debug(`Pruning segment ${seg.index}: duration=${dur.toFixed(2)}s (min=${minDurSec}), words=${wordCount} (min=${minWords})`);
    // }
    return meetsBasicCriteria;
  });
}

export function mergeCloseSegments({
  segments,
  maxGap = 0.2,
}: {
  segments: SrtSegment[];
  maxGap?: number;
}) {
  const out: SrtSegment[] = [];
  for (const cur of segments) {
    const prev = out.at(-1);
    if (prev && cur.start - prev.end < maxGap) {
      prev.end = cur.end;
      prev.text = `${prev.text} ${cur.text}`.trim();
    } else out.push({ ...cur });
  }
  return out;
}

function calculateOverlapDuration(
  segment: { start: number; end: number },
  intervals: Array<{ start: number; end: number }>
): number {
  let totalOverlap = 0;
  for (const interval of intervals) {
    const overlapStart = Math.max(segment.start, interval.start);
    const overlapEnd = Math.min(segment.end, interval.end);
    const duration = overlapEnd - overlapStart;
    if (duration > 0) {
      totalOverlap += duration;
    }
  }
  return totalOverlap;
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

function splitLongInterval(
  interval: { start: number; end: number },
  rawIntervals: ReadonlyArray<{ start: number; end: number }>, // Use readonly for safety
  maxDuration: number
): Array<{ start: number; end: number }> {
  const duration = interval.end - interval.start;
  if (duration <= maxDuration) {
    return [interval];
  }

  // Find raw intervals fully contained within the current interval
  const relevantRawIntervals = rawIntervals.filter(
    raw => raw.start >= interval.start && raw.end <= interval.end
  );

  if (relevantRawIntervals.length < 2) {
    // Cannot find internal silence, split at midpoint (fallback)
    const midPoint = interval.start + duration / 2;
    // Avoid zero-duration splits if possible, adjust slightly
    const splitPoint =
      midPoint > interval.start && midPoint < interval.end
        ? midPoint
        : interval.start + maxDuration;
    if (splitPoint <= interval.start || splitPoint >= interval.end) {
      // Fallback failed, return original interval to prevent infinite loop
      console.warn(
        `Could not split interval ${interval.start}-${interval.end}, keeping original.`
      );
      return [interval];
    }

    return [
      ...splitLongInterval(
        { start: interval.start, end: splitPoint },
        rawIntervals,
        maxDuration
      ),
      ...splitLongInterval(
        { start: splitPoint, end: interval.end },
        rawIntervals,
        maxDuration
      ),
    ];
  }

  // Find the largest gap between relevant raw intervals
  let largestGap = 0;
  let splitPoint = interval.start + duration / 2; // Default split point if no gap found

  for (let i = 0; i < relevantRawIntervals.length - 1; i++) {
    const gap = relevantRawIntervals[i + 1].start - relevantRawIntervals[i].end;
    if (gap > largestGap) {
      largestGap = gap;
      // Split in the middle of the largest gap
      splitPoint = relevantRawIntervals[i].end + gap / 2;
    }
  }

  // Ensure splitPoint is valid and within bounds
  if (splitPoint <= interval.start || splitPoint >= interval.end) {
    // If splitPoint calculation failed or resulted in boundary, use midpoint fallback
    splitPoint = interval.start + duration / 2;
    if (splitPoint <= interval.start || splitPoint >= interval.end) {
      console.warn(
        `Could not find valid split point for interval ${interval.start}-${interval.end}, keeping original.`
      );
      return [interval];
    }
  }

  // Recursively split
  return [
    ...splitLongInterval(
      { start: interval.start, end: splitPoint },
      rawIntervals,
      maxDuration
    ),
    ...splitLongInterval(
      { start: splitPoint, end: interval.end },
      rawIntervals,
      maxDuration
    ),
  ];
}
