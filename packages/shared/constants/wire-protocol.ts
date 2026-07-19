/**
 * Stage5 wire protocol — error markers, status codes, and headers that cross
 * service boundaries (stage5-api <-> openai-relay <-> translator).
 *
 * CANONICAL COPY: stage5-api/src/shared/wire-protocol.ts
 * Copies:         translator/packages/shared/constants/wire-protocol.ts   <- this file
 *                 openai-relay/relay/wire-protocol.ts
 *
 * Each consumer repo has a drift test that parses the exported name/value
 * pairs of its copy and compares them against this file when the sibling
 * checkout exists. Change this file first, then sync the copies; a drift
 * test failure means a consumer no longer speaks the deployed protocol.
 * Formatting and quote style may differ between copies; names and values
 * may not.
 */

// --- Translation admission (stage5-api POST /translate) -------------------
// 429 with these markers is deterministic-retryable: the same request
// succeeds once a slot frees. Rejections include a Retry-After header
// (seconds). 503 with the overload marker is a global backlog signal.
export const WIRE_TOO_MANY_ACTIVE_TRANSLATIONS = 'too-many-active-translations';
export const WIRE_TRANSLATION_RATE_LIMIT = 'translation-rate-limit';
export const WIRE_TRANSLATION_QUEUE_OVERLOADED = 'translation-queue-overloaded';
export const WIRE_ADMISSION_RETRY_AFTER_DEFAULT_SEC = 10;

// --- Billing --------------------------------------------------------------
// HTTP 402 anywhere in the stack means the device is out of credits.
export const WIRE_STATUS_INSUFFICIENT_CREDITS = 402;
export const WIRE_INSUFFICIENT_CREDITS = 'insufficient-credits';

// --- App version gate (HTTP 426) ------------------------------------------
export const WIRE_STATUS_UPDATE_REQUIRED = 426;
export const WIRE_UPDATE_REQUIRED = 'update-required';
export const WIRE_APP_VERSION_HEADER = 'X-Stage5-App-Version';
