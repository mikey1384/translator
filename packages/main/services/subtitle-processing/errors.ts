export class SubtitleProcessingError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SubtitleProcessingError';
  }
}

import {
  WIRE_TOO_MANY_ACTIVE_TRANSLATIONS,
  WIRE_TRANSLATION_RATE_LIMIT,
  WIRE_TRANSLATION_QUEUE_OVERLOADED,
} from '../../../shared/constants/wire-protocol.js';
import { ERROR_CODES } from '../../../shared/constants/index.js';

/**
 * True for Stage5 translation admission rejections: HTTP 429 from the job
 * endpoint (per-device active-job cap or short-window rate limit) or 503
 * (global backlog). These are retryable — the same request succeeds once a
 * slot frees — so they must never be silently replaced with source text.
 */
export function isTranslationAdmissionLimitError(err: unknown): boolean {
  const anyErr = err as any;
  const marker = anyErr?.response?.data?.error;
  if (
    (anyErr?.response?.status === 429 &&
      (marker === WIRE_TOO_MANY_ACTIVE_TRANSLATIONS ||
        marker === WIRE_TRANSLATION_RATE_LIMIT)) ||
    (anyErr?.response?.status === 503 &&
      marker === WIRE_TRANSLATION_QUEUE_OVERLOADED)
  ) {
    return true;
  }
  const msg = String(anyErr?.message || err || '');
  return (
    msg.includes(WIRE_TOO_MANY_ACTIVE_TRANSLATIONS) ||
    msg.includes(WIRE_TRANSLATION_RATE_LIMIT) ||
    msg.includes(WIRE_TRANSLATION_QUEUE_OVERLOADED)
  );
}

/**
 * True for BYO provider rate limits (OpenAI/Anthropic 429s mapped to error
 * codes). Like admission limits, these clear with time: under concurrency
 * they should defer to the serial phase and retry with a delay rather than
 * abort a translation that the old sequential loop would have completed.
 */
export function isProviderRateLimitError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return (
    msg.includes(ERROR_CODES.OPENAI_RATE_LIMIT) ||
    msg.includes(ERROR_CODES.ANTHROPIC_RATE_LIMIT)
  );
}

/**
 * Normalize an admission-limit error to the shape the retry pool expects:
 * marker in `message`, server `retryAfterSec` preserved when known. An
 * error whose message already carries the marker (crafted upstream by
 * stage5-client, possibly with retryAfterSec attached) is returned as-is;
 * an axios-shaped error gets the marker copied from response.data.error
 * and retryAfterSec parsed from its Retry-After header.
 */
export function toAdmissionMarkerError(err: unknown): Error {
  const anyErr = err as any;
  const msg = String(anyErr?.message || '');
  const messageCarriesMarker =
    msg.includes(WIRE_TOO_MANY_ACTIVE_TRANSLATIONS) ||
    msg.includes(WIRE_TRANSLATION_RATE_LIMIT) ||
    msg.includes(WIRE_TRANSLATION_QUEUE_OVERLOADED);
  if (err instanceof Error && messageCarriesMarker) {
    return err;
  }

  const marker = String(
    anyErr?.response?.data?.error || WIRE_TOO_MANY_ACTIVE_TRANSLATIONS
  );
  const admissionError = new Error(marker);
  const retryAfterSec = Number(
    anyErr?.retryAfterSec ?? anyErr?.response?.headers?.['retry-after']
  );
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    (admissionError as any).retryAfterSec = retryAfterSec;
  }
  return admissionError;
}
