import path from 'path';
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
} from '../types/interface';

dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

try {
  if (ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  } else {
    console.warn('Anthropic API key not found in environment variables.');
  }
} catch (error) {
  console.error('Error initializing Anthropic client:', error);
}

try {
  if (OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  } else {
    console.warn('OpenAI API key not found in environment variables.');
  }
} catch (error) {
  console.error('Error initializing OpenAI client:', error);
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

async function translateBatch(
  batch: { segments: any[]; startIndex: number; endIndex: number },
  targetLang: string,
  _callId: string
): Promise<any[]> {
  if (!anthropic) {
    throw new SubtitleProcessingError(
      'Anthropic API key is missing or client failed to initialize. Please check your .env configuration.'
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
      const batchTranslationResponse = await callClaudeWithRetry({
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
  // Check if OpenAI client is available
  if (!openai) {
    throw new SubtitleProcessingError(
      'OpenAI API key is missing or client failed to initialize. Please check your .env configuration.'
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

      if (chosenEnd < idealEnd && chosenEnd !== duration) {
        // No suitable boundary found, stick to idealEnd
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
                return await openai!.audio.transcriptions.create({
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

    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          await fsp.unlink(meta.path);
        } catch (err) {
          console.error(
            `Failed to delete temporary audio file ${meta.path}:`,
            err
          );
        }
      })
    );

    progressCallback?.({
      percent: scaleProgress(100),
      stage: 'Processing complete',
      partialResult: finalSrt,
    });

    return finalSrt;
  } catch (error: any) {
    await Promise.allSettled(
      chunkMetadata.map(async meta => {
        try {
          if (fs.existsSync(meta.path)) {
            await fsp.unlink(meta.path);
          }
        } catch (err) {
          // Ignored: Failure to delete temp file during error cleanup
        }
      })
    );

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
  }) => void,
  services?: {
    ffmpegService: FFmpegService;
    fileManager: FileManager;
  }
): Promise<GenerateSubtitlesResult> {
  const _callId = Date.now() + Math.random().toString(36).substring(2);

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
  let audioPath: string | null = null; // Keep track of the audio path

  try {
    if (progressCallback) {
      progressCallback({ percent: 0, stage: 'Starting subtitle generation' });
      progressCallback({ percent: 10, stage: 'Extracting audio from video' });
    }

    audioPath = await ffmpegService.extractAudio(options.videoPath);

    const subtitlesContent = await generateSubtitlesFromAudio({
      inputAudioPath: audioPath,
      targetLanguage: 'original',
      progressCallback: progress => {
        if (progressCallback) {
          const basePercent = 10;
          const transcriptionSpan = 40;
          const scaledPercent =
            basePercent + (progress.percent / 100) * transcriptionSpan;
          progressCallback({
            percent: scaledPercent,
            stage: progress.stage,
            partialResult: progress.partialResult,
            current: progress.current,
            total: progress.total,
            error: progress.error,
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
        _callId
      );

      translatedSegments.push(...translatedBatch);

      const overallProgress = Math.floor((batchEnd / totalSegments) * 100);
      const scaledPercent = 50 + (overallProgress * 50) / 100;

      if (progressCallback) {
        const cumulativeSrt = buildSrt(translatedSegments);

        progressCallback({
          percent: scaledPercent,
          stage: `Translating segments ${
            batchStart + 1
          } to ${batchEnd} of ${totalSegments}`,
          partialResult: cumulativeSrt,
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
  const tempFilename = `temp_merge_${Date.now()}_${baseName}_with_subtitles${videoExt}`;
  const tempOutputPath = path.join(ffmpegService.getTempDir(), tempFilename);

  if (progressCallback) {
    progressCallback({ percent: 25, stage: 'Processing video' });
  }

  await ffmpegService.mergeSubtitles(
    options.videoPath,
    options.subtitlesPath,
    tempOutputPath,
    operationId,
    progress => {
      if (progressCallback) {
        const scaledProgress = 25 + progress.percent * 0.7;
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
