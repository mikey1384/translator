import { SubtitleProcessingError } from './errors.js';
import fs from 'fs';
import { translate as translateAi, getActiveProvider } from '../ai-provider.js';
import log from 'electron-log';
import { AI_MODELS } from '../../../shared/constants/index.js';

function extractContentFromCompletion(completion: any): string | null {
  if (!completion) {
    return null;
  }

  if (typeof completion === 'string') {
    return completion;
  }

  const firstChoice = completion?.choices?.[0];
  if (firstChoice) {
    const choiceMessage = firstChoice?.message;
    if (choiceMessage) {
      if (typeof choiceMessage.content === 'string') {
        return choiceMessage.content;
      }
      if (Array.isArray(choiceMessage.content)) {
        const combined = choiceMessage.content
          .map((part: any) => {
            if (!part) return '';
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
          })
          .join('')
          .trim();
        if (combined) {
          return combined;
        }
      }
    }

    if (typeof firstChoice.text === 'string' && firstChoice.text.trim()) {
      return firstChoice.text;
    }
  }

  const outputText = completion?.output_text;
  if (typeof outputText === 'string' && outputText.trim()) {
    return outputText;
  }
  if (Array.isArray(outputText)) {
    const joined = outputText
      .map((part: any) => (typeof part === 'string' ? part.trim() : ''))
      .filter(Boolean)
      .join('\n');
    if (joined.trim()) {
      return joined.trim();
    }
  }

  if (Array.isArray(completion?.output)) {
    const textParts: string[] = [];
    for (const item of completion.output) {
      if (!item) continue;
      const content = item.content;
      if (typeof content === 'string' && content.trim()) {
        textParts.push(content.trim());
        continue;
      }
      if (Array.isArray(content)) {
        for (const part of content) {
          if (!part) continue;
          if (typeof part === 'string' && part.trim()) {
            textParts.push(part.trim());
          } else if (typeof part?.text === 'string' && part.text.trim()) {
            textParts.push(part.text.trim());
          } else if (typeof part?.content === 'string' && part.content.trim()) {
            textParts.push(part.content.trim());
          }
        }
      }
    }
    const combinedOutput = textParts.join('\n').trim();
    if (combinedOutput) {
      return combinedOutput;
    }
  }

  if (typeof completion?.message?.content === 'string') {
    const content = completion.message.content.trim();
    if (content) {
      return content;
    }
  }

  if (Array.isArray(completion?.messages)) {
    for (const msg of completion.messages) {
      if (!msg || msg.role !== 'assistant') continue;
      if (typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content.trim();
      }
      if (Array.isArray(msg.content)) {
        const combined = msg.content
          .map((part: any) => {
            if (!part) return '';
            if (typeof part === 'string') return part;
            if (typeof part?.text === 'string') return part.text;
            if (typeof part?.content === 'string') return part.content;
            return '';
          })
          .join('')
          .trim();
        if (combined) {
          return combined;
        }
      }
    }
  }

  if (typeof completion?.content === 'string' && completion.content.trim()) {
    return completion.content.trim();
  }

  return null;
}

export async function callAIModel({
  messages,
  model = AI_MODELS.GPT,
  reasoning,
  signal,
  operationId,
  retryAttempts = 3,
}: {
  messages: any[];
  model?: string;
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
  };
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  log.debug(
    `[${operationId}] Using ${getActiveProvider()} provider for translation`
  );

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;

    try {
      // Check if operation was cancelled
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const completion = await translateAi({
        messages,
        model,
        reasoning,
        signal,
      });
      const content = extractContentFromCompletion(completion);

      if (content && content.trim()) {
        return content;
      }

      const completionKeys =
        completion && typeof completion === 'object'
          ? Object.keys(completion)
          : null;

      log.error(
        `[${operationId}] Unable to extract content from Stage5 response`,
        {
          type: typeof completion,
          hasChoices: Array.isArray(completion?.choices),
          hasOutputText: typeof completion?.output_text,
          keys: completionKeys,
        }
      );

      throw new Error('Unexpected response format from Stage5 API.');
    } catch (error: any) {
      if (signal?.aborted || error?.name === 'AbortError') {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      // Retry on transient errors (timeouts, rate limits, server errors, connection resets)
      const isTransientStatus =
        !!error?.response && [429, 500, 503].includes(error.response.status);
      const msg: string = String(error?.message || '');
      const code: string = String(error?.code || '');
      const isTransientCode =
        code === 'ECONNRESET' ||
        code === 'ECONNABORTED' ||
        code === 'ETIMEDOUT';
      const isTransientMsg =
        msg.includes('timeout') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNABORTED');

      if (isTransientStatus || isTransientCode || isTransientMsg) {
        if (currentAttempt < retryAttempts) {
          const delay = 1000 * Math.pow(2, currentAttempt);
          log.debug(
            `[${operationId}] Transient error (${code || msg}). Retrying in ${delay}ms (attempt ${currentAttempt}/${retryAttempts})`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Handle specific error cases
      if (error?.message === 'insufficient-credits') {
        // Preserve the specific error so the renderer can show a credit-ran-out modal,
        // while the main handler still treats it as a cancellation for UX.
        throw new Error('insufficient-credits');
      }

      throw new Error(
        `Stage5 API call failed: ${error?.message || String(error)}`
      );
    }
  }

  throw new Error(`Stage5 API call failed after ${retryAttempts} attempts.`);
}

// Utility function for file operations (still needed by some legacy code)
export function createFileFromPath(filePath: string) {
  try {
    return fs.createReadStream(filePath);
  } catch (e) {
    throw new SubtitleProcessingError(`File stream error: ${e}`);
  }
}
