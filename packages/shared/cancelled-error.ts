export class CancelledError extends Error {
  public readonly isCancelled = true;
  constructor() {
    super('Cancelled by user');
    this.name = 'CancelledError';
  }
}

const EXACT_CANCELLATION_MESSAGES = new Set([
  'cancelled',
  'canceled',
  'cancelled by user',
  'canceled by user',
  'operation cancelled',
  'operation canceled',
  'operation cancelled by user',
  'operation canceled by user',
  'process cancelled',
  'process canceled',
]);

/** Identify cancellation from explicit state, error identity, or exact codes. */
export function isExplicitCancellation(
  error: unknown,
  signal?: AbortSignal
): boolean {
  if (signal?.aborted || error instanceof CancelledError) return true;
  if (typeof error === 'string') {
    return EXACT_CANCELLATION_MESSAGES.has(error.trim().toLowerCase());
  }
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    cancelled?: unknown;
    isCancelled?: unknown;
    name?: unknown;
    code?: unknown;
    message?: unknown;
  };
  if (candidate.cancelled === true || candidate.isCancelled === true) {
    return true;
  }
  if (candidate.name === 'AbortError') return true;
  if (candidate.code === 'ABORT_ERR' || candidate.code === 'ERR_CANCELED') {
    return true;
  }
  return (
    typeof candidate.message === 'string' &&
    EXACT_CANCELLATION_MESSAGES.has(candidate.message.trim().toLowerCase())
  );
}
