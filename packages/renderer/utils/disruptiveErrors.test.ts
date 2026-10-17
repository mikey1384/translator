import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isAbortLikeReason,
  shouldReportUnhandledRejection,
} from './disruptiveErrors';

test('stray credit, network and API-key rejections never open the report dialog', () => {
  for (const reason of [
    new Error(
      "Error invoking remote method 'generate-transcript-summary': Error: insufficient-credits"
    ),
    new Error('openai-key-invalid'),
    new Error('getaddrinfo ENOTFOUND api.stage5.tools'),
    'insufficient-credits',
  ]) {
    assert.equal(shouldReportUnhandledRejection(reason), false, String(reason));
  }
});

test('genuine crashes still open the report dialog', () => {
  assert.equal(
    shouldReportUnhandledRejection(
      new TypeError("Cannot read properties of undefined (reading 'x')")
    ),
    true
  );
});

test('aborts are never reported', () => {
  assert.equal(
    isAbortLikeReason(new DOMException('stopped', 'AbortError')),
    true
  );
  assert.equal(shouldReportUnhandledRejection('Operation cancelled'), false);
});
