import path from 'path';
import { FFmpegService } from './ffmpeg-service.js';
import { parseSrt, buildSrt } from '../shared/helpers/index.js';
import fs from 'fs';
import fsp from 'fs/promises';
import * as keytar from 'keytar';
import { AI_MODELS } from '../shared/constants/index.js';
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  SrtSegment,
} from '../types/interface.js';
import { cancellationService } from './cancellation-service.js';
import log from 'electron-log';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

import { MergeSubtitlesOptions } from '../types/interface.js';
import { FileManager } from './file-manager.js';

// Define the type for the arguments object
interface GenerateSubtitlesArgs {
  options: GenerateSubtitlesOptions;
  operationId: string;
  signal: AbortSignal; // Signal remains required
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
    batchStartIndex?: number;
  }) => void;
  services?: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  };
}

// Define the type for the arguments object for translateBatch
interface TranslateBatchArgs {
  batch: { segments: any[]; startIndex: number; endIndex: number };
  targetLang: string;
  anthropicApiKey: string;
  operationId: string;
  signal?: AbortSignal; // Keep signal optional as before for this function
}

const KEYTAR_SERVICE_NAME = 'TranslatorApp';

async function getApiKey(keyType: 'openai' | 'anthropic'): Promise<string> {
  const key = await keytar.getPassword(KEYTAR_SERVICE_NAME, keyType);
  if (!key) {
    throw new SubtitleProcessingError(
      `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} API key not found. Please set it in the application settings.`
    );
  }
  return key;
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

async function generateSubtitlesFromAudio({
  inputAudioPath,
  progressCallback,
  signal,
  operationId,
}: {
  inputAudioPath: string;
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
  }) => void;
  signal: AbortSignal;
  operationId?: string;
}): Promise<string> {
  let openai: OpenAI;
  try {
    const openaiApiKey = await getApiKey('openai');
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    progressCallback?.({
      percent: 0,
      stage: 'Error',
      error: keyError instanceof Error ? keyError.message : String(keyError),
    });
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }
  const tempDir = path.dirname(inputAudioPath);
  const overallSrtSegments: SrtSegment[] = [];
  const createdChunkPaths: string[] = [];

  const ANALYSIS_PROGRESS = 5;
  const CHUNKING_PROGRESS = 15;
  const TRANSCRIPTION_START_PROGRESS = 20;
  const TRANSCRIPTION_END_PROGRESS = 95;
  const FINALIZING_PROGRESS = 100;

  try {
    if (!fs.existsSync(inputAudioPath)) {
      throw new SubtitleProcessingError(
        `Audio file not found: ${inputAudioPath}`
      );
    }

    progressCallback?.({ percent: 0, stage: 'Analyzing audio file...' });

    const ffmpegService = new FFmpegService();
    const duration = await ffmpegService.getMediaDuration(inputAudioPath);
    if (isNaN(duration) || duration <= 0) {
      throw new SubtitleProcessingError(
        'Could not determine valid audio duration.'
      );
    }
    progressCallback?.({ percent: ANALYSIS_PROGRESS, stage: 'Audio analyzed' });

    const TARGET_CHUNK_DURATION_SECONDS = 10 * 60;
    const numChunks = Math.max(
      1,
      Math.ceil(duration / TARGET_CHUNK_DURATION_SECONDS)
    );
    progressCallback?.({
      percent: CHUNKING_PROGRESS,
      stage: `Preparing ${numChunks} audio chunks...`,
    });

    const chunkProcessingPromises: Promise<SrtSegment[]>[] = [];

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * TARGET_CHUNK_DURATION_SECONDS;
      const currentChunkDuration = Math.min(
        TARGET_CHUNK_DURATION_SECONDS,
        duration - startTime
      );
      const chunkIndex = i + 1;

      if (currentChunkDuration <= 0) continue;

      const chunkPath = path.join(
        tempDir,
        `chunk_${operationId}_${chunkIndex}.mp3`
      );
      createdChunkPaths.push(chunkPath);

      await ffmpegService.extractAudioSegment(
        inputAudioPath,
        chunkPath,
        startTime,
        currentChunkDuration
      );

      chunkProcessingPromises.push(
        (async () => {
          const progressBeforeApiCall =
            TRANSCRIPTION_START_PROGRESS +
            (i / numChunks) *
              (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS);
          progressCallback?.({
            percent: progressBeforeApiCall,
            stage: `Sending audio chunk ${chunkIndex}/${numChunks} to AI...`,
            current: chunkIndex,
            total: numChunks,
          });

          try {
            // --- Add explicit check before API call --- START ---
            if (signal.aborted) {
              console.info(
                `[${operationId}] Transcription chunk ${chunkIndex} cancelled just before API call.`
              );
              throw new Error('Operation cancelled');
            }
            // --- Add explicit check before API call --- END ---

            console.info(
              `[${operationId}] Sending chunk ${chunkIndex} to OpenAI Whisper API.`
            );
            const fileStream = createFileFromPath(chunkPath);

            const response = await openai.audio.transcriptions.create(
              {
                model: AI_MODELS.WHISPER.id,
                file: fileStream,
                response_format: 'srt',
              },
              { signal } // Pass signal to OpenAI API
            );

            console.info(
              `[${operationId}] Received transcription for chunk ${chunkIndex}.`
            );

            const srtContent = response as unknown as string;
            let chunkSegments: SrtSegment[] = [];
            if (srtContent && typeof srtContent === 'string') {
              chunkSegments = parseSrt(srtContent);
            } else {
              console.warn(
                `[${operationId}] Received unexpected non-SRT response for chunk ${chunkIndex}:`,
                response
              );
            }

            chunkSegments.forEach(segment => {
              segment.start += startTime;
              segment.end += startTime;
            });

            const progressAfterApiCall =
              TRANSCRIPTION_START_PROGRESS +
              ((i + 0.8) / numChunks) *
                (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS);
            progressCallback?.({
              percent: progressAfterApiCall,
              stage: `Transcribed chunk ${chunkIndex}/${numChunks}`,
              current: chunkIndex,
              total: numChunks,
            });

            return chunkSegments;
          } catch (error: any) {
            // <-- Add : any type for error
            console.error(
              `[${operationId}] Error transcribing chunk ${chunkIndex} (${chunkPath}):`,
              error.name,
              error.message
            );

            // --- Modify error handling for cancellation --- START ---
            if (error.name === 'AbortError' || signal.aborted) {
              console.info(
                `[${operationId}] Transcription chunk ${chunkIndex} detected cancellation signal/error.`
              );
              throw new Error('Operation cancelled'); // Ensure cancellation propagates
            }
            // --- Modify error handling for cancellation --- END ---

            // Existing progress update for non-cancellation errors
            progressCallback?.({
              percent:
                TRANSCRIPTION_START_PROGRESS +
                ((i + 0.9) / numChunks) *
                  (TRANSCRIPTION_END_PROGRESS - TRANSCRIPTION_START_PROGRESS),
              stage: `Error transcribing chunk ${chunkIndex}/${numChunks}`,
              error: `Chunk ${chunkIndex} failed: ${error instanceof Error ? error.message : String(error)}`,
              current: chunkIndex,
              total: numChunks,
            });
            return []; // Return empty for this failed chunk
          }
        })()
      );
    }

    const results = await Promise.allSettled(chunkProcessingPromises);

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        overallSrtSegments.push(...result.value);
      } else if (result.status === 'rejected') {
        console.error(
          `[${operationId}] Promise for chunk ${index + 1} rejected:`,
          result.reason
        );
      } else if (result.status === 'fulfilled' && result.value.length === 0) {
        console.warn(
          `[${operationId}] Chunk ${index + 1} processing returned no segments (potentially due to an error).`
        );
      }
    });

    overallSrtSegments.sort((a, b) => a.start - b.start);

    overallSrtSegments.forEach((segment, index) => {
      segment.index = index + 1;
    });

    progressCallback?.({
      percent: TRANSCRIPTION_END_PROGRESS,
      stage: `Finalizing ${overallSrtSegments.length} subtitle segments...`,
    });

    const finalSrtContent = buildSrt(overallSrtSegments);

    progressCallback?.({
      percent: FINALIZING_PROGRESS,
      stage: 'Transcription complete!',
    });
    return finalSrtContent;
  } catch (error) {
    console.error(
      `[${operationId}] Error in generateSubtitlesFromAudio:`,
      error
    );
    progressCallback?.({
      percent: 100,
      stage: 'Error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error instanceof SubtitleProcessingError
      ? error
      : new SubtitleProcessingError(
          error instanceof Error ? error.message : String(error)
        );
  } finally {
    const cleanupPromises = createdChunkPaths.map(chunkPath =>
      fsp
        .unlink(chunkPath)
        .catch(err =>
          console.warn(
            `[${operationId}] Failed to delete chunk ${chunkPath}:`,
            err
          )
        )
    );
    await Promise.allSettled(cleanupPromises);
    console.info(`[${operationId}] Chunk cleanup finished.`);
  }
}

export async function generateSubtitlesFromVideo({
  options,
  operationId,
  signal,
  progressCallback,
  services,
}: GenerateSubtitlesArgs): Promise<GenerateSubtitlesResult> {
  // Basic parameter checks
  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  // Check if services are provided - use a default or throw if essential and missing
  const effectiveServices = services || {
    ffmpegService: new FFmpegService(),
    fileManager: new FileManager(),
  }; // Example: Create new if not provided
  if (!effectiveServices?.ffmpegService || !effectiveServices?.fileManager) {
    throw new SubtitleProcessingError(
      'Required services (ffmpegService, fileManager) not provided'
    );
  }

  const { ffmpegService, fileManager } = effectiveServices; // Use the potentially defaulted services

  // Track whether translation is needed
  const targetLang = (options.targetLanguage || 'original').toLowerCase();
  const isTranslationNeeded = targetLang !== 'original';

  // Define progress stages (approximate)
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

  /**
   * Scales a sub-progress percent to the global progress range.
   */
  function scaleProgress(
    percent: number,
    stage: {
      start: number;
      end: number;
    }
  ) {
    const stageSpan = stage.end - stage.start;
    return Math.round(stage.start + (percent / 100) * stageSpan);
  }

  let audioPath = null;

  try {
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    progressCallback?.({
      percent: STAGE_AUDIO_EXTRACTION.start,
      stage: 'Starting subtitle generation',
    });

    // --- Wrap audio extraction in try/catch and pass signal --- START ---
    try {
      audioPath = await ffmpegService.extractAudio(
        options.videoPath,
        extractionProgress => {
          progressCallback?.({
            percent:
              STAGE_AUDIO_EXTRACTION.start +
              (extractionProgress.percent / 100) *
                (STAGE_AUDIO_EXTRACTION.end - STAGE_AUDIO_EXTRACTION.start),
            stage: extractionProgress.stage,
          });
        },
        operationId,
        signal // <-- Pass the signal
      );
    } catch (extractionError: any) {
      if (
        extractionError.name === 'AbortError' ||
        (extractionError instanceof Error &&
          extractionError.message === 'Operation cancelled') ||
        signal.aborted
      ) {
        console.info(`[${operationId}] Audio extraction cancelled.`);
        throw new Error('Operation cancelled'); // Propagate cancellation
      } else {
        // Handle other extraction errors
        console.error(
          `[${operationId}] Error during audio extraction:`,
          extractionError
        );
        // You might want to customize the error message thrown here
        throw new Error(
          `Audio extraction failed: ${extractionError.message || extractionError}`
        );
      }
    }
    // --- Wrap audio extraction in try/catch and pass signal --- END ---

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    // 2) Generate subtitles from audio (transcription)
    const subtitlesContent = await generateSubtitlesFromAudio({
      inputAudioPath: audioPath,
      progressCallback: progress => {
        progressCallback?.({
          percent: scaleProgress(progress.percent, STAGE_TRANSCRIPTION),
          stage: progress.stage,
          partialResult: progress.partialResult,
          current: progress.current,
          total: progress.total,
          error: progress.error,
        });
      },
      signal,
      operationId,
    });

    // Check for cancellation
    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    // If no translation is needed, finalize immediately
    if (!isTranslationNeeded) {
      await fileManager.writeTempFile(subtitlesContent, '.srt');
      progressCallback?.({
        percent: STAGE_FINALIZING.end,
        stage: 'Transcription complete',
        partialResult: subtitlesContent,
      });
      return { subtitles: subtitlesContent };
    }

    // 3) Translate in batches
    const segmentsInProcess = parseSrt(subtitlesContent);
    const totalSegments = segmentsInProcess.length;
    const TRANSLATION_BATCH_SIZE = 10;

    for (
      let batchStart = 0;
      batchStart < totalSegments;
      batchStart += TRANSLATION_BATCH_SIZE
    ) {
      // Check cancellation
      if (signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const batchEnd = Math.min(
        batchStart + TRANSLATION_BATCH_SIZE,
        totalSegments
      );
      const currentBatchOriginals = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );

      const anthropicApiKey = await getApiKey('anthropic');

      const translatedBatch = await translateBatch({
        batch: {
          segments: currentBatchOriginals.map((seg: SrtSegment) => ({
            ...seg,
          })),
          startIndex: batchStart,
          endIndex: batchEnd,
        },
        targetLang: targetLang,
        anthropicApiKey: anthropicApiKey,
        operationId: `${operationId}-trans-${batchStart}`,
        signal,
      });

      // Overwrite the segments
      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }

      // Progress callback
      const overallProgressPercent = (batchEnd / totalSegments) * 100;
      const cumulativeSrt = buildSrt(segmentsInProcess);

      progressCallback?.({
        percent: scaleProgress(overallProgressPercent, STAGE_TRANSLATION),
        stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(totalSegments / TRANSLATION_BATCH_SIZE)}`,
        partialResult: cumulativeSrt,
        current: batchEnd,
        total: totalSegments,
      });
    }

    // 4) Review in batches
    const REVIEW_BATCH_SIZE = 20;
    for (
      let batchStart = 0;
      batchStart < segmentsInProcess.length;
      batchStart += REVIEW_BATCH_SIZE
    ) {
      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }

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
          segments: currentBatchTranslated.map((seg: SrtSegment) => ({
            ...seg,
          })),
          startIndex: batchStart,
          endIndex: batchEnd,
          targetLang: targetLang,
          allSegments: segmentsInProcess,
        },
        signal,
        `${operationId}-review-${batchStart}`
      );

      // Overwrite the segments with reviewed content
      for (let i = 0; i < reviewedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = reviewedBatch[i];
      }

      // Progress callback
      const overallProgressPercent =
        (batchEnd / segmentsInProcess.length) * 100;
      const cumulativeReviewedSrt = buildSrt(segmentsInProcess);

      progressCallback?.({
        percent: scaleProgress(overallProgressPercent, STAGE_REVIEW),
        stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(segmentsInProcess.length / REVIEW_BATCH_SIZE)}`,
        partialResult: cumulativeReviewedSrt,
        current: batchEnd,
        total: segmentsInProcess.length,
        batchStartIndex: batchStart,
      });
    }

    if (signal?.aborted) {
      throw new Error('Operation cancelled');
    }

    // 5) Finalizing subtitles
    progressCallback?.({
      percent: STAGE_FINALIZING.start,
      stage: 'Finalizing subtitles',
    });

    // Re-index segments, fill short gaps, fill any blank translations
    const indexedSegments = segmentsInProcess.map(
      (block: SrtSegment, idx: number) => ({
        ...block,
        index: idx + 1,
      })
    );

    const gapFilledSegments = extendShortSubtitleGaps(indexedSegments, 3);
    const finalSegments = fillBlankTranslations(gapFilledSegments);

    const finalSubtitlesContent = buildSrt(finalSegments);
    await fileManager.writeTempFile(finalSubtitlesContent, '.srt');

    progressCallback?.({
      percent: STAGE_FINALIZING.end,
      stage: 'Translation and review complete',
      partialResult: finalSubtitlesContent,
    });

    return { subtitles: finalSubtitlesContent };
  } catch (error) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);
    progressCallback?.({
      percent: 100,
      stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
    });

    // Check if operation was actually cancelled
    if (
      signal?.aborted ||
      (error instanceof Error && error.message === 'Operation cancelled')
    ) {
      console.info(
        `[${operationId}] Generation was cancelled, returning empty subtitles.`
      );
      return { subtitles: '' }; // Indicate cancellation
    }

    throw error;
  } finally {
    // Unregister from the cancellation service
    cancellationService.unregisterOperation(operationId);

    // Cleanup temporary audio file
    if (audioPath) {
      try {
        await effectiveServices.fileManager.deleteFile(audioPath);
      } catch (cleanupError) {
        console.error(
          `Failed to delete temporary audio file ${audioPath}:`,
          cleanupError
        );
      }
    }
  }
}

export async function mergeSubtitlesWithVideo(
  options: MergeSubtitlesOptions,
  operationId: string,
  progressCallback?: (progress: { percent: number; stage: string }) => void,
  services?: {
    ffmpegService: FFmpegService;
  }
): Promise<{ outputPath: string }> {
  const { ffmpegService } = services || { ffmpegService: new FFmpegService() };
  log.info(`[${operationId}] mergeSubtitlesWithVideo called.`); // Use log.info

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
  if (!services?.ffmpegService) {
    throw new SubtitleProcessingError('FFmpeg service not provided');
  }

  // Check explicitly for false (cancelled) and not for undefined (never registered)
  if (cancellationService.isOperationActive(operationId) === false) {
    log.info(`[${operationId}] Operation was cancelled before merge started`);
    return { outputPath: '' }; // Return empty path to indicate cancellation
  }

  if (progressCallback) {
    progressCallback({ percent: 0, stage: 'Starting subtitle merging' });
  }

  const videoExt = path.extname(inputPathForNaming);
  const baseName = path.basename(inputPathForNaming, videoExt);
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles.mp4`;
  const outputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  if (progressCallback) {
    progressCallback({ percent: 25, stage: 'Processing video' });
  }

  log.info(
    `[${operationId}] Target temporary output path (forced MP4): ${outputPath}`
  );

  try {
    log.info(
      `[${operationId}] Calling ffmpegService.mergeSubtitles with video: ${options.videoPath}, subtitles: ${options.subtitlesPath}, output: ${outputPath}`
    );
    const mergeResult = await ffmpegService.mergeSubtitles(
      options.videoPath!,
      options.subtitlesPath!,
      outputPath,
      operationId,
      options.fontSize,
      options.stylePreset,
      progress => {
        if (progressCallback) {
          progressCallback(progress);
        }
      }
    );

    // Check explicitly for false (cancelled) and not for undefined (never registered)
    if (cancellationService.isOperationActive(operationId) === false) {
      log.info(`[${operationId}] Operation was cancelled during merge`);
      if (progressCallback) {
        progressCallback({ percent: 100, stage: 'Merge cancelled' });
      }
      return { outputPath: '' };
    }

    // Check if file exists - if empty string was returned, it means the operation was cancelled
    if (!mergeResult || mergeResult === '' || !fs.existsSync(outputPath)) {
      log.info(
        `[${operationId}] Merge operation was cancelled or failed to create output file`
      );
      if (progressCallback) {
        progressCallback({ percent: 100, stage: 'Merge cancelled' });
      }
      return { outputPath: '' }; // Return empty path to indicate cancellation
    }

    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: 'Merge complete',
      });
    }
    return { outputPath };
  } catch (error) {
    log.error(`[${operationId}] Error during merge:`, error);
    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Check explicitly for false (cancelled) and not for undefined (never registered)
    if (cancellationService.isOperationActive(operationId) === false) {
      log.info(`[${operationId}] Merge was cancelled, returning empty path`);
      return { outputPath: '' }; // Empty path indicates cancellation
    }

    throw error; // Re-throw if it was a genuine error
  }
}

async function translateBatch({
  batch,
  targetLang,
  anthropicApiKey,
  operationId,
  signal,
}: TranslateBatchArgs): Promise<any[]> {
  log.info(
    `[${operationId}] Starting translation batch: ${batch.startIndex}-${batch.endIndex}`
  );
  // Check for early cancellation using both signal and cancellationService (explicitly checking for false)
  if (signal?.aborted) {
    // Log using the destructured operationId
    log.info(`[${operationId}] Translation batch cancelled before starting`);
    throw new Error('Operation cancelled');
  }

  let anthropic: Anthropic;
  try {
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

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
    // Check for cancellation before each retry attempt
    if (signal?.aborted) {
      log.info(
        `[${operationId}] Translation batch cancelled during retry check.`
      );
      throw new Error('Operation cancelled'); // Throw immediately if cancelled before attempt
    }

    try {
      // --- Add explicit check before API call --- START ---
      if (signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch cancelled just before API call.`
        );
        throw new Error('Operation cancelled');
      }
      // --- Add explicit check before API call --- END ---

      log.info(
        `[${operationId}] Sending translation batch (Attempt ${retryCount + 1})`
      ); // Add log
      const response = await anthropic.messages.create(
        {
          model: AI_MODELS.CLAUDE_3_7_SONNET,
          max_tokens: AI_MODELS.MAX_TOKENS,
          messages: [{ role: 'user', content: combinedPrompt }],
        } as Anthropic.MessageCreateParams,
        { signal } // Pass the signal to the API call
      );
      log.info(
        `[${operationId}] Received response for translation batch (Attempt ${retryCount + 1})`
      ); // Add log

      const translationResponse = response as Anthropic.Message;

      let translation = '';
      if (
        translationResponse.content &&
        translationResponse.content.length > 0 &&
        translationResponse.content[0].type === 'text'
      ) {
        translation = translationResponse.content[0].text;
      } else {
        throw new Error('Unexpected translation response format from Claude.');
      }

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
      ); // Log error name and message

      // --- Modify error handling for cancellation --- START ---
      // Check specifically for AbortError or cancellation signal
      if (err.name === 'AbortError' || signal?.aborted) {
        log.info(
          `[${operationId}] Translation batch detected cancellation signal/error.`
        );
        throw new Error('Operation cancelled'); // Ensure cancellation propagates
      }
      // --- Modify error handling for cancellation --- END ---

      // Existing retry logic for other errors
      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET')) &&
        retryCount < MAX_RETRIES - 1 // Check before incrementing
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        log.info(
          `[${operationId}] Retrying translation batch in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue; // Continue to the next retry iteration
      }

      // If it's another type of error or retries exhausted, fallback
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

  // This part is reached only if MAX_RETRIES is hit for retryable errors
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
    allSegments: SrtSegment[];
  },
  signal?: AbortSignal,
  parentOperationId: string = 'review-batch'
): Promise<any[]> {
  const operationId = `${parentOperationId}-review-${batch.startIndex}-${batch.endIndex}`;
  log.info(
    `[${operationId}] Starting review batch: ${batch.startIndex}-${batch.endIndex}`
  );
  // Check for early cancellation (explicitly checking for false)
  if (signal?.aborted) {
    log.info(`[Review] Review batch cancelled before starting`);
    throw new Error('Operation cancelled');
  }

  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  // Get enhanced context by including segments before and after the current batch
  const CONTEXT_WINDOW_SIZE = 5; // Number of segments to include before and after

  // Get the full list of segments to determine the available context
  const allSegments = batch.allSegments;
  const totalAvailableSegments = allSegments.length;

  // Determine the actual context boundaries (preventing out-of-bounds access)
  const contextStartIndex = Math.max(0, batch.startIndex - CONTEXT_WINDOW_SIZE);
  const contextEndIndex = Math.min(
    batch.startIndex + batch.segments.length + CONTEXT_WINDOW_SIZE,
    totalAvailableSegments + batch.startIndex
  );

  // Create a map of all batch items including context
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
        // Flag whether this is part of the actual batch (vs. just context)
        isPartOfBatch: true,
      };
    }
  );

  // Only render the actual batch items for output
  const originalTexts = batchItemsWithContext
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItemsWithContext
    .map(item => `[${item.index}] ${item.translation}`)
    .join('\n');

  // Create enhanced context with segments before and after
  const contextBlocks = [];

  // Add previous context if available
  for (let i = contextStartIndex; i < batch.startIndex; i++) {
    if (i >= 0 && i < allSegments.length) {
      const [original, translation] = allSegments[i].text.split(
        '###TRANSLATION_MARKER###'
      );
      contextBlocks.push({
        index: i + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
      });
    }
  }

  // Add segments after the batch as context
  for (let i = batch.endIndex; i < contextEndIndex; i++) {
    if (i >= 0 && i < allSegments.length) {
      const [original, translation] = allSegments[i].text.split(
        '###TRANSLATION_MARKER###'
      );
      contextBlocks.push({
        index: i + 1,
        original: original?.trim() || '',
        translation: (translation || original || '').trim(),
      });
    }
  }

  // Format the context for the prompt
  const contextOriginalTexts = contextBlocks
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const contextTranslatedTexts = contextBlocks
    .map(item => `[${item.index}] ${item.translation}`)
    .join('\n');

  const prompt = `
You are a professional subtitle translator and reviewer for ${batch.targetLang}.
Review and improve each translated subtitle block below **individually**.

**RULES:**
- Maintain the original order. **NEVER** merge or split blocks.
- For each block, provide the improved translation. Focus on accuracy, completeness, consistency, and context based on the original text.
- Preserve the sequence of information from the corresponding original text.
- **CRITICAL SYNC RULE:** If a block's content (e.g., 1-2 leftover words) logically belongs to the *previous* block's translation, leave the *current* block's translation **COMPLETELY BLANK**. Do not fill it with the *next* block's content.
- Ensure consistency in terminology and style across all blocks.
- Look at the surrounding context to ensure your translations maintain narrative coherence.

**SURROUNDING CONTEXT (DO NOT TRANSLATE THESE - FOR REFERENCE ONLY):**
**Original Context:**
${contextOriginalTexts}

**Translated Context:**
${contextTranslatedTexts}

**BLOCKS TO REVIEW (TRANSLATE ONLY THESE):**
**ORIGINAL TEXT (Context Only - DO NOT MODIFY):**
${originalTexts}

**TRANSLATION TO REVIEW & IMPROVE:**
${translatedTexts}

**Output Format:**
- Return **ONLY** the improved translation text for each block, one per line, in the **exact same order** as the input.
- **DO NOT** include the "[index]" prefixes in your output.
- If a line should be blank (per the SYNC RULE), output an empty line.

Example Output (for 3 blocks):
Improved translation for block 1

Improved translation for block 3
`;

  try {
    // --- Add explicit check before API call --- START ---
    if (signal?.aborted) {
      log.info(
        `[Review] Review batch (${parentOperationId}) cancelled just before API call`
      );
      throw new Error('Operation cancelled');
    }
    // --- Add explicit check before API call --- END ---

    log.info(
      `[Review] Sending review batch (${parentOperationId}) to Claude API`
    ); // Add log

    const response = await anthropic.messages.create(
      {
        model: AI_MODELS.CLAUDE_3_7_SONNET,
        max_tokens: AI_MODELS.MAX_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      } as Anthropic.MessageCreateParams,
      { signal } // Pass signal
    );
    log.info(
      `[Review] Received response for review batch (${parentOperationId})`
    ); // Add log

    const reviewResponse = response as Anthropic.Message;

    let reviewedContent = '';
    if (
      reviewResponse.content &&
      reviewResponse.content.length > 0 &&
      reviewResponse.content[0].type === 'text'
    ) {
      reviewedContent = reviewResponse.content[0].text;
    } else {
      log.warn(
        '[Review] Review response content was not in the expected format.'
      );
      log.warn(
        `[Review] Translation review output format unexpected. Using original translations for this batch.`
      );
      return batch.segments;
    }

    const reviewedLines = reviewedContent.split('\n');

    if (reviewedLines.length !== batch.segments.length) {
      log.warn(
        `[Review] Translation review output line count (${reviewedLines.length}) does not match batch size (${batch.segments.length}). Using original translations for this batch.`
      );
      return batch.segments;
    }

    return batch.segments.map((segment, idx) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      const reviewedTranslation = reviewedLines[idx]?.trim() ?? '';

      const finalTranslation =
        reviewedTranslation === '' ? '' : reviewedTranslation;

      return {
        ...segment,
        text: `${originalText}###TRANSLATION_MARKER###${finalTranslation}`,
        originalText: originalText,
        reviewedText: finalTranslation,
      };
    });
  } catch (error: any) {
    // <-- Add : any type for error
    log.error(
      `[Review] Error during review batch (${parentOperationId}):`,
      error.name,
      error.message
    ); // Log error details

    // --- Modify error handling for cancellation --- START ---
    // Check specifically for AbortError or cancellation signal
    if (error.name === 'AbortError' || signal?.aborted) {
      log.info(
        `[Review] Review batch (${parentOperationId}) detected cancellation signal/error.`
      );
      throw new Error('Operation cancelled'); // Ensure cancellation propagates
    }
    // --- Modify error handling for cancellation --- END ---

    // Fallback for non-cancellation errors
    log.error(
      `[Review] Unhandled error in reviewTranslationBatch (${parentOperationId}). Falling back to original batch segments.`
    );
    return batch.segments; // Return original segments on other errors
  }
}

// --- Helper Functions Restored --- START ---

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

// --- Helper Functions Restored --- END ---
