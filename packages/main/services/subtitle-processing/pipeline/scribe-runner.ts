/**
 * Transcription is ElevenLabs Scribe only (OpenAI whisper-1 retires
 * 2027-02-26 and its replacement returns no timestamps, so it cannot make
 * subtitles). This module holds the route choice and the retry policy so
 * they can be tested without Electron; transcribe-pass.ts wires them to the
 * real providers.
 */
import { SubtitleProcessingError } from '../errors.js';
import { ERROR_CODES } from '../../../../shared/constants/index.js';
import {
  STAGE5_TRANSCRIPTION_DIRECT_MAX_DURATION_SEC,
  STAGE5_TRANSCRIPTION_DIRECT_MAX_MB,
  STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
  STAGE5_TRANSCRIPTION_MAX_UPLOAD_MB,
} from '../../../../shared/constants/transcription-limits.js';
import { formatTranscriptionFailure } from '../../../../shared/helpers/transcription-route.js';

export const SCRIBE_MAX_ATTEMPTS = 3;
const SCRIBE_RETRY_BASE_DELAY_MS = 2000;
const SCRIBE_RETRY_MAX_DELAY_MS = 10000;

/**
 * - byo-elevenlabs: the user's ElevenLabs key, direct to ElevenLabs
 * - stage5-direct: Stage5 credits, direct relay (small and short audio)
 * - stage5-r2: Stage5 credits, durable R2 upload (large or long audio)
 * - stage5-too-large: over the R2 upload limit; the user must split the video
 *
 * Chosen only by route, size and duration; never by any quality setting.
 */
export type ScribeRoute =
  | 'byo-elevenlabs'
  | 'stage5-direct'
  | 'stage5-r2'
  | 'stage5-too-large';

export function chooseScribeRoute({
  useByoElevenLabs,
  fileSizeMB,
  durationSec,
}: {
  useByoElevenLabs: boolean;
  fileSizeMB: number;
  durationSec: number;
}): ScribeRoute {
  if (useByoElevenLabs) return 'byo-elevenlabs';
  if (fileSizeMB > STAGE5_TRANSCRIPTION_MAX_UPLOAD_MB) {
    return 'stage5-too-large';
  }
  if (
    fileSizeMB < STAGE5_TRANSCRIPTION_DIRECT_MAX_MB &&
    durationSec <= STAGE5_TRANSCRIPTION_DIRECT_MAX_DURATION_SEC
  ) {
    return 'stage5-direct';
  }
  return 'stage5-r2';
}

export function transcriptionTooLargeError(): SubtitleProcessingError {
  return new SubtitleProcessingError(
    formatTranscriptionFailure(ERROR_CODES.TRANSCRIPTION_FILE_TOO_LARGE, {
      maxHours: STAGE5_TRANSCRIPTION_MAX_AUDIO_HOURS,
    })
  );
}

export function isCancellationError(error: any, signal?: AbortSignal) {
  return (
    error?.name === 'AbortError' ||
    error?.message === 'Cancelled' ||
    Boolean(signal?.aborted)
  );
}

/**
 * Check if an error is a transient network error that should be retried.
 * Includes DNS failures, connection resets, timeouts, and temporary server
 * errors. A mapped Stage5 'transcription-provider-unavailable' error is not
 * transient here: the server already retried Scribe before answering 502.
 */
export function isTransientNetworkError(error: any): boolean {
  if (!error) return false;

  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toUpperCase();

  // DNS resolution failures
  if (message.includes('enotfound') || message.includes('getaddrinfo')) {
    return true;
  }

  // Connection errors
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'ERR_NETWORK'
  ) {
    return true;
  }

  // Network-related error messages
  if (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('connection reset') ||
    message.includes('socket hang up') ||
    message.includes('econnreset') ||
    message.includes('etimedout')
  ) {
    return true;
  }

  // HTTP 5xx errors (server-side transient issues)
  const status = error?.status || error?.response?.status;
  if (typeof status === 'number' && status >= 500 && status < 600) {
    return true;
  }

  // Rate limiting (can retry after delay)
  if (status === 429) {
    return true;
  }

  return false;
}

export function scribeRetryDelayMs(attempt: number): number {
  return Math.min(
    SCRIBE_RETRY_MAX_DELAY_MS,
    SCRIBE_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1)
  );
}

/**
 * Run one Scribe route with the transient-error retry loop. There is no
 * Whisper fallback: non-transient errors (no credits, BYO key problems,
 * provider unavailable after server retries, update required, durable-job
 * detach/restart signals) are rethrown unchanged, and transient errors that
 * outlast every attempt fail the job with a clear provider-unavailable error.
 */
export async function runScribeWithRetries<T>({
  run,
  signal,
  label,
  onRetry,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log,
  maxAttempts = SCRIBE_MAX_ATTEMPTS,
}: {
  run: (attempt: number) => Promise<T>;
  signal?: AbortSignal;
  label: string;
  onRetry?: (attempt: number, maxAttempts: number) => void;
  sleep?: (ms: number) => Promise<void>;
  log?: { info: (msg: string) => void; warn: (msg: string) => void };
  maxAttempts?: number;
}): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    try {
      return await run(attempt);
    } catch (error: any) {
      if (isCancellationError(error, signal)) throw error;
      if (
        error?.code === 'DURABLE_TRANSCRIPTION_DETACHED' ||
        error?.code === 'DURABLE_TRANSCRIPTION_RESTART_REQUIRED'
      ) {
        throw error;
      }

      const errorMsg = error?.message || String(error);
      if (!isTransientNetworkError(error)) {
        log?.warn(`${label} failed (not retryable): ${errorMsg}`);
        throw error;
      }

      if (attempt < maxAttempts) {
        const delay = scribeRetryDelayMs(attempt);
        log?.info(
          `${label} attempt ${attempt}/${maxAttempts} failed (${errorMsg}), retrying in ${delay}ms...`
        );
        onRetry?.(attempt, maxAttempts);
        await sleep(delay);
        continue;
      }

      log?.warn(`${label} failed after ${maxAttempts} attempts: ${errorMsg}`);
      throw new SubtitleProcessingError(
        formatTranscriptionFailure(
          ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE
        )
      );
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new SubtitleProcessingError(
    formatTranscriptionFailure(ERROR_CODES.TRANSCRIPTION_PROVIDER_UNAVAILABLE)
  );
}
