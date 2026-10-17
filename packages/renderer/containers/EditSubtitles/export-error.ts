import type { TFunction } from 'i18next';
import { ERROR_CODES } from '../../../shared/constants';

/**
 * The main process reports export failures as codes or raw English. Turn
 * them into a sentence in the UI language; raw text never reaches the user
 * (it stays in the logs).
 */
export function exportErrorMessage(
  error: string,
  t: TFunction,
  sourceVideo: {
    isUnavailable: (message: string) => boolean;
    message: () => string;
  }
): string {
  const text = String(error || '');
  if (
    text === ERROR_CODES.INSUFFICIENT_DISK_SPACE ||
    /\bENOSPC\b|no space left on device|disk quota exceeded/i.test(text)
  ) {
    return t('common.error.insufficientDiskSpace');
  }
  if (sourceVideo.isUnavailable(text)) return sourceVideo.message();
  if (
    /\bE(ACCES|PERM|ROFS)\b|permission denied|operation not permitted/i.test(
      text
    )
  ) {
    return t(
      'export.error.permission',
      'Translator couldn’t write the video’s working files. Check that your account can write to the temporary folder, then try again.'
    );
  }
  if (
    /export tools could not be downloaded|render-tools|chrome|chromium|puppeteer/i.test(
      text
    )
  ) {
    return t(
      'export.error.tools',
      'The video export tools couldn’t be set up. Check your internet connection and try again.'
    );
  }
  return t(
    'export.error.generic',
    'Something went wrong while making the video. Please try again.'
  );
}
