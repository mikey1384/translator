import {
  classifyError,
  formatUserFacingError,
  type ErrorInput,
} from './userFacingError';

type Translate = (key: string, options?: Record<string, unknown>) => string;

// Codes whose wording now talks in minutes (the unit users buy) use a new
// key so older "credits" translations aren't shown for the new text.
const TRANSFER_ERROR_KEYS: Record<string, string> = {
  nothing_to_transfer: 'nothing_to_transfer_minutes',
  transfer_failed: 'transfer_failed_minutes',
};

const TRANSFER_ERRORS: Record<string, string> = {
  nothing_to_transfer:
    'Nothing to move yet: this computer has no purchased minutes or API-key unlock. To bring minutes here from another computer, choose “Receive minutes”.',
  too_many_codes:
    'Too many transfer codes this hour. Try again in a little while.',
  jobs_running:
    'A transcription or translation is still running. Try again when it finishes.',
  invalid_code:
    'That code is wrong, already used or expired. Make a new one on the other computer.',
  same_device:
    'Enter the code on the other computer, not the one that made it.',
  network_error:
    'Couldn’t reach the Stage5 server. Check your connection and try again.',
  transfer_failed:
    'The minutes couldn’t be moved. Check your connection and try again.',
};

/** "Nothing to move" is an expected state, not a failure: show it neutrally. */
export function isNothingToTransfer(
  result: { error?: unknown } | null | undefined
): boolean {
  return result?.error === 'nothing_to_transfer';
}

/**
 * The credit-transfer result carries a stable `error` code; the server's
 * English `message` stays in logs. Unknown codes get the generic failure.
 */
export function creditTransferErrorMessage(
  result: { error?: unknown } | null | undefined,
  t: Translate
): string {
  const code = typeof result?.error === 'string' ? result.error : '';
  const known = Object.prototype.hasOwnProperty.call(TRANSFER_ERRORS, code)
    ? code
    : 'transfer_failed';
  const key = TRANSFER_ERROR_KEYS[known] ?? known;
  return t(`settings.creditTransfer.errors.${key}`, {
    defaultValue: TRANSFER_ERRORS[known],
  });
}

/** A thrown IPC error (no result object) in the UI language. */
export function creditTransferThrownMessage(
  error: ErrorInput,
  t: Translate
): string {
  const classified = classifyError(error, { task: 'other' });
  if (classified.kind === 'unexpected') {
    return creditTransferErrorMessage({ error: 'transfer_failed' }, t);
  }
  return formatUserFacingError(classified, t);
}
