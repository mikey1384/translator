import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldSendProductAnalytics } from '../services/product-analytics-policy';

test('sends product analytics only from packaged release builds', () => {
  assert.equal(
    shouldSendProductAnalytics({ isPackaged: true, appVersion: '1.16.12' }),
    true
  );
  assert.equal(
    shouldSendProductAnalytics({
      isPackaged: true,
      appVersion: '2.0.0-beta.1',
    }),
    true
  );
  assert.equal(
    shouldSendProductAnalytics({ isPackaged: false, appVersion: '1.16.12' }),
    false
  );
});

test('rejects development and malformed app versions', () => {
  for (const appVersion of ['0.0.0', '', 'dev', '1.16']) {
    assert.equal(
      shouldSendProductAnalytics({ isPackaged: true, appVersion }),
      false,
      appVersion
    );
  }
});
