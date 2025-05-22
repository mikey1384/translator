import OpenAI from 'openai';
import { getApiKey as getSecureApiKey } from '../secure-store.js';
import { AI_MODELS } from '../../../shared/constants/index.js';
import { SubtitleProcessingError } from './errors.js';
import fs from 'fs';

export async function getApiKey(keyType: 'openai'): Promise<string> {
  // Check secure store first
  const key = await getSecureApiKey(keyType);
  if (key) return key;

  // Check environment variable as fallback
  if (keyType === 'openai') {
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey && envKey.trim().length > 0) {
      return envKey.trim();
    }
  }

  throw new SubtitleProcessingError('OpenAI API key not found.');
}

export async function callOpenAIChat({
  model,
  messages,
  signal,
  retryAttempts = 3,
}: {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
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
  signal,
  operationId,
  retryAttempts = 3,
}: {
  messages: any[];
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  return callOpenAIChat({
    model: AI_MODELS.GPT,
    messages,
    signal,
    operationId,
    retryAttempts,
  });
}

export function createFileFromPath(filePath: string) {
  try {
    return fs.createReadStream(filePath);
  } catch (e) {
    throw new SubtitleProcessingError(`File stream error: ${e}`);
  }
}
