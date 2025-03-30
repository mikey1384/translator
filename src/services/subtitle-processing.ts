import path from 'path';
import log from 'electron-log';
import { FFmpegService } from './ffmpeg-service';
import { FileManager } from './file-manager';
import { parseSrt, buildSrt } from '../renderer/helpers/subtitle-utils';
import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import fs from 'fs';
import fsp from 'fs/promises';
import dotenv from 'dotenv';
import { AI_MODELS } from '../renderer/constants';

import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
} from '../types/interface';

dotenv.config();

const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || 'hardcoded_anthropic_key_fallback';
const OPENAI_API_KEY =
  process.env.OPENAI_API_KEY || 'hardcoded_openai_key_fallback';

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

try {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  log.info('Anthropic API client successfully initialized');

  openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  log.info('OpenAI API client successfully initialized');
} catch (error) {
  log.error('Error initializing API clients:', error);
  try {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    log.info(
      'API clients initialized with hardcoded keys after error recovery'
    );
  } catch (retryError) {
    log.error(
      'Failed to initialize API clients even with hardcoded keys:',
      retryError
    );
  }
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

// Helper: Create a readable stream from a file path
function createFileFromPath(filePath: string): fs.ReadStream {
  try {
    return fs.createReadStream(filePath);
  } catch (error) {
    log.error('Error creating file stream:', error);
    throw new SubtitleProcessingError(`Failed to create file stream: ${error}`);
  }
}

// Helper: Convert segments to SRT format
function convertSegmentsToSrt(segments: any[]): string {
  let srtContent = '';
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const index = i + 1;
    const startTime = formatSrtTimestamp(segment.start);
    const endTime = formatSrtTimestamp(segment.end);
    const text = segment.text.trim();
    srtContent += `${index}\n${startTime} --> ${endTime}\n${text}\n\n`;
  }
  return srtContent.trim();
}

// Helper: Format timestamp for SRT
function formatSrtTimestamp(seconds: number): string {
  const ms = Math.floor((seconds % 1) * 1000);
  let sec = Math.floor(seconds);
  let mins = Math.floor(sec / 60);
  sec %= 60;
  const hours = Math.floor(mins / 60);
  mins %= 60;
  return `${hours.toString().padStart(2, '0')}:${mins
    .toString()
    .padStart(2, '0')}:${sec.toString().padStart(2, '0')},${ms
    .toString()
    .padStart(3, '0')}`;
}

// Helper: Call Claude API with retry logic
async function callClaudeWithRetry(params: any, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort('Request timeout');
      }, 45000);

      const result = await anthropic!.messages.create(params, {
        signal: abortController.signal,
      });
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      lastError = error;
      const isRetriableError =
        (error as any).name === 'AbortError' ||
        ((error as any).status >= 500 && (error as any).status < 600) ||
        (error as Error).message?.includes('timeout') ||
        (error as Error).message?.includes('network') ||
        (error as Error).message?.includes('ECONNRESET');
      if (!isRetriableError) break;
      if (attempt < maxRetries - 1) {
        const backoffTime = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }
  throw (
    lastError ||
    new SubtitleProcessingError(
      'Failed to call Claude API after multiple retries'
    )
  );
}

// Function: translateBatch
async function translateBatch(
  batch: { segments: any[]; startIndex: number; endIndex: number },
  targetLang: string,
  callId: string
): Promise<any[]> {
  const MAX_RETRIES = 3;
  let retryCount = 0;
  const batchContextPrompt = batch.segments
    .map((segment, idx) => {
      const absoluteIndex = batch.startIndex + idx;
      return `Line ${absoluteIndex + 1}: ${segment.text}`;
    })
    .join('\n');

  const combinedPrompt = `
You are a professional subtitle translator. Translate the following subtitles to natural, fluent ${targetLang}.

Here are the subtitles to translate:
${batchContextPrompt}

Translate ALL lines to ${targetLang}.
Respond with ONLY the translations in this format:
Line 1: <translation>
Line 2: <translation>
...and so on for each line

Ensure you preserve the exact line numbers as given in the original text.
IMPORTANT: Do not modify any part of the original text except for performing the translation.
  `;

  while (retryCount < MAX_RETRIES) {
    try {
      log.info(
        `[${callId}] Attempting translation for batch ${batch.startIndex + 1}-${
          batch.endIndex
        }, attempt ${retryCount + 1}/${MAX_RETRIES}`
      );
      const batchTranslationResponse = await callClaudeWithRetry({
        model: AI_MODELS.CLAUDE_3_7_SONNET,
        max_tokens: AI_MODELS.MAX_TOKENS,
        system: `You are a professional subtitle translator. Translate the following subtitles from original to ${targetLang}. Maintain the original format and structure.`,
        messages: [{ role: 'user', content: combinedPrompt }],
      });

      const batchTranslation = batchTranslationResponse.content[0].text;
      const translationLines = batchTranslation
        .split('\n')
        .filter((line: string) => line.trim() !== '');
      const lineRegex = /^Line\s+(\d+):\s*(.+)$/;

      return batch.segments.map((segment, idx) => {
        const absoluteIndex = batch.startIndex + idx;
        let translatedText = segment.text;
        for (const line of translationLines) {
          const match = line.match(lineRegex);
          if (match && parseInt(match[1]) === absoluteIndex + 1) {
            translatedText = match[2].trim();
            break;
          }
        }
        return {
          ...segment,
          text: `${segment.text}###TRANSLATION_MARKER###${translatedText}`,
          originalText: segment.text,
          translatedText,
        };
      });
    } catch (err: any) {
      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET'))
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        log.warn(
          `[${callId}] Retryable error in batch ${batch.startIndex + 1}-${
            batch.endIndex
          }, attempt ${retryCount}/${MAX_RETRIES}, waiting ${delay}ms:`,
          err
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      log.error(
        `[${callId}] Non-retryable error in batch ${batch.startIndex + 1}-${
          batch.endIndex
        }:`,
        err
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
    `[${callId}] Failed to translate batch ${batch.startIndex + 1}-${
      batch.endIndex
    } after ${MAX_RETRIES} attempts, using fallback`
  );
  return batch.segments.map(segment => ({
    ...segment,
    text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
    originalText: segment.text,
    translatedText: segment.text,
  }));
}

// --- NEW HELPER: Retry with Exponential Backoff (for OpenAI) ---
async function retryWithExponentialBackoff<T>(
  asyncFn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: any = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await asyncFn();
    } catch (error) {
      lastError = error;
      const isRetriable =
        (error as any).status === 429 || // Rate limit
        (error as any).status >= 500 || // Server error
        (error as Error).message?.includes('timeout') ||
        (error as Error).message?.includes('network') ||
        (error as Error).message?.includes('ECONNRESET');

      if (!isRetriable || attempt === maxRetries - 1) {
        log.error(
          `[Retryable Error] Final attempt failed after ${attempt + 1} tries:`,
          error
        );
        throw error; // Rethrow after final attempt or if non-retriable
      }

      const backoffTime = initialDelay * Math.pow(2, attempt);
      log.warn(
        `[Retryable Error] Attempt ${
          attempt + 1
        } failed, retrying in ${backoffTime}ms:`,
        error
      );
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }
  // Should not be reached if maxRetries > 0, but satisfies TypeScript
  throw (
    lastError ||
    new SubtitleProcessingError(
      'Failed operation after multiple retries, but no error was captured.'
    )
  );
}

// --- REFACTORED FUNCTION: generateSubtitlesFromAudio ---
interface GenerateSubtitlesFromAudioOptions {
  inputAudioPath: string;
  targetLanguage?: string;
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string; // Added for error reporting
  }) => void;
  progressRange?: { start: number; end: number };
}

async function generateSubtitlesFromAudio({
  inputAudioPath,
  targetLanguage = 'original',
  progressCallback,
  progressRange,
}: GenerateSubtitlesFromAudioOptions): Promise<string> {
  const callId = Date.now() + Math.random().toString(36).substring(2);
  log.info(
    `[${callId}] Starting audio transcription for: ${inputAudioPath}, Target Lang: ${targetLanguage}`
  );

  // --- Progress Scaling Setup ---
  const progressStart = progressRange?.start || 0;
  const progressEnd = progressRange?.end || 100;
  const progressSpan = progressEnd - progressStart;

  const scaleProgress = (originalProgress: number): number => {
    // Ensure progress stays within the allocated range
    const scaled = progressStart + (originalProgress / 100) * progressSpan;
    return Math.min(progressEnd, Math.max(progressStart, scaled));
  };

  // --- Initial Checks ---
  if (!fs.existsSync(inputAudioPath)) {
    throw new SubtitleProcessingError(
      `Audio file not found: ${inputAudioPath}`
    );
  }
  if (!openai) {
    throw new SubtitleProcessingError('OpenAI client not initialized');
  }

  // --- Constants and Initialization ---
  const ffmpegService = new FFmpegService();
  const fileSize = fs.statSync(inputAudioPath).size;
  const duration = await ffmpegService.getMediaDuration(inputAudioPath);
  // Keep the 20MB chunk size from original, example's 2MB might be too small/costly
  const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
  // Calculate chunk duration based on size and bitrate
  const bitrate = fileSize > 0 && duration > 0 ? fileSize / duration : 128000; // Assume 128kbps if calculation fails
  const chunkDurationSeconds = Math.max(10, CHUNK_SIZE_BYTES / bitrate); // Ensure minimum chunk duration
  const numChunks = Math.max(1, Math.ceil(duration / chunkDurationSeconds));

  log.info(
    `[${callId}] File size: ${fileSize}, Duration: ${duration}s, Bitrate: ${bitrate.toFixed(
      2
    )} B/s`
  );
  log.info(
    `[${callId}] Calculated chunk duration: ${chunkDurationSeconds.toFixed(
      2
    )}s, Number of chunks: ${numChunks}`
  );

  const allSegments: any[] = [];
  const tempDir = path.dirname(inputAudioPath);
  const chunkMetadata: { path: string; start: number; duration: number }[] = [];
  const TRANSCRIPTION_BATCH_SIZE = 3; // Process 3 chunks concurrently
  const INTER_CHUNK_TRANSCRIPTION_DELAY = 1000; // 1s delay between starting transcriptions in a batch
  const INTER_BATCH_DELAY = 3000; // 3s delay between batches

  // --- Report Initial Progress ---
  progressCallback?.({
    percent: scaleProgress(0),
    stage: 'Starting transcription',
    total: numChunks,
  });

  // --- Main Logic ---
  try {
    // 1. Prepare chunk metadata and extract audio segments sequentially
    progressCallback?.({
      percent: scaleProgress(5), // Changed from 10% to 5% as extraction is part of prep
      stage: 'Preparing audio chunks',
      total: numChunks,
    });

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * chunkDurationSeconds;
      // Use a more specific chunk name
      const chunkPath = path.join(
        tempDir,
        `chunk_${callId}_${i + 1}_of_${numChunks}.mp3`
      );
      const currentChunkDuration =
        i === numChunks - 1 ? duration - startTime : chunkDurationSeconds; // Last chunk might be shorter

      log.info(
        `[${callId}] Preparing chunk ${i + 1}/${numChunks}: ${chunkPath} (Start: ${startTime.toFixed(
          2
        )}s, Duration: ${currentChunkDuration.toFixed(2)}s)`
      );

      // Extract segment using ffmpeg
      // Note: Running multiple ffmpeg instances concurrently can be heavy.
      // Consider sequential extraction if performance issues arise.
      await ffmpegService.extractAudioSegment(
        inputAudioPath,
        chunkPath,
        startTime,
        currentChunkDuration // Use actual duration for extraction
      );

      // Check if file exists and has size > 0 after extraction
      try {
        const stats = await fsp.stat(chunkPath);
        if (stats.size === 0) {
          log.warn(`[${callId}] Chunk ${i + 1} is empty, skipping.`);
          await fsp.unlink(chunkPath); // Clean up empty file
          continue; // Skip this chunk
        }
      } catch (statError) {
        log.warn(
          `[${callId}] Could not stat chunk ${
            i + 1
          } after extraction, skipping: ${statError}`
        );
        continue; // Skip if file doesn't exist or other error
      }

      chunkMetadata.push({
        path: chunkPath,
        start: startTime,
        duration: currentChunkDuration,
      });

      // Update progress slightly during preparation phase
      const prepProgress = 5 + ((i + 1) / numChunks) * 5; // Allocate 5% for prep (5% to 10%)
      progressCallback?.({
        percent: scaleProgress(prepProgress),
        stage: `Prepared chunk ${i + 1} of ${numChunks}`,
        current: i + 1,
        total: numChunks,
      });
    }

    log.info(
      `[${callId}] Finished preparing ${chunkMetadata.length} non-empty chunks.`
    );
    if (chunkMetadata.length === 0 && numChunks > 0) {
      throw new SubtitleProcessingError(
        'All audio chunks were empty or failed extraction.'
      );
    }

    // 2. Transcribe chunks in batches
    progressCallback?.({
      percent: scaleProgress(10),
      stage: 'Starting batch transcription',
      total: chunkMetadata.length,
    });

    let transcriptionProgress = 10;
    const progressPerChunk =
      chunkMetadata.length > 0 ? 75 / chunkMetadata.length : 0;

    for (
      let batchStart = 0;
      batchStart < chunkMetadata.length;
      batchStart += TRANSCRIPTION_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + TRANSCRIPTION_BATCH_SIZE,
        chunkMetadata.length
      );
      const batchChunks = chunkMetadata.slice(batchStart, batchEnd);
      const currentBatchNumber =
        Math.floor(batchStart / TRANSCRIPTION_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(
        chunkMetadata.length / TRANSCRIPTION_BATCH_SIZE
      );

      log.info(
        `[${callId}] Processing transcription batch ${currentBatchNumber}/${totalBatches} (Chunks ${
          batchStart + 1
        } to ${batchEnd})`
      );

      const batchResults = await Promise.all(
        batchChunks.map(async (meta, batchIndex) => {
          const overallChunkIndex = batchStart + batchIndex; // Index relative to all chunks

          // Add delay before starting transcription for subsequent chunks in the batch
          if (batchIndex > 0) {
            await new Promise(resolve =>
              setTimeout(resolve, INTER_CHUNK_TRANSCRIPTION_DELAY)
            );
          }

          log.info(
            `[${callId}] Transcribing chunk ${overallChunkIndex + 1}/${
              chunkMetadata.length
            } (Path: ${meta.path})`
          );
          try {
            const chunkResponse = await retryWithExponentialBackoff(
              async () => {
                const fileStream = createFileFromPath(meta.path);
                return await openai!.audio.transcriptions.create({
                  file: fileStream,
                  model: 'whisper-1',
                  response_format: 'verbose_json',
                  language:
                    targetLanguage === 'original' ? undefined : targetLanguage,
                });
              }
            );
            log.info(
              `[${callId}] Successfully transcribed chunk ${
                overallChunkIndex + 1
              }`
            );
            return {
              status: 'success',
              chunkResponse,
              chunkIndex: overallChunkIndex,
              chunkStartTime: meta.start,
              chunkPath: meta.path, // Include path for potential cleanup logging
            };
          } catch (transcriptionError) {
            log.error(
              `[${callId}] Failed to transcribe chunk ${overallChunkIndex + 1} (${meta.path}) after retries:`,
              transcriptionError
            );
            return {
              status: 'error',
              chunkIndex: overallChunkIndex,
              chunkPath: meta.path,
              error: transcriptionError,
            };
          }
        })
      );

      // Process batch results
      let partialSrtForBatch = '';
      for (const result of batchResults) {
        if (
          result.status === 'success' &&
          result.chunkResponse &&
          result.chunkStartTime !== undefined
        ) {
          const { chunkResponse, chunkIndex, chunkStartTime } = result;
          const chunkSegments = chunkResponse.segments || [];
          for (const segment of chunkSegments) {
            segment.start += chunkStartTime;
            segment.end += chunkStartTime;
          }
          allSegments.push(...chunkSegments);
          // Sort immediately after adding to maintain order for partial SRT
          allSegments.sort((a, b) => a.start - b.start);
          // Generate partial SRT after processing each successful chunk in the batch
          partialSrtForBatch = convertSegmentsToSrt(allSegments);

          // Update progress
          transcriptionProgress += progressPerChunk;
          progressCallback?.({
            percent: scaleProgress(transcriptionProgress),
            stage: `Transcribed chunk ${chunkIndex + 1} of ${
              chunkMetadata.length
            }`,
            current: chunkIndex + 1, // Use overall index
            total: chunkMetadata.length,
            partialResult: partialSrtForBatch, // Provide incremental result
          });
        } else {
          // Optionally report error for specific chunk, or just log it
          log.error(
            `[${callId}] Skipping segments for failed chunk ${result.chunkIndex + 1}`
          );
          progressCallback?.({
            percent: scaleProgress(transcriptionProgress), // Don't advance progress % for failed chunk
            stage: `Failed to transcribe chunk ${result.chunkIndex + 1}`,
            current: result.chunkIndex + 1,
            total: chunkMetadata.length,
            error: `Chunk ${result.chunkIndex + 1} failed.`,
            partialResult: partialSrtForBatch, // Show SRT up to the failure point
          });
        }
      }

      // Add delay between batches if not the last batch
      if (batchEnd < chunkMetadata.length) {
        log.info(
          `[${callId}] Waiting ${INTER_BATCH_DELAY}ms before next batch...`
        );
        await new Promise(resolve => setTimeout(resolve, INTER_BATCH_DELAY));
      }
    }

    // 3. Finalize and Cleanup
    progressCallback?.({
      percent: scaleProgress(85), // Transcription phase ends at 85%
      stage: 'Transcription complete, finalizing',
    });

    // Final sort just in case (though should be sorted already)
    allSegments.sort((a, b) => a.start - b.start);
    const finalSrt = convertSegmentsToSrt(allSegments);

    // Cleanup chunk files asynchronously
    log.info(
      `[${callId}] Starting cleanup of ${chunkMetadata.length} chunk files...`
    );
    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          await fsp.unlink(meta.path);
          log.debug(`[${callId}] Deleted chunk file: ${meta.path}`);
        } catch (err) {
          log.warn(
            `[${callId}] Failed to delete chunk file ${meta.path}:`,
            err
          );
        }
      })
    );
    log.info(`[${callId}] Chunk file cleanup finished.`);

    progressCallback?.({
      percent: scaleProgress(100),
      stage: 'Processing complete',
      partialResult: finalSrt, // Include final result
    });

    log.info(`[${callId}] Transcription completed successfully.`);
    return finalSrt;
  } catch (error: any) {
    log.error(`[${callId}] Error in generateSubtitlesFromAudio:`, error);

    // Attempt to clean up any remaining chunk files on error
    log.warn(`[${callId}] Attempting cleanup after error...`);
    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          // Check existence before unlinking after an error
          if (fs.existsSync(meta.path)) {
            await fsp.unlink(meta.path);
            log.debug(
              `[${callId}] Cleaned up chunk file after error: ${meta.path}`
            );
          }
        } catch (err) {
          log.warn(
            `[${callId}] Failed to delete chunk file ${meta.path} during error cleanup:`,
            err
          );
        }
      })
    );

    // Report error via progress callback
    progressCallback?.({
      percent: scaleProgress(0), // Reset progress or use last known good? Resetting is clearer.
      stage: 'Error during processing',
      error:
        error instanceof Error ? error.message : 'Unknown transcription error',
    });

    // Re-throw specific error type
    if (error instanceof SubtitleProcessingError) {
      throw error;
    } else {
      throw new SubtitleProcessingError(
        `Transcription failed: ${error.message || 'Unknown error'}`
      );
    }
  }
}

export async function generateSubtitlesFromVideo(
  options: GenerateSubtitlesOptions,
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    partialResult?: string;
    current?: number;
    total?: number;
    error?: string;
  }) => void,
  services?: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }
): Promise<GenerateSubtitlesResult> {
  const callId = Date.now() + Math.random().toString(36).substring(2);
  log.info(
    `Starting subtitle generation, callId: ${callId}, options:`,
    JSON.stringify(options, null, 2)
  );

  if (!options) {
    options = { targetLanguage: 'original' } as GenerateSubtitlesOptions;
  }
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!services?.ffmpegService || !services?.fileManager) {
    throw new SubtitleProcessingError('Required services not provided');
  }

  const { ffmpegService, fileManager } = services;

  if (progressCallback) {
    progressCallback({ percent: 0, stage: 'Starting subtitle generation' });
    progressCallback({ percent: 10, stage: 'Extracting audio from video' });
  }

  const audioPath = await ffmpegService.extractAudio(options.videoPath);
  log.info(`[${callId}] Audio extracted to: ${audioPath}`);

  log.info(`[${callId}] Starting audio transcription`);
  const subtitlesContent = await generateSubtitlesFromAudio({
    inputAudioPath: audioPath,
    targetLanguage: 'original',
    progressCallback: progress => {
      if (progressCallback) {
        // Calculate scaled percent based on the range allocated for transcription (e.g., 10% to 50%)
        const basePercent = 10;
        const transcriptionSpan = 40; // 50 - 10
        const scaledPercent =
          basePercent + (progress.percent / 100) * transcriptionSpan;
        progressCallback({
          percent: scaledPercent,
          stage: progress.stage,
          partialResult: progress.partialResult, // Pass through partial result
          current: progress.current, // Pass through current/total if available
          total: progress.total,
          error: progress.error, // Pass through error if available
        });
      }
    },
    progressRange: { start: 10, end: 50 },
  });

  const targetLang = options.targetLanguage?.toLowerCase() || 'original';
  if (targetLang === 'original') {
    await fileManager.writeTempFile(subtitlesContent, '.srt');
    if (progressCallback) {
      progressCallback({
        percent: 100,
        stage: 'Subtitle generation complete',
        partialResult: subtitlesContent,
      });
    }
    return { subtitles: subtitlesContent };
  }

  const originalSegments = parseSrt(subtitlesContent);
  const totalSegments = originalSegments.length;
  const translatedSegments: any[] = [];

  log.info(
    `[${callId}] Starting batch translation, total segments: ${totalSegments}`
  );
  const BATCH_SIZE = 10;
  for (
    let batchStart = 0;
    batchStart < totalSegments;
    batchStart += BATCH_SIZE
  ) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalSegments);
    const currentBatch = {
      segments: originalSegments.slice(batchStart, batchEnd),
      startIndex: batchStart,
      endIndex: batchEnd,
    };

    const translatedBatch = await translateBatch(
      currentBatch,
      targetLang,
      callId
    );
    translatedSegments.push(...translatedBatch);

    const overallProgress = Math.floor((batchEnd / totalSegments) * 100);
    const scaledPercent = 50 + (overallProgress * 50) / 100;

    if (progressCallback) {
      const currentBatchSrt = buildSrt(translatedBatch);
      progressCallback({
        percent: scaledPercent,
        stage: `Translating segments ${
          batchStart + 1
        } to ${batchEnd} of ${totalSegments}`,
        partialResult: currentBatchSrt,
        current: batchEnd,
        total: totalSegments,
      });
    }
  }

  const finalSubtitlesContent = buildSrt(translatedSegments);
  await fileManager.writeTempFile(finalSubtitlesContent, '.srt');

  if (progressCallback) {
    progressCallback({
      percent: 100,
      stage: 'Subtitle generation complete',
      partialResult: finalSubtitlesContent,
    });
  }

  log.info(`[${callId}] Subtitle generation completed successfully`);
  return { subtitles: finalSubtitlesContent };
}

// Exported Function: mergeSubtitlesWithVideo
export async function mergeSubtitlesWithVideo(
  options: MergeSubtitlesOptions,
  progressCallback?: (progress: { percent: number; stage: string }) => void,
  services?: {
    ffmpegService: FFmpegService;
  }
): Promise<MergeSubtitlesResult> {
  if (!options.videoPath) {
    throw new SubtitleProcessingError('Video path is required');
  }
  if (!options.subtitlesPath) {
    throw new SubtitleProcessingError('Subtitles path is required');
  }
  if (!services?.ffmpegService) {
    throw new SubtitleProcessingError('FFmpeg service not provided');
  }

  const { ffmpegService } = services;

  if (progressCallback) {
    progressCallback({ percent: 0, stage: 'Starting subtitle merging' });
  }

  const outputPath =
    options.outputPath ||
    path.join(
      path.dirname(options.videoPath),
      `${path.basename(
        options.videoPath,
        path.extname(options.videoPath)
      )}_with_subtitles${path.extname(options.videoPath)}`
    );

  if (progressCallback) {
    progressCallback({ percent: 25, stage: 'Processing video' });
  }

  await ffmpegService.mergeSubtitles(
    options.videoPath,
    options.subtitlesPath,
    outputPath,
    progress => {
      if (progressCallback) {
        const scaledProgress = 25 + progress.percent * 0.65;
        progressCallback({
          percent: Math.min(90, scaledProgress),
          stage: progress.stage || 'Merging subtitles with video',
        });
      }
    }
  );

  if (progressCallback) {
    progressCallback({ percent: 100, stage: 'Subtitle merging complete' });
  }

  return { outputPath };
}

export // generateSubtitlesFromVideo, // Already exported above
// mergeSubtitlesWithVideo,   // Already exported above
// SubtitleProcessingError    // Already exported above
 {};
