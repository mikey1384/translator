// Keep retry classification separate from Electron-bound client code so the
// default Node test runner can import it directly.
function getRelayErrorMessage(error: any): string | null {
  const payload = error?.response?.data;
  if (!payload || typeof payload !== 'object') return null;

  const base = typeof payload.error === 'string' ? payload.error.trim() : '';
  const details =
    typeof payload.details === 'string'
      ? payload.details.trim()
      : typeof payload.message === 'string'
        ? payload.message.trim()
        : '';

  if (base && details) return `${base}: ${details}`;
  return base || details || null;
}

const RETRYABLE_DUB_DIRECT_STATUSES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504, 522, 524,
]);
const RETRYABLE_DUB_DIRECT_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_NETWORK',
  'ETIMEDOUT',
]);
const RETRYABLE_DUB_DIRECT_MESSAGE_PATTERN =
  /(request cancelled|timeout|timed out|temporarily unavailable|connection reset|fetch failed|gateway|rate limit|socket hang up)/i;

function getRelayStatus(error: any): number | null {
  const status = error?.response?.status ?? error?.status;
  return typeof status === 'number' ? status : null;
}

function isRetryableDubDirectError(error: any): boolean {
  const status = getRelayStatus(error);
  if (status != null && status >= 200 && status < 400) {
    return false;
  }
  if (status != null && RETRYABLE_DUB_DIRECT_STATUSES.has(status)) {
    return true;
  }

  const code = String(error?.code ?? '').toUpperCase();
  if (code && RETRYABLE_DUB_DIRECT_CODES.has(code)) {
    return true;
  }

  const message = getRelayErrorMessage(error) || String(error?.message ?? '');
  if (RETRYABLE_DUB_DIRECT_MESSAGE_PATTERN.test(message)) {
    return true;
  }

  return Boolean(error?.request) && !error?.response;
}

function shouldRetryDubDirectRequest(args: {
  error: any;
  attempt: number;
  maxAttempts: number;
  hasIdempotencyKey: boolean;
}): boolean {
  const { error, attempt, maxAttempts, hasIdempotencyKey } = args;
  if (!hasIdempotencyKey) {
    return false;
  }
  if (attempt >= maxAttempts) {
    return false;
  }
  return isRetryableDubDirectError(error);
}

export {
  getRelayErrorMessage,
  getRelayStatus,
  isRetryableDubDirectError,
  shouldRetryDubDirectRequest,
};
