import { ERROR_CODES } from '../../shared/constants';
import { i18n } from '../i18n';
import { getByoErrorMessage, isByoError } from './byoErrors';

export function getTranslationFailureMessage({
  error,
  cancelled,
}: {
  error?: string;
  cancelled?: boolean;
}): string {
  const message = String(error ?? '').trim();

  if (message.includes(ERROR_CODES.INSUFFICIENT_CREDITS)) {
    return i18n.t('dialogs.creditRanOut.message');
  }

  if (
    isByoError(message) ||
    /insufficient_quota|openai|anthropic|elevenlabs/i.test(message)
  ) {
    return getByoErrorMessage(message);
  }

  if (!message) {
    return cancelled
      ? i18n.t('generateSubtitles.status.cancelled')
      : i18n.t('generateSubtitles.status.error');
  }

  return message;
}

export function shouldSurfaceTranslationFailure({
  error,
  cancelled,
}: {
  error?: string;
  cancelled?: boolean;
}): boolean {
  if (!cancelled) return true;
  return Boolean(String(error ?? '').trim());
}
