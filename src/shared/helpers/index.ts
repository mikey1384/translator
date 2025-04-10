import { SrtSegment } from '../../types/interface.js';
import fs from 'fs';
import log from 'electron-log';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getApiKey as getSecureApiKey } from '../../services/secure-store.js';
import { AI_MODELS } from '../constants/index.js';

export class SubtitleProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubtitleProcessingError';
  }
}

export function createFileFromPath(filePath: string): fs.ReadStream {
  try {
    return fs.createReadStream(filePath);
  } catch (error) {
    throw new SubtitleProcessingError(`Failed to create file stream: ${error}`);
  }
}

export async function getApiKey(
  keyType: 'openai' | 'anthropic'
): Promise<string> {
  const key = await getSecureApiKey(keyType);
  if (key) {
    return key;
  }

  throw new SubtitleProcessingError(
    `${keyType === 'openai' ? 'OpenAI' : 'Anthropic'} API key not found. Please set it in the application settings.`
  );
}

export async function callOpenAIChat({
  model,
  messages,
  max_tokens,
  signal,
  operationId,
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
    openai = new OpenAI({ apiKey: openaiApiKey });
  } catch (keyError) {
    const message =
      keyError instanceof Error ? keyError.message : String(keyError);
    log.error(`[${operationId}] Failed to initialize OpenAI: ${message}`);
    throw new SubtitleProcessingError(
      `OpenAI initialization failed: ${message}`
    );
  }

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;
    try {
      log.info(
        `[${operationId}] Sending request to OpenAI Chat API (Model: ${model}, Attempt: ${currentAttempt}/${retryAttempts}).`
      );
      const response = await openai.chat.completions.create(
        {
          model: model,
          messages: messages,
          max_tokens: max_tokens,
        },
        { signal }
      );
      log.info(`[${operationId}] Received response from OpenAI Chat API.`);

      const content = response.choices[0]?.message?.content;
      if (content) {
        return content;
      } else {
        log.error(
          `[${operationId}] Unexpected response format from OpenAI Chat API:`,
          response
        );
        throw new Error('Unexpected response format from OpenAI Chat API.');
      }
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        log.info(`[${operationId}] OpenAI Chat API call cancelled.`);
        throw new Error('Operation cancelled');
      }

      log.error(
        `[${operationId}] OpenAI Chat API call failed (Attempt ${currentAttempt}/${retryAttempts}):`,
        error.name,
        error.message
      );

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
        log.info(
          `[${operationId}] Retrying OpenAI Chat API call in ${delay}ms...`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw new SubtitleProcessingError(
        `OpenAI Chat API call failed: ${error.message || String(error)}`
      );
    }
  }

  throw new SubtitleProcessingError(
    `OpenAI Chat API call failed after ${retryAttempts} attempts.`
  );
}

export async function callClaudeModel({
  model,
  messages,
  max_tokens,
  signal,
  operationId,
  retryAttempts = 3,
}: {
  model: string;
  messages: Anthropic.MessageParam[];
  max_tokens: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  let anthropic: Anthropic;
  let anthropicApiKey: string;
  try {
    anthropicApiKey = await getApiKey('anthropic');
    anthropic = new Anthropic({ apiKey: anthropicApiKey });
  } catch (keyError) {
    const message =
      keyError instanceof Error ? keyError.message : String(keyError);
    log.error(`[${operationId}] Failed to initialize Anthropic: ${message}`);
    throw new SubtitleProcessingError(
      `Anthropic initialization failed: ${message}`
    );
  }

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;
    try {
      log.info(
        `[${operationId}] Sending request to Claude API (Model: ${model}, Attempt: ${currentAttempt}/${retryAttempts}).`
      );
      const response: Anthropic.Message = await anthropic.messages.create(
        {
          model: model,
          max_tokens: max_tokens,
          messages: messages,
        },
        { signal }
      );
      log.info(`[${operationId}] Received response from Claude API.`);

      if (
        response.content &&
        Array.isArray(response.content) &&
        response.content.length > 0 &&
        response.content[0].type === 'text'
      ) {
        return response.content[0].text;
      } else {
        log.error(
          `[${operationId}] Unexpected response format from Claude:`,
          response
        );
        throw new Error('Unexpected response format from Claude.');
      }
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        log.info(`[${operationId}] Claude API call cancelled.`);
        throw new Error('Operation cancelled');
      }

      log.error(
        `[${operationId}] Claude API call failed (Attempt ${currentAttempt}/${retryAttempts}):`,
        error.name,
        error.message
      );

      if (
        error.message &&
        (error.message.includes('timeout') ||
          error.message.includes('rate') ||
          error.message.includes('ECONNRESET')) &&
        currentAttempt < retryAttempts
      ) {
        const delay = 1000 * Math.pow(2, currentAttempt);
        log.info(`[${operationId}] Retrying Claude API call in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      throw new SubtitleProcessingError(
        `Claude API call failed: ${error.message || String(error)}`
      );
    }
  }

  throw new SubtitleProcessingError(
    `Claude API call failed after ${retryAttempts} attempts.`
  );
}

export async function callChatModel({
  messages,
  max_tokens,
  signal,
  operationId,
  retryAttempts = 3,
  isUsingClaude = false,
}: {
  messages: any[];
  max_tokens?: number;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
  isUsingClaude?: boolean;
}): Promise<string> {
  if (isUsingClaude) {
    // This expects the messages to match Anthropic’s shape, so you might need
    // an adapter if your messages are in OpenAI format. Or vice versa.
    return callClaudeModel({
      model: AI_MODELS.CLAUDE_3_7_SONNET,
      messages,
      max_tokens: max_tokens ?? 1000,
      signal,
      operationId,
      retryAttempts,
    });
  } else {
    // If using GPT, you presumably have messages in OpenAI’s Chat format
    return callOpenAIChat({
      model: AI_MODELS.GPT_4O,
      messages,
      max_tokens: max_tokens ?? 1000,
      signal,
      operationId,
      retryAttempts,
    });
  }
}

export function parseSrt(srtString: string): SrtSegment[] {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString
    .trim()
    .split(/\r?\n\r?\n/)
    .filter(block => block.trim() !== '');

  blocks.forEach((block, _blockIndex) => {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) {
      return;
    }

    const indexLine = lines[0].trim();
    const timeLine = lines[1].trim();
    const textLines = lines.slice(2);
    let text = textLines.join('\n').trim();
    text = text.replace(/\\n/g, '\n');

    const index = parseInt(indexLine, 10);
    const timeMatch = timeLine.match(
      /(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/
    );

    if (isNaN(index)) {
      return;
    }
    if (!timeMatch) {
      return;
    }
    if (text === '') {
      // Allow empty text content, no action needed
    }

    // Use srtTimeToSeconds to correctly parse the time strings
    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    // Basic validation for parsed times
    if (isNaN(startTime) || isNaN(endTime)) {
      return;
    }

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  return segments;
}

/**
 * Build SRT content from segments
 */
export function buildSrt(segments: SrtSegment[]): string {
  if (segments.length === 0) return '';

  return segments
    .map((segment, i) => {
      const index = segment.index || i + 1;
      const startTimeStr = secondsToSrtTime(segment.start);
      const endTimeStr = secondsToSrtTime(segment.end);
      return `${index}\n${startTimeStr} --> ${endTimeStr}\n${segment.text}`;
    })
    .join('\n\n');
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 */
export function srtTimeToSeconds(timeString: string): number {
  if (!timeString) return 0;
  const parts = timeString.split(',');
  if (parts.length !== 2) return 0;
  const [time, msStr] = parts;
  const timeParts = time.split(':');
  if (timeParts.length !== 3) return 0;
  const [hoursStr, minutesStr, secondsStr] = timeParts;

  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  const seconds = parseInt(secondsStr, 10);
  const ms = parseInt(msStr, 10);

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(ms)) {
    return 0;
  }

  return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

/**
 * Convert seconds to SRT time format (00:00:00,000)
 */
export function secondsToSrtTime(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00,000';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const milliseconds = Math.round((totalSeconds % 1) * 1000);

  const finalSeconds = milliseconds === 1000 ? seconds + 1 : seconds;
  const finalMilliseconds = milliseconds === 1000 ? 0 : milliseconds;

  const finalMinutes = finalSeconds === 60 ? minutes + 1 : minutes;
  const finalSecondsAdjusted = finalSeconds === 60 ? 0 : finalSeconds;

  const finalHours = finalMinutes === 60 ? hours + 1 : hours;
  const finalMinutesAdjusted = finalMinutes === 60 ? 0 : finalMinutes;

  return `${String(finalHours).padStart(2, '0')}:${String(
    finalMinutesAdjusted
  ).padStart(2, '0')}:${String(finalSecondsAdjusted).padStart(2, '0')},${String(
    finalMilliseconds
  ).padStart(3, '0')}`;
}

export function fixOverlappingSegments(segments: SrtSegment[]): SrtSegment[] {
  if (!segments || segments.length <= 1) return segments;

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  for (let i = 0; i < sortedSegments.length - 1; i++) {
    const current = sortedSegments[i];
    const next = sortedSegments[i + 1];
    if (current.end > next.start) {
      current.end = Math.max(current.start + 0.1, next.start - 0.05);
    }
  }

  return sortedSegments;
}

/**
 * Format a time for display (compact format)
 */
export function formatTimeForDisplay(seconds: number): string {
  if (isNaN(seconds)) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export async function openSubtitleWithElectron(): Promise<{
  file?: File;
  content?: string;
  segments?: SrtSegment[];
  filePath?: string;
  error?: string;
}> {
  try {
    const result = await window.electron.openFile({
      filters: [{ name: 'Subtitle Files', extensions: ['srt'] }],
      title: 'Open Subtitle File',
    });

    if (
      result.canceled ||
      !result.filePaths?.length ||
      !result.fileContents?.length
    ) {
      return { error: 'File selection was canceled' };
    }

    const filePath = result.filePaths[0];
    const content = result.fileContents[0];
    const filename = filePath.split('/').pop() || 'subtitles.srt';
    const file = new File([content], filename, { type: 'text/plain' });

    localStorage.setItem('loadedSrtFileName', filename);
    localStorage.setItem('originalSrtPath', filePath);
    localStorage.setItem('originalLoadPath', filePath);

    const segments = parseSrt(content);

    return {
      file,
      content,
      segments,
      filePath,
    };
  } catch (error: any) {
    const message = error.message || String(error);
    console.error('Error opening subtitle file:', message);
    return { error: `Failed to open subtitle file: ${message}` };
  }
}

export const validateSubtitleTimings = (
  subtitles: SrtSegment[]
): SrtSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];
  return subtitles.map(subtitle => {
    const fixed = { ...subtitle };
    if (fixed.start < 0) fixed.start = 0;
    if (fixed.end <= fixed.start) fixed.end = fixed.start + 0.5;
    return fixed;
  });
};

export const generateSrtContent = (segments: SrtSegment[]): string => {
  return segments
    .map((segment, i) => {
      const index = i + 1;
      const startTime = secondsToSrtTime(segment.start);
      const endTime = secondsToSrtTime(segment.end);
      return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
    })
    .join('\n\n');
};
