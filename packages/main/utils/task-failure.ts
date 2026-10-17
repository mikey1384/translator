import { ERROR_CODES } from '../../shared/constants/index.js';

export type TaskFailure = {
  /** The server refused the job for credits. Never a cancellation. */
  insufficientCredits: boolean;
  /** The user (or a closed tab) stopped the job. */
  cancelled: boolean;
  /** Final progress stage, as an i18n token the renderer translates. */
  stage:
    | '__i18n__:insufficient_credits'
    | '__i18n__:process_cancelled'
    | '__i18n__:error';
  /** Code or log message for the final packet and IPC result; none on cancel. */
  error: string | undefined;
};

/**
 * One reading of a failed paid task for every subtitle/dub handler, so a
 * credit refusal is never reported as "cancelled" and no handler sends an
 * English "Error: …" stage to the UI.
 */
export function describeTaskFailure(
  error: unknown,
  options: { aborted?: boolean } = {}
): TaskFailure {
  const anyErr = error as any;
  const message = String(anyErr?.message ?? (error == null ? '' : error));
  const cancelled =
    options.aborted === true ||
    anyErr?.name === 'AbortError' ||
    message === 'Operation cancelled';
  const insufficientCredits =
    !cancelled &&
    (message.includes(ERROR_CODES.INSUFFICIENT_CREDITS) ||
      anyErr?.response?.status === 402 ||
      anyErr?.status === 402);

  if (insufficientCredits) {
    return {
      insufficientCredits: true,
      cancelled: false,
      stage: '__i18n__:insufficient_credits',
      error: ERROR_CODES.INSUFFICIENT_CREDITS,
    };
  }
  if (cancelled) {
    return {
      insufficientCredits: false,
      cancelled: true,
      stage: '__i18n__:process_cancelled',
      error: undefined,
    };
  }
  return {
    insufficientCredits: false,
    cancelled: false,
    stage: '__i18n__:error',
    error: message || 'Unknown error',
  };
}
