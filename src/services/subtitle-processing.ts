import path from 'path';
import { FFmpegService } from './ffmpeg-service';
import { FileManager } from './file-manager';
import { parseSrt, buildSrt } from '../renderer/helpers/subtitle-utils';
import fs from 'fs';
import fsp from 'fs/promises';
import keytar from 'keytar';
import { AI_MODELS } from '../renderer/constants';
import { SrtSegment } from '../types/interface';
import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import log from 'electron-log';

import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
} from '../types/interface';

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

async function callClaudeWithRetry(
  anthropicClient: Anthropic,
  params: any,
  maxRetries = 3
): Promise<any> {
  let lastError: any = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort('Request timeout');
      }, 45000);

      const result = await anthropicClient.messages.create(params, {
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

interface GenerateSubtitlesFromAudioOptions {
  inputAudioPath: string;
  targetLanguage?: string;
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
    error?: string;
  }) => void;
  progressRange?: { start: number; end: number };
}

async function generateSubtitlesFromAudio({
  inputAudioPath,
  targetLanguage = 'original',
  progressCallback,
  progressRange,
}: GenerateSubtitlesFromAudioOptions): Promise<string> {
  let openai: OpenAI;
  try {
    const openaiApiKey = await getApiKey('openai');
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const _callId = Date.now() + Math.random().toString(36).substring(2);

  const progressStart = progressRange?.start || 0;
  const progressEnd = progressRange?.end || 100;
  const progressSpan = progressEnd - progressStart;

  const scaleProgress = (originalProgress: number): number => {
    const scaled = progressStart + (originalProgress / 100) * progressSpan;
    return Math.min(progressEnd, Math.max(progressStart, scaled));
  };

  if (!fs.existsSync(inputAudioPath)) {
    throw new SubtitleProcessingError(
      `Audio file not found: ${inputAudioPath}`
    );
  }

  const ffmpegService = new FFmpegService();
  const fileSize = fs.statSync(inputAudioPath).size;
  const duration = await ffmpegService.getMediaDuration(inputAudioPath);
  const CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
  const bitrate = fileSize > 0 && duration > 0 ? fileSize / duration : 128000;
  const targetChunkDuration = CHUNK_SIZE_BYTES / bitrate;

  progressCallback?.({
    percent: scaleProgress(5),
    stage: 'Analyzing audio for silence points',
  });

  const { silenceStarts, silenceEnds } =
    await ffmpegService.detectSilenceBoundaries(inputAudioPath);
  const tolerance = 2;

  let firstSpeechStart = 0;
  if (
    silenceStarts &&
    silenceStarts.length > 0 &&
    silenceStarts[0] === 0 &&
    silenceEnds &&
    silenceEnds.length > 0
  ) {
    firstSpeechStart = silenceEnds[0];
  }

  const effectiveDuration = duration - firstSpeechStart;
  if (effectiveDuration <= 0) {
    throw new SubtitleProcessingError(
      'No speech or sound detected after initial silence (or entire duration is silent).'
    );
  }

  const chunkMetadata: { path: string; start: number; duration: number }[] = [];
  let startTime = 0;
  let chunkIndex = 0;

  while (startTime < duration) {
    let idealEnd = startTime + targetChunkDuration;
    if (idealEnd > duration) {
      idealEnd = duration;
    }
    let chosenEnd = idealEnd;

    if (
      chunkIndex === 0 &&
      silenceEnds.length > 0 &&
      silenceEnds[0] > startTime &&
      silenceEnds[0] < idealEnd
    ) {
      chosenEnd = silenceEnds[0];
    } else {
      for (const boundary of silenceEnds) {
        if (
          boundary > startTime &&
          boundary >= idealEnd &&
          boundary <= idealEnd + tolerance
        ) {
          chosenEnd = boundary;
          break;
        } else if (boundary > startTime && boundary > idealEnd + tolerance) {
          break;
        }
      }
    }

    if (chosenEnd - startTime < 1 && chosenEnd < duration) {
      chosenEnd = idealEnd;
    }

    const actualChunkDuration = chosenEnd - startTime;

    if (actualChunkDuration <= 0) {
      break;
    }

    const chunkPath = path.join(
      path.dirname(inputAudioPath),
      `chunk_${_callId}_${chunkIndex}.mp3`
    );

    await ffmpegService.extractAudioSegment(
      inputAudioPath,
      chunkPath,
      startTime,
      actualChunkDuration
    );

    chunkMetadata.push({
      path: chunkPath,
      start: startTime,
      duration: actualChunkDuration,
    });

    startTime = chosenEnd;
    chunkIndex++;

    const chunkingProgress =
      5 + ((startTime - firstSpeechStart) / effectiveDuration) * 5;
    progressCallback?.({
      percent: scaleProgress(Math.min(10, chunkingProgress)),
      stage: `Prepared chunk ${chunkIndex}`,
    });
  }

  if (chunkMetadata.length === 0 && duration > 0) {
    throw new SubtitleProcessingError(
      'All audio chunks were empty or failed extraction.'
    );
  }

  progressCallback?.({
    percent: scaleProgress(10),
    stage: 'Starting batch transcription',
    total: chunkMetadata.length,
  });

  let transcriptionProgress = 10;
  const progressPerChunk =
    chunkMetadata.length > 0 ? 75 / chunkMetadata.length : 0;

  const allSegments: any[] = [];
  const TRANSCRIPTION_BATCH_SIZE = 3;
  const INTER_CHUNK_TRANSCRIPTION_DELAY = 1000;
  const INTER_BATCH_DELAY = 3000;

  try {
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

      await Promise.all(
        batchChunks.map(async (meta, batchIndex) => {
          const overallChunkIndex = batchStart + batchIndex;

          if (batchIndex > 0) {
            await new Promise(resolve =>
              setTimeout(resolve, INTER_CHUNK_TRANSCRIPTION_DELAY)
            );
          }

          try {
            const chunkResponse = await retryWithExponentialBackoff(
              async () => {
                const fileStream = createFileFromPath(meta.path);
                return await openai.audio.transcriptions.create({
                  file: fileStream,
                  model: 'whisper-1',
                  response_format: 'verbose_json',
                  language:
                    targetLanguage === 'original' ? undefined : targetLanguage,
                });
              }
            );

            const chunkSegments = chunkResponse.segments || [];
            for (const segment of chunkSegments) {
              segment.start += meta.start;
              segment.end += meta.start;
            }

            allSegments.push(...chunkSegments);
            allSegments.sort((a, b) => a.start - b.start);
            const partialSrtForBatch = convertSegmentsToSrt(allSegments);

            transcriptionProgress += progressPerChunk;
            progressCallback?.({
              percent: scaleProgress(transcriptionProgress),
              stage: `Transcribed chunk ${overallChunkIndex + 1} of ${
                chunkMetadata.length
              }`,
              current: overallChunkIndex + 1,
              total: chunkMetadata.length,
              partialResult: partialSrtForBatch,
            });
            return {
              status: 'success',
              chunkResponse,
              chunkIndex: overallChunkIndex,
              chunkStartTime: meta.start,
              chunkPath: meta.path,
            };
          } catch (transcriptionError) {
            return {
              status: 'error',
              chunkIndex: overallChunkIndex,
              chunkPath: meta.path,
              error: transcriptionError,
            };
          }
        })
      );

      if (batchEnd < chunkMetadata.length) {
        await new Promise(resolve => setTimeout(resolve, INTER_BATCH_DELAY));
      }
    }

    progressCallback?.({
      percent: scaleProgress(85),
      stage: 'Transcription complete, finalizing',
    });

    allSegments.sort((a, b) => a.start - b.start);
    const finalSrt = convertSegmentsToSrt(allSegments);

    const failedToDelete: string[] = [];
    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          if (fs.existsSync(meta.path)) {
            await fsp.unlink(meta.path);
          }
        } catch (err) {
          failedToDelete.push(meta.path);
          console.error(`Error attempting to delete ${meta.path}:`, err);
        }
      })
    );

    if (failedToDelete.length > 0) {
      console.warn(
        `Could not automatically delete the following temporary files. Please remove them manually:\n${failedToDelete.join('\n')}`
      );
    }

    progressCallback?.({
      percent: scaleProgress(100),
      stage: 'Processing complete',
      partialResult: finalSrt,
    });

    return finalSrt;
  } catch (error: any) {
    const failedToDelete: string[] = [];
    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          if (fs.existsSync(meta.path)) {
            await fsp.unlink(meta.path);
          }
        } catch (err) {
          failedToDelete.push(meta.path);
          console.error(`Error attempting to delete ${meta.path}:`, err);
        }
      })
    );

    if (failedToDelete.length > 0) {
      console.warn(
        `Could not automatically delete the following temporary files. Please remove them manually:\n${failedToDelete.join('\n')}`
      );
    }

    progressCallback?.({
      percent: scaleProgress(0),
      stage: 'Error during processing',
      error:
        error instanceof Error ? error.message : 'Unknown transcription error',
    });

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
    batchStartIndex?: number;
  }) => void,
  services?: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }
): Promise<GenerateSubtitlesResult> {
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
  let audioPath: string | null = null;

  const targetLang = options.targetLanguage?.toLowerCase() || 'original';
  const isTranslationNeeded = targetLang !== 'original';

  // Define progress stages and ranges
  const STAGE_AUDIO_EXTRACTION = { start: 0, end: 10 };
  const STAGE_TRANSCRIPTION = { start: 10, end: 50 };
  // Adjust ranges if translation/review is needed
  const STAGE_TRANSLATION = isTranslationNeeded
    ? { start: 50, end: 75 }
    : { start: 50, end: 100 };
  const STAGE_REVIEW = isTranslationNeeded
    ? { start: 75, end: 95 }
    : { start: -1, end: -1 }; // Review only if translating
  const STAGE_FINALIZING = {
    start: isTranslationNeeded ? 95 : STAGE_TRANSLATION.end,
    end: 100,
  };

  const scaleProgress = (
    percent: number,
    stage: { start: number; end: number }
  ) => {
    const stageSpan = stage.end - stage.start;
    const calculatedPercent = stage.start + (percent / 100) * stageSpan;
    // Round the result to the nearest integer
    return Math.round(calculatedPercent);
  };

  try {
    if (progressCallback) {
      progressCallback({
        percent: STAGE_AUDIO_EXTRACTION.start,
        stage: 'Starting subtitle generation',
      });
      progressCallback({
        percent: STAGE_AUDIO_EXTRACTION.end,
        stage: 'Extracting audio from video',
      });
    }

    audioPath = await ffmpegService.extractAudio(options.videoPath);

    const subtitlesContent = await generateSubtitlesFromAudio({
      inputAudioPath: audioPath,
      targetLanguage: 'original', // Always transcribe in original language first
      progressCallback: progress => {
        if (progressCallback) {
          progressCallback({
            percent: scaleProgress(progress.percent, STAGE_TRANSCRIPTION),
            stage: progress.stage,
            // ALWAYS send partial result from transcription, even if translating later
            partialResult: progress.partialResult,
            current: progress.current,
            total: progress.total,
            error: progress.error,
          });
        }
      },
      progressRange: { start: 0, end: 100 }, // Use full range for sub-process
    });

    // If target language is original, we're done after transcription.
    if (!isTranslationNeeded) {
      await fileManager.writeTempFile(subtitlesContent, '.srt');
      if (progressCallback) {
        progressCallback({
          percent: STAGE_FINALIZING.end, // 100%
          stage: 'Transcription complete',
          partialResult: subtitlesContent,
        });
      }
      return { subtitles: subtitlesContent };
    }

    // --- Translation Step ---
    // Start with the original segments, which will be updated in place
    const segmentsInProcess = parseSrt(subtitlesContent);
    const totalSegments = segmentsInProcess.length;
    // translatedSegments is no longer needed as a separate array for building cumulative SRT
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
      // Get the original segments for this batch from the main list
      const currentBatchOriginals = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );

      const batchToTranslate = {
        // Pass only the original text to translateBatch if needed, or let translateBatch handle it
        segments: currentBatchOriginals.map(seg => ({ ...seg })), // Pass copies to avoid direct mutation if translateBatch modifies
        startIndex: batchStart,
        endIndex: batchEnd,
      };

      const translatedBatch = await translateBatch(
        batchToTranslate,
        targetLang
      );

      // Update the segmentsInProcess list with the translated results
      for (let i = 0; i < translatedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = translatedBatch[i];
      }

      if (progressCallback) {
        const overallProgressPercent = (batchEnd / totalSegments) * 100;
        // Build cumulative SRT from the *entire* segmentsInProcess list
        const cumulativeSrt = buildSrt(segmentsInProcess);

        progressCallback({
          percent: scaleProgress(overallProgressPercent, STAGE_TRANSLATION),
          stage: `Translating batch ${Math.ceil(batchEnd / TRANSLATION_BATCH_SIZE)} of ${Math.ceil(totalSegments / TRANSLATION_BATCH_SIZE)}`,
          partialResult: cumulativeSrt, // Send SRT with original + translated segments
          current: batchEnd,
          total: totalSegments,
        });
      }
    }

    // --- Review Step ---
    // reviewedSegments is no longer needed for building cumulative SRT
    const REVIEW_BATCH_SIZE = 20; // Can use a different batch size for review

    for (
      let batchStart = 0;
      // Iterate through segmentsInProcess which now contains translated segments
      batchStart < segmentsInProcess.length;
      batchStart += REVIEW_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + REVIEW_BATCH_SIZE,
        segmentsInProcess.length
      );
      // Get the translated segments for this batch from the main list
      const currentBatchTranslated = segmentsInProcess.slice(
        batchStart,
        batchEnd
      );

      const batchToReview = {
        segments: currentBatchTranslated.map(seg => ({ ...seg })), // Pass copies
        startIndex: batchStart,
        endIndex: batchEnd,
        targetLang: targetLang,
      };

      const reviewedBatch = await reviewTranslationBatch(batchToReview);

      // Update the segmentsInProcess list with the reviewed results
      for (let i = 0; i < reviewedBatch.length; i++) {
        segmentsInProcess[batchStart + i] = reviewedBatch[i];
      }

      if (progressCallback) {
        const overallProgressPercent =
          (batchEnd / segmentsInProcess.length) * 100;

        // Build cumulative SRT from the *entire* segmentsInProcess list
        // This list now contains [reviewed] + [translated_remaining] segments
        const cumulativeReviewedSrt = buildSrt(segmentsInProcess);

        progressCallback({
          percent: scaleProgress(overallProgressPercent, STAGE_REVIEW),
          stage: `Reviewing batch ${Math.ceil(batchEnd / REVIEW_BATCH_SIZE)} of ${Math.ceil(segmentsInProcess.length / REVIEW_BATCH_SIZE)}`,
          partialResult: cumulativeReviewedSrt, // Send reviewed SRT incrementally
          current: batchEnd,
          total: segmentsInProcess.length,
          batchStartIndex: batchStart, // Add the start index of the reviewed batch
        });
      }
    }

    // --- Finalizing ---
    if (progressCallback) {
      progressCallback({
        percent: STAGE_FINALIZING.start,
        stage: 'Finalizing subtitles',
      });
    }

    // Reassign indices sequentially is still good practice if needed,
    // but keep the Original###MARKER###Reviewed format
    const indexedSegments = segmentsInProcess.map((block, idx) => ({
      ...block,
      index: idx + 1,
      // Keep the combined text as is
    }));

    // --- Post-processing Adjustments ---
    // 1. Extend short gaps
    console.log(
      '[generateSubtitlesFromVideo] Extending short subtitle gaps...'
    );
    const gapFilledSegments = extendShortSubtitleGaps(indexedSegments, 3);

    // 2. Fill blank translations
    console.log('[generateSubtitlesFromVideo] Filling blank translations...');
    const finalSegments = fillBlankTranslations(gapFilledSegments);
    // --- End Post-processing Adjustments ---

    // Build final SRT using the adjusted segments
    const finalSubtitlesContent = buildSrt(finalSegments);
    await fileManager.writeTempFile(finalSubtitlesContent, '.srt');

    if (progressCallback) {
      progressCallback({
        percent: STAGE_FINALIZING.end, // 100%
        stage: 'Translation and review complete',
        partialResult: finalSubtitlesContent, // Send final result with marker
      });
    }

    // Return the final content with the marker
    return { subtitles: finalSubtitlesContent };
  } finally {
    if (audioPath) {
      try {
        await fsp.unlink(audioPath);
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
): Promise<{ tempOutputPath: string }> {
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

  const { ffmpegService } = services;

  if (progressCallback) {
    progressCallback({ percent: 0, stage: 'Starting subtitle merging' });
  }

  const videoExt = path.extname(inputPathForNaming);
  const baseName = path.basename(inputPathForNaming, videoExt);
  // --- Force .mp4 extension for the temporary output ---
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles.mp4`; // Always use .mp4
  const tempOutputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  if (progressCallback) {
    progressCallback({ percent: 25, stage: 'Processing video' });
  }

  log.info(
    `[${operationId}] Target temporary output path (forced MP4): ${tempOutputPath}`
  ); // Add log for verification

  await ffmpegService.mergeSubtitles(
    options.videoPath!,
    options.subtitlesPath!,
    tempOutputPath,
    operationId,
    options.fontSize,
    options.stylePreset,
    progress => {
      if (progressCallback) {
        const mergeProgressSpan = 75;
        const scaledProgress =
          25 + (progress.percent / 100) * mergeProgressSpan;
        progressCallback({
          percent: Math.min(95, scaledProgress),
          stage: progress.stage || 'Merging subtitles with video',
        });
      }
    }
  );

  if (progressCallback) {
    progressCallback({ percent: 100, stage: 'Merge complete, ready to save' });
  }
  return { tempOutputPath };
}

async function translateBatch(
  batch: { segments: any[]; startIndex: number; endIndex: number },
  targetLang: string
): Promise<any[]> {
  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
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
      const batchTranslationResponse = await callClaudeWithRetry(anthropic, {
        model: AI_MODELS.CLAUDE_3_7_SONNET,
        temperature: 0.1,
        max_tokens: AI_MODELS.MAX_TOKENS,
        system: `You are a professional subtitle translator. Translate the following subtitles from original to ${targetLang}. Maintain the original format and structure.`,
        messages: [{ role: 'user', content: combinedPrompt }],
      });

      const batchTranslation = batchTranslationResponse.content[0].text;
      const translationLines = batchTranslation
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
      if (
        err.message &&
        (err.message.includes('timeout') ||
          err.message.includes('rate') ||
          err.message.includes('ECONNRESET'))
      ) {
        retryCount++;
        const delay = 1000 * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return batch.segments.map(segment => ({
        ...segment,
        text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
        originalText: segment.text,
        translatedText: segment.text,
      }));
    }
  }

  return batch.segments.map(segment => ({
    ...segment,
    text: `${segment.text}###TRANSLATION_MARKER###${segment.text}`,
    originalText: segment.text,
    translatedText: segment.text,
  }));
}

// New function to review a batch of translated segments
async function reviewTranslationBatch(batch: {
  segments: any[];
  startIndex: number;
  endIndex: number;
  targetLang: string;
}): Promise<any[]> {
  let anthropic: Anthropic;
  try {
    const anthropicApiKey = await getApiKey('anthropic');
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    throw new SubtitleProcessingError(
      keyError instanceof Error ? keyError.message : String(keyError)
    );
  }

  const batchItems = batch.segments.map((block: any, idx: number) => {
    const absoluteIndex = batch.startIndex + idx;
    const [original, translation] = block.text.split(
      '###TRANSLATION_MARKER###'
    );
    return {
      index: absoluteIndex + 1, // Use 1-based index for prompt clarity
      original: original?.trim() || '',
      translation: (translation || original || '').trim(),
    };
  });

  const originalTexts = batchItems
    .map(item => `[${item.index}] ${item.original}`)
    .join('\n');
  const translatedTexts = batchItems
    .map(item => `[${item.index}] ${item.translation}`)
    .join('\n');

  // Refined prompt asking for plain text lines without index prefixes
  const prompt = `
You are a professional subtitle translator and reviewer for ${batch.targetLang}.
Review and improve each translated subtitle block below **individually**.

**RULES:**
- Maintain the original order. **NEVER** merge or split blocks.
- For each block, provide the improved translation. Focus on accuracy, completeness, consistency, and context based on the original text.
- Preserve the sequence of information from the corresponding original text.
- **CRITICAL SYNC RULE:** If a block's content (e.g., 1-2 leftover words) logically belongs to the *previous* block's translation, leave the *current* block's translation **COMPLETELY BLANK**. Do not fill it with the *next* block's content.

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
    const reviewResponse = await callClaudeWithRetry(anthropic, {
      model: AI_MODELS.CLAUDE_3_7_SONNET,
      temperature: 0.1,
      max_tokens: AI_MODELS.MAX_TOKENS,
      system: `You are an expert subtitle reviewer. Follow the output format instructions precisely. Output only the improved ${batch.targetLang} translations, one per line, matching the input order.`,
      messages: [{ role: 'user', content: prompt }],
    });

    const reviewedContent = reviewResponse.content[0].text;
    // Split reviewed content into lines, expecting one line per segment
    const reviewedLines = reviewedContent.split('\n');

    // Check if the number of lines matches the number of segments
    if (reviewedLines.length !== batch.segments.length) {
      console.warn(
        `Translation review output line count (${reviewedLines.length}) does not match batch size (${batch.segments.length}). Using original translations for this batch.`
      );
      // Fallback: return original translations if response format is unexpected
      return batch.segments;
    }

    // Map reviewed lines back to segments
    return batch.segments.map((segment, idx) => {
      const [originalText] = segment.text.split('###TRANSLATION_MARKER###');
      const reviewedTranslation = reviewedLines[idx]?.trim() ?? ''; // Use '' for potentially blank lines

      // Handle the case where review might return an empty string
      const finalTranslation =
        reviewedTranslation === '' ? '' : reviewedTranslation;

      return {
        ...segment,
        text: `${originalText}###TRANSLATION_MARKER###${finalTranslation}`,
        // Optionally keep track of original/reviewed if needed later
        originalText: originalText,
        reviewedText: finalTranslation,
      };
    });
  } catch (error) {
    console.error('Error calling Claude for translation review batch:', error);
    // Fallback: return original translations on error
    return batch.segments;
  }
}

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
        (error as any).status === 429 ||
        (error as any).status >= 500 ||
        (error as Error).message?.includes('timeout') ||
        (error as Error).message?.includes('network') ||
        (error as Error).message?.includes('ECONNRESET');

      if (!isRetriable || attempt === maxRetries - 1) {
        throw error;
      }

      const backoffTime = initialDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
    }
  }

  throw (
    lastError ||
    new SubtitleProcessingError(
      'Failed operation after multiple retries, but no error was captured.'
    )
  );
}

/**
 * Extends the duration of subtitles to fill short gaps before the next subtitle.
 * @param segments The array of subtitle segments.
 * @param threshold The maximum gap duration (in seconds) to fill.
 * @returns The modified array of subtitle segments.
 */
function extendShortSubtitleGaps(
  segments: SrtSegment[],
  threshold: number = 3
): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments; // Need at least two segments to have a gap
  }

  const adjustedSegments = segments.map(segment => ({ ...segment })); // Create a copy to modify

  for (let i = 0; i < adjustedSegments.length - 1; i++) {
    const currentSegment = adjustedSegments[i];
    const nextSegment = adjustedSegments[i + 1];

    // Ensure times are valid numbers
    const currentEndTime = Number(currentSegment.end);
    const nextStartTime = Number(nextSegment.start);

    if (isNaN(currentEndTime) || isNaN(nextStartTime)) {
      console.warn(
        `Invalid time encountered at index ${i}, skipping gap adjustment.`
      );
      continue; // Skip if times are invalid
    }

    const gap = nextStartTime - currentEndTime;

    // Check if the gap is positive (no overlap) and less than the threshold
    if (gap > 0 && gap < threshold) {
      // Adjust the end time of the current segment to meet the start of the next
      currentSegment.end = nextStartTime;
      // console.log(`Adjusted end time for segment ${currentSegment.index} to ${nextStartTime} (gap was ${gap.toFixed(3)}s)`);
    }
  }

  return adjustedSegments;
}

/**
 * Fills blank translations by copying the translation from the previous segment.
 * Assumes segments have the format "original###TRANSLATION_MARKER###translation".
 * @param segments The array of subtitle segments.
 * @returns The modified array of subtitle segments.
 */
function fillBlankTranslations(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length < 2) {
    return segments;
  }

  const adjustedSegments = segments.map(segment => ({ ...segment })); // Create a copy

  for (let i = 1; i < adjustedSegments.length; i++) {
    const currentSegment = adjustedSegments[i];
    const prevSegment = adjustedSegments[i - 1];

    // Check if current segment has the marker and a blank translation
    const currentParts = currentSegment.text.split('###TRANSLATION_MARKER###');
    const currentHasMarker = currentParts.length > 1;
    const currentOriginal = currentParts[0] || '';
    const currentTranslation = currentParts[1] || '';
    const isCurrentBlank =
      currentHasMarker &&
      currentOriginal.trim() !== '' &&
      currentTranslation.trim() === '';

    if (isCurrentBlank) {
      // Get the previous segment's translation
      const prevParts = prevSegment.text.split('###TRANSLATION_MARKER###');
      const prevTranslation = prevParts[1] || ''; // Use prev original if no marker?

      if (prevTranslation.trim() !== '') {
        // Construct the new text with the copied translation
        currentSegment.text = `${currentOriginal}###TRANSLATION_MARKER###${prevTranslation}`;
        // console.log(`Filled blank translation for segment ${currentSegment.index} with previous translation.`);
      }
    }
  }

  return adjustedSegments;
}
