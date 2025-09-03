import { SubtitleProcessingError } from './errors.js';
import fs from 'fs';
import * as stage5Client from '../stage5-client.js';
import log from 'electron-log';
import { AI_MODELS } from '../../../shared/constants/index.js';

export async function callAIModel({
  messages,
  model = AI_MODELS.GPT,
  signal,
  operationId,
  retryAttempts = 3,
}: {
  messages: any[];
  model?: string;
  signal?: AbortSignal;
  operationId: string;
  retryAttempts?: number;
}): Promise<string> {
  log.debug(`[${operationId}] Using Stage5 API for translation`);

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;

    try {
      // Check if operation was cancelled
      if (signal?.aborted) {
        throw new DOMException('Operation cancelled', 'AbortError');
      }

      const completion = await stage5Client.translate({
        messages,
        model,
        signal,
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        return content;
      } else {
        throw new Error('Unexpected response format from Stage5 API.');
      }
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
