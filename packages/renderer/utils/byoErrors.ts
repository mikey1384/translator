import { ERROR_CODES } from '../../shared/constants';
import { i18n } from '../i18n';

/**
 * Maps error codes to user-friendly localized messages.
 * Used for BYO API key errors (invalid, rate limit, insufficient quota).
 */

type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

const ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  [ERROR_CODES.OPENAI_KEY_INVALID]: 'errors.byo.openaiKeyInvalid',
  [ERROR_CODES.OPENAI_RATE_LIMIT]: 'errors.byo.openaiRateLimit',
  [ERROR_CODES.OPENAI_INSUFFICIENT_QUOTA]:
    'errors.byo.openaiInsufficientQuota',
  [ERROR_CODES.ANTHROPIC_KEY_INVALID]: 'errors.byo.anthropicKeyInvalid',
  [ERROR_CODES.ANTHROPIC_RATE_LIMIT]: 'errors.byo.anthropicRateLimit',
  [ERROR_CODES.ANTHROPIC_INSUFFICIENT_QUOTA]:
    'errors.byo.anthropicInsufficientQuota',
  [ERROR_CODES.ELEVENLABS_KEY_INVALID]: 'errors.byo.elevenlabsKeyInvalid',
  [ERROR_CODES.ELEVENLABS_RATE_LIMIT]: 'errors.byo.elevenlabsRateLimit',
  [ERROR_CODES.ELEVENLABS_INSUFFICIENT_QUOTA]:
    'errors.byo.elevenlabsInsufficientQuota',
};

/**
 * Check if an error message contains a known BYO error code.
 */
export function isByoError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  return Object.keys(ERROR_CODE_TO_I18N_KEY).some(code =>
    errorMessage.includes(code)
  );
}

/**
 * Extract the BYO error code from an error message.
 */
export function extractByoErrorCode(
  errorMessage: string | undefined
): ErrorCode | null {
  if (!errorMessage) return null;
  for (const code of Object.keys(ERROR_CODE_TO_I18N_KEY)) {
    if (errorMessage.includes(code)) {
      return code as ErrorCode;
    }
  }
  return null;
}

/**
 * Get a user-friendly localized error message for a BYO error.
 * Returns the original message if it's not a known BYO error.
 */
export function getByoErrorMessage(errorMessage: string | undefined): string {
  if (!errorMessage) return i18n.t('errors.byo.genericApiError');

  const code = extractByoErrorCode(errorMessage);
  if (code && ERROR_CODE_TO_I18N_KEY[code]) {
    return i18n.t(ERROR_CODE_TO_I18N_KEY[code]);
  }

  // Check for common API error patterns not covered by specific codes
  if (
    errorMessage.includes('insufficient_quota') ||
    errorMessage.includes('insufficient credits')
  ) {
    // Try to determine which provider based on context
    if (errorMessage.toLowerCase().includes('openai')) {
      return i18n.t('errors.byo.openaiInsufficientQuota');
    }
    if (errorMessage.toLowerCase().includes('anthropic')) {
      return i18n.t('errors.byo.anthropicInsufficientQuota');
    }
    if (errorMessage.toLowerCase().includes('elevenlabs')) {
      return i18n.t('errors.byo.elevenlabsInsufficientQuota');
    }
  }

  // Return original message if not a known BYO error
  return errorMessage;
}

/**
 * Determine which provider the error is related to.
 */
export function getByoErrorProvider(
  errorMessage: string | undefined
): 'openai' | 'anthropic' | 'elevenlabs' | null {
  if (!errorMessage) return null;

  if (
    errorMessage.includes(ERROR_CODES.OPENAI_KEY_INVALID) ||
    errorMessage.includes(ERROR_CODES.OPENAI_RATE_LIMIT) ||
    errorMessage.toLowerCase().includes('openai')
  ) {
    return 'openai';
  }

  if (
    errorMessage.includes(ERROR_CODES.ANTHROPIC_KEY_INVALID) ||
    errorMessage.includes(ERROR_CODES.ANTHROPIC_RATE_LIMIT) ||
    errorMessage.toLowerCase().includes('anthropic')
  ) {
    return 'anthropic';
  }

  if (
    errorMessage.includes(ERROR_CODES.ELEVENLABS_KEY_INVALID) ||
    errorMessage.includes(ERROR_CODES.ELEVENLABS_RATE_LIMIT) ||
    errorMessage.toLowerCase().includes('elevenlabs')
  ) {
    return 'elevenlabs';
  }

  return null;
}
