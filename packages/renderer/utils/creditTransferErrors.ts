import {
  classifyError,
  formatUserFacingError,
  type ErrorInput,
} from './userFacingError';

type Translate = (key: string, options?: Record<string, unknown>) => string;

const TRANSFER_ERRORS: Record<string, string> = {
  nothing_to_transfer:
    'Nothing to move yet: this computer has no purchased credits or API-key unlock. To bring credits here from another computer, choose “Receive credits”.',
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
    'The credits couldn’t be moved. Check your connection and try again.',
};

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
  return t(`settings.creditTransfer.errors.${known}`, {
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
