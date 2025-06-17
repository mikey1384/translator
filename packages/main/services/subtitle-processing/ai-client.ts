import { SubtitleProcessingError } from './errors.js';
import fs from 'fs';
import * as stage5Client from '../stage5-client.js';
import log from 'electron-log';
import { AI_MODELS } from '../../../shared/constants/index.js';

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
  log.debug(`[${operationId}] Using Stage5 API for translation`);

  let currentAttempt = 0;
  while (currentAttempt < retryAttempts) {
    currentAttempt++;

    try {
      // Check if operation was cancelled
      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }

      const completion = await stage5Client.translate({
        messages,
        model: AI_MODELS.GPT,
        temperature: 0.4,
        signal,
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        return content;
      } else {
        throw new Error('Unexpected response format from Stage5 API.');
      }
    } catch (error: any) {
      if (signal?.aborted || error.name === 'AbortError') {
        throw new Error('Operation cancelled');
      }

      // Retry on certain errors
      if (
        (error.message && error.message.includes('timeout')) ||
        (error.response && [429, 500, 503].includes(error.response.status))
      ) {
        if (currentAttempt < retryAttempts) {
          const delay = 1000 * Math.pow(2, currentAttempt);
          log.debug(
            `[${operationId}] Retrying in ${delay}ms (attempt ${currentAttempt}/${retryAttempts})`
          );
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // Handle specific error cases
      if (error.message === 'insufficient-credits') {
        throw new SubtitleProcessingError(
          'Insufficient credits. Please purchase more credits to continue.'
        );
      }

      throw new Error(
        `Stage5 API call failed: ${error.message || String(error)}`
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
