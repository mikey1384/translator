import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyError,
  formatUserFacingError,
  isInsufficientCreditsError,
  localizeErrorOr,
  localizeErrorText,
  stripIpcErrorPrefix,
  taskForOperationId,
} from './userFacingError';
import { creditOfferBasis, creditRefusalForOperation } from './creditShortfall';
import {
  creditTransferErrorMessage,
  creditTransferThrownMessage,
} from './creditTransferErrors';

// Echoes the key so tests assert which translation was picked.
const t = ((key: string) => key) as any;

test('every shape of a credit refusal is recognized', () => {
  for (const input of [
    'insufficient-credits',
    "Error invoking remote method 'generate-transcript-summary': Error: insufficient-credits",
    new Error(
      "Error invoking remote method 'translate-subtitles': Error: insufficient-credits"
    ),
    { status: 402 },
    { response: { status: 402 } },
    { blockedReason: 'insufficient_credits' },
  ]) {
    assert.equal(isInsufficientCreditsError(input as any), true);
    const error = classifyError(input as any, { task: 'translation' });
    assert.equal(error.kind, 'insufficient-credits');
    assert.equal(error.retryable, false);
    assert.equal(error.report, 'none');
  }
});

test('a credit refusal is worded for the task, never as a cancellation', () => {
  assert.equal(
    classifyError('insufficient-credits', { task: 'dubbing' }).i18nKey,
    'errors.credits.dubbing'
  );
  assert.notEqual(
    classifyError({ error: 'insufficient-credits', cancelled: true } as any)
      .kind,
    'cancelled'
  );
});

test('the IPC wrapper never reaches the user', () => {
  assert.equal(
    stripIpcErrorPrefix(
      "Error invoking remote method 'x': Error: openai-key-invalid"
    ),
    'openai-key-invalid'
  );
  const error = classifyError(
    "Error invoking remote method 'x': Error: openai-key-invalid"
  );
  assert.equal(error.kind, 'api-key');
  assert.equal(error.i18nKey, 'errors.byo.openaiKeyInvalid');
});

test('cancellations, network, busy and server failures never auto-report', () => {
  assert.equal(classifyError('Operation cancelled').kind, 'cancelled');
  assert.equal(
    classifyError({ name: 'AbortError', message: 'x' } as any).kind,
    'cancelled'
  );
  assert.equal(classifyError('getaddrinfo ENOTFOUND api').kind, 'network');
  assert.equal(classifyError('too-many-active-translations').kind, 'busy');
  const server = classifyError('Request failed with status code 500', {
    task: 'translation',
  });
  assert.equal(server.kind, 'server');
  assert.equal(server.report, 'offer');
  assert.equal(server.i18nKey, 'errors.server.translation');
});

test('only unexplained failures open the report dialog, naming the task', () => {
  const error = classifyError('TypeError: x is undefined', {
    task: 'translation',
  });
  assert.equal(error.kind, 'unexpected');
  assert.equal(error.report, 'auto');
  assert.equal(error.i18nKey, 'errors.failed.translation');
  assert.equal(formatUserFacingError(error, t), 'errors.failed.translation');
});

test('download failures use main’s code, else its English message', () => {
  assert.equal(
    classifyError({ error: 'whatever', errorCode: 'unavailable' } as any)
      .i18nKey,
    'errors.download.unavailable'
  );
  const fromText = classifyError('This video is private.', {
    task: 'download',
  });
  assert.equal(fromText.code, 'private');
  assert.equal(fromText.report, 'none');
  const generic = classifyError(
    'Video download failed. Please try again or use a different URL.'
  );
  assert.equal(generic.code, 'generic');
  assert.equal(generic.report, 'auto');
  assert.equal(
    classifyError('Network error. Please check your internet connection.', {
      task: 'download',
    }).code,
    'network'
  );
});

test('the banner translates codes and main English, and keeps localized text', () => {
  assert.equal(
    localizeErrorText('insufficient-credits', t),
    'errors.credits.other'
  );
  assert.equal(
    localizeErrorText('This video is unavailable.', t),
    'errors.download.unavailable'
  );
  assert.equal(
    localizeErrorText('번역이 중단되었습니다.', t),
    '번역이 중단되었습니다.'
  );
  assert.equal(
    localizeErrorText('__i18n__:errors.network', t),
    'errors.network'
  );
});

test('raw provider text falls back to the caller’s localized message', () => {
  assert.equal(
    localizeErrorOr('401 Incorrect API key provided: sk-…', t, {
      key: 'settings.apiKey.invalid',
      defaultText: 'API key validation failed.',
    }),
    'settings.apiKey.invalid'
  );
  assert.equal(
    localizeErrorOr('fetch failed', t, {
      key: 'settings.apiKey.invalid',
      defaultText: '',
    }),
    'errors.network'
  );
});

test('operation ids map to the task the user started', () => {
  assert.equal(taskForOperationId('translate-dub-1-abc'), 'dubbing');
  assert.equal(taskForOperationId('agent-op-dub-translate-1'), 'dubbing');
  assert.equal(taskForOperationId('translate-missing-1'), 'translation');
  assert.equal(taskForOperationId('transcribe-1-tail'), 'transcription');
  assert.equal(taskForOperationId('agent-op-transcribe'), 'transcription');
  assert.equal(taskForOperationId('dub-1'), 'dubbing');
  assert.equal(taskForOperationId('summary-1'), 'summary');
  assert.equal(taskForOperationId('video-suggest-chat-1'), 'videoSearch');
  assert.equal(taskForOperationId('render-uuid'), 'export');
  assert.equal(creditRefusalForOperation('translate-dub-9').kind, 'dubbing');
  assert.equal(
    creditOfferBasis(creditRefusalForOperation('translate-dub-9')),
    'none'
  );
});

test('credit transfer errors come from the code, never the server sentence', () => {
  assert.equal(
    creditTransferErrorMessage(
      {
        error: 'nothing_to_transfer',
        message:
          'There are no purchased credits or unlocks on this device to move.',
      } as any,
      t
    ),
    'settings.creditTransfer.errors.nothing_to_transfer'
  );
  assert.equal(
    creditTransferErrorMessage({ error: 'something_new' }, t),
    'settings.creditTransfer.errors.transfer_failed'
  );
  assert.equal(
    creditTransferThrownMessage(new Error('fetch failed'), t),
    'errors.network'
  );
});
