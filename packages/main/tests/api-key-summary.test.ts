import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStoredApiKey } from '../utils/api-key-summary.js';

test('only presence and the last 4 characters leave main', () => {
  assert.deepEqual(summarizeStoredApiKey('sk-proj-abcdefghijklmnop1234'), {
    present: true,
    last4: '1234',
  });
  assert.deepEqual(summarizeStoredApiKey(null), {
    present: false,
    last4: null,
  });
  assert.deepEqual(summarizeStoredApiKey('   '), {
    present: false,
    last4: null,
  });
  assert.deepEqual(summarizeStoredApiKey('short'), {
    present: true,
    last4: null,
  });
});
