import { ERROR_CODES } from '../../shared/constants';
import { i18n } from '../i18n';

export function getSourceVideoUnavailableMessage(): string {
  return i18n.t(
    'common.error.sourceVideoUnavailable',
    'The original video was removed or is no longer accessible. Open it again and try again.'
  );
}

export function isSourceVideoUnavailableError(
  errorMessage: string | null | undefined
): boolean {
  return String(errorMessage || '').includes(
    ERROR_CODES.SOURCE_VIDEO_UNAVAILABLE
  );
}

export function getSourceVideoErrorMessage(
  errorMessage: string | null | undefined
): string {
  if (isSourceVideoUnavailableError(errorMessage)) {
    return getSourceVideoUnavailableMessage();
  }
  return '';
}

export async function isSourceVideoPathAccessible(
  path: string | null | undefined
): Promise<boolean> {
  const trimmed = String(path || '').trim();
  if (!trimmed) {
    return false;
  }

  try {
    return await window.fileApi.fileExists(trimmed);
  } catch {
    return false;
  }
}
