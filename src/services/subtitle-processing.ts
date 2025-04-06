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
import log from 'electron-log';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { FileManager } from './file-manager.js';

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
          current: p.current,
          total: p.total,
          error: p.error,
        });
      },
      signal,
      operationId,
      services,
    });

    // --- Add Log: Raw subtitlesContent ---
    log.debug(
      `[${operationId}] Raw subtitlesContent from generateSubtitlesFromAudio:\\n${subtitlesContent.substring(0, 500)}...`
    );
    // --- End Log ---

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
    // --- Add Log: After parseSrt ---
    log.debug(
      `[${operationId}] Segments after parseSrt (${segmentsInProcess.length} segments):`,
      JSON.stringify(segmentsInProcess.slice(0, 5), null, 2)
    );
    // --- End Log ---

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
      const anthropicApiKey = await getApiKey('anthropic');
      const translatedBatch = await translateBatch({
        batch: {
          segments: currentBatchOriginals.map(seg => ({ ...seg })),
          startIndex: batchStart,
          endIndex: batchEnd,
        },
        targetLang,
        anthropicApiKey,
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

    // --- Add Log: After Translation Loop ---
    log.debug(
      `[${operationId}] Segments after translation loop (${segmentsInProcess.length} segments):`,
      JSON.stringify(segmentsInProcess.slice(0, 5), null, 2)
    );
    // --- End Log ---

    const REVIEW_BATCH_SIZE = 20;
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
          allSegments: segmentsInProcess,
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

    // --- Add Log 1: After Review Loop ---
    log.debug(
      `[${operationId}] Segments after review loop (${segmentsInProcess.length} segments):`,
      JSON.stringify(segmentsInProcess.slice(0, 5), null, 2) // Log first 5 segments for brevity
    );
    // --- End Log 1 ---

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

    // --- Add Log 2: After fillBlankTranslations ---
    log.debug(
      `[${operationId}] Segments after fillBlankTranslations (${finalSegments.length} segments):`,
      JSON.stringify(finalSegments.slice(0, 5), null, 2) // Log first 5 segments for brevity
    );
    // --- End Log 2 ---

    const finalSubtitlesContent = buildSrt(finalSegments);

    await fileManager.writeTempFile(finalSubtitlesContent, '.srt');
    progressCallback?.({
      percent: STAGE_FINALIZING.end,
      stage: 'Translation and review complete',
      partialResult: finalSubtitlesContent,
    });

    log.info('--------------------------------');
    log.info('finalSubtitlesContent/gottttt hererereer', finalSubtitlesContent);
    log.info('--------------------------------');

    return { subtitles: finalSubtitlesContent };
  } catch (error) {
    console.error(`[${operationId}] Error during subtitle generation:`, error);
    progressCallback?.({
      percent: 100,
      stage: `Error: ${error instanceof Error ? error.message : String(error)}`,
    });
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
  // --- Place your constants here so both the main and helper function can read them:
  const PROGRESS_ANALYSIS_DONE = 5;
  const PROGRESS_CHUNKING_DONE = 15;
  const PROGRESS_TRANSCRIPTION_START = 20;
  const PROGRESS_TRANSCRIPTION_END = 95;
  const PROGRESS_FINALIZING = 100;
  const TARGET_CHUNK_DURATION_SEC = 600;

  let openai: OpenAI;
  const overallSegments: SrtSegment[] = [];
  const createdChunks: string[] = [];
  const tempDir = path.dirname(inputAudioPath);

  try {
    try {
      // 1. Retrieve OpenAI API key
      const openaiApiKey = await getApiKey('openai');
      openai = new OpenAI({ apiKey: openaiApiKey });
    } catch (keyError) {
      const message =
        keyError instanceof Error ? keyError.message : String(keyError);
      progressCallback?.({ percent: 0, stage: 'Error', error: message });
      throw new SubtitleProcessingError(message);
    }

    // 2. Basic file checks
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

    // 4. Determine how many chunks we need
    const totalChunks = Math.max(
      1,
      Math.ceil(duration / TARGET_CHUNK_DURATION_SEC)
    );
    progressCallback?.({
      percent: PROGRESS_CHUNKING_DONE,
      stage: `Preparing ${totalChunks} audio chunks...`,
    });

    // 5. Loop through chunks and queue transcription tasks
    const chunkTranscriptionPromises: Promise<SrtSegment[]>[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startTime = i * TARGET_CHUNK_DURATION_SEC;
      const chunkDuration = Math.min(
        TARGET_CHUNK_DURATION_SEC,
        duration - startTime
      );
      if (chunkDuration <= 0) continue;

      const chunkIndex = i + 1;
      const chunkPath = path.join(
        tempDir,
        `chunk_${operationId}_${chunkIndex}.mp3`
      );
      createdChunks.push(chunkPath);

      // Extract the chunk from the main audio
      await ffmpegService.extractAudioSegment({
        inputPath: inputAudioPath,
        outputPath: chunkPath,
        startTime,
        duration: chunkDuration,
      });

      // 6. Push a separate transcription task for each chunk
      const transcriptionTask = transcribeChunk({
        i,
        totalChunks,
        chunkIndex,
        chunkPath,
        startTime,
        progressCallback,
      });

      chunkTranscriptionPromises.push(transcriptionTask);
    }

    // 7. Wait for all chunk transcriptions to complete
    const results = await Promise.allSettled(chunkTranscriptionPromises);
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value.length > 0) {
        overallSegments.push(...res.value);
      } else if (res.status === 'rejected') {
        console.error(
          `[${operationId}] Chunk ${idx + 1} transcription failed:`,
          res.reason
        );
      } else if (res.status === 'fulfilled' && res.value.length === 0) {
        console.warn(
          `[${operationId}] Chunk ${idx + 1} returned no segments (error or empty).`
        );
      }
    });

    // 8. Sort and re-index the final segments
    overallSegments.sort((a, b) => a.start - b.start);
    overallSegments.forEach((seg, idx) => {
      seg.index = idx + 1;
    });

    progressCallback?.({
      percent: PROGRESS_TRANSCRIPTION_END,
      stage: `Finalizing ${overallSegments.length} subtitle segments...`,
    });

    // 9. Build the final SRT file content
    const finalSrtContent = buildSrt(overallSegments);

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
    // 10. Cleanup: delete all created chunks
    const deletionTasks = createdChunks.map(chunkPath =>
      fsp
        .unlink(chunkPath)
        .catch(err =>
          console.warn(
            `[${operationId}] Failed to delete chunk ${chunkPath}:`,
            err
          )
        )
    );
    await Promise.allSettled(deletionTasks);
    console.info(`[${operationId}] Finished cleaning up chunk files.`);
  }

  async function transcribeChunk({
    i,
    totalChunks,
    chunkIndex,
    chunkPath,
    startTime,
    progressCallback,
  }: {
    i: number;
    totalChunks: number;
    chunkIndex: number;
    chunkPath: string;
    startTime: number;
    progressCallback?: (info: {
      percent: number;
      stage: string;
      current?: number;
      total?: number;
      error?: string;
    }) => void;
  }): Promise<SrtSegment[]> {
    const progressBeforeApiCall =
      PROGRESS_TRANSCRIPTION_START +
      (i / totalChunks) *
        (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

    progressCallback?.({
      percent: progressBeforeApiCall,
      stage: `Sending audio chunk ${chunkIndex}/${totalChunks} to AI...`,
      current: chunkIndex,
      total: totalChunks,
    });

    try {
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
        { signal }
      );

      console.info(
        `[${operationId}] Received transcription for chunk ${chunkIndex}.`
      );
      const srtContent = response as unknown as string;
      const segments =
        srtContent && typeof srtContent === 'string'
          ? parseSrt(srtContent)
          : [];

      // Offset each chunk's timestamps by `startTime`
      segments.forEach(segment => {
        segment.start += startTime;
        segment.end += startTime;
      });

      const progressAfterApiCall =
        PROGRESS_TRANSCRIPTION_START +
        ((i + 0.8) / totalChunks) *
          (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START);

      progressCallback?.({
        percent: progressAfterApiCall,
        stage: `Transcribed chunk ${chunkIndex}/${totalChunks}`,
        current: chunkIndex,
        total: totalChunks,
      });

      return segments;
    } catch (error: any) {
      console.error(
        `[${operationId}] Error transcribing chunk ${chunkIndex}:`,
        error.name,
        error.message
      );

      progressCallback?.({
        percent:
          PROGRESS_TRANSCRIPTION_START +
          ((i + 0.9) / totalChunks) *
            (PROGRESS_TRANSCRIPTION_END - PROGRESS_TRANSCRIPTION_START),
        stage: `Error transcribing chunk ${chunkIndex}/${totalChunks}`,
        error: `Chunk ${chunkIndex} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        current: chunkIndex,
        total: totalChunks,
      });
      return [];
    }
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
      progressCallback
    );

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
    try {
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
        // Ensure cancellation propagates
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
      // Ensure cancellation propagates
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
