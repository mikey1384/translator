import { isExplicitCancellation } from '../../shared/cancelled-error.js';
import { ERROR_CODES } from '../../shared/constants/index.js';

export type NormalizedRenderFailure = {
  error: string;
  cancelled?: boolean;
};

export function normalizeRenderFailure(
  error: unknown,
  signal?: AbortSignal
): NormalizedRenderFailure {
  if (isExplicitCancellation(error, signal)) {
    return { error: 'Cancelled', cancelled: true };
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'error' in error
          ? String((error as { error?: unknown }).error)
          : error == null
            ? ''
            : String(error);
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';

  const isDiskFull =
    message === ERROR_CODES.INSUFFICIENT_DISK_SPACE ||
    code === 'ENOSPC' ||
    /\bENOSPC\b/i.test(message) ||
    /no space left on device/i.test(message) ||
    /disk quota exceeded/i.test(message);

  return {
    error: isDiskFull
      ? ERROR_CODES.INSUFFICIENT_DISK_SPACE
      : message || 'Unknown error',
  };
}
