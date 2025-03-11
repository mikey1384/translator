import path from 'path';
import log from 'electron-log';
import { FFmpegService } from './ffmpeg-service';
import { FileManager } from './file-manager';
import { parseSrt, buildSrt } from '../renderer/helpers/subtitle-utils';
import { Anthropic } from '@anthropic-ai/sdk';
import { OpenAI } from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

// Import types from preload script
import {
  GenerateSubtitlesOptions,
  GenerateSubtitlesResult,
  MergeSubtitlesOptions,
  MergeSubtitlesResult,
} from '../types/types';

dotenv.config();

// Initialize API clients at module level
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

// Base SRT segment interface
interface SrtSegment {
  index: number;
  start: number; // in seconds
  end: number; // in seconds
  text: string;
}

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

// Extend SrtSegment with translation fields
interface TranslatedSegment extends SrtSegment {
  originalText: string;
  translatedText: string;
}

interface TranslationBatch {
  segments: SrtSegment[];
  startIndex: number;
  endIndex: number;
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
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 4000,
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

// Function: generateSubtitlesFromAudio
async function generateSubtitlesFromAudio(
  inputAudioPath: string,
  targetLanguage: string = 'original',
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    current?: number;
    total?: number;
    partialResult?: string;
  }) => void
): Promise<string> {
  const callId = Date.now() + Math.random().toString(36).substring(2);
  log.info(`[${callId}] Starting audio transcription for: ${inputAudioPath}`);

  if (!fs.existsSync(inputAudioPath)) {
    throw new SubtitleProcessingError(
      `Audio file not found: ${inputAudioPath}`
    );
  }
  if (!openai) {
    throw new SubtitleProcessingError('OpenAI client not initialized');
  }

  const ffmpegService = new FFmpegService();
  const fileSize = fs.statSync(inputAudioPath).size;
  const duration = await ffmpegService.getMediaDuration(inputAudioPath);
  const CHUNK_SIZE = 20 * 1024 * 1024;
  const bitrate = fileSize / duration;
  const chunkDuration = CHUNK_SIZE / bitrate;
  const numChunks = Math.ceil(duration / chunkDuration);

  log.info(`[${callId}] Processing audio in ${numChunks} chunks`);
  const allSegments: any[] = [];
  const tempDir = path.dirname(inputAudioPath);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = path.join(tempDir, `chunk_${callId}_${i}.mp3`);

    try {
      await ffmpegService.extractAudioSegment(
        inputAudioPath,
        chunkPath,
        startTime,
        chunkDuration
      );

      const MAX_RETRIES = 3;
      let chunkResponse = null;

      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        try {
          chunkResponse = await openai.audio.transcriptions.create({
            file: createFileFromPath(chunkPath),
            model: 'whisper-1',
            response_format: 'verbose_json',
            language:
              targetLanguage === 'original' ? undefined : targetLanguage,
          });
          break;
        } catch (err) {
          if (retry === MAX_RETRIES - 1) throw err;
          await new Promise(resolve =>
            setTimeout(resolve, 1000 * Math.pow(2, retry))
          );
        }
      }

      if (!chunkResponse) {
        throw new SubtitleProcessingError(
          `Failed to transcribe chunk ${i} after ${MAX_RETRIES} retries`
        );
      }

      const chunkSegments = chunkResponse.segments || [];
      for (const segment of chunkSegments) {
        segment.start += startTime;
        segment.end += startTime;
      }
      allSegments.push(...chunkSegments);

      if (progressCallback) {
        const percent = Math.floor(((i + 1) / numChunks) * 100);
        const partialSrt = convertSegmentsToSrt(allSegments);
        progressCallback({
          percent,
          stage: `Transcribed chunk ${i + 1} of ${numChunks}`,
          current: i + 1,
          total: numChunks,
          partialResult: partialSrt,
        });
      }
    } finally {
      try {
        fs.unlinkSync(chunkPath);
      } catch (err) {
        log.warn(`[${callId}] Failed to delete chunk file ${chunkPath}:`, err);
      }
    }
  }

  const finalSrt = convertSegmentsToSrt(allSegments);
  log.info(`[${callId}] Transcription completed successfully`);
  return finalSrt;
}

// Exported Function: generateSubtitlesFromVideo
export async function generateSubtitlesFromVideo(
  options: GenerateSubtitlesOptions,
  progressCallback?: (progress: {
    percent: number;
    stage: string;
    partialResult?: string;
    current?: number;
    total?: number;
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
  const subtitlesContent = await generateSubtitlesFromAudio(
    audioPath,
    'original',
    progress => {
      if (progressCallback) {
        const scaledPercent = 10 + (progress.percent * 40) / 100;
        progressCallback({
          percent: scaledPercent,
          stage: progress.stage,
          partialResult: progress.partialResult,
        });
      }
    }
  );

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
