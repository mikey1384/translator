import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffPromotedDownloadHistory } from '../../shared/helpers/url-download-history-handoff.js';

test('a stale operation rolls back history ownership after persistence', async () => {
  const calls: string[] = [];
  let stale = false;

  const result = await handoffPromotedDownloadHistory({
    persistHistory: async () => {
      calls.push('persist');
      stale = true;
    },
    isStale: () => stale,
    rollbackHistory: async () => {
      calls.push('rollback');
    },
    cleanupUnownedFile: async () => {
      calls.push('cleanup');
    },
  });

  assert.deepEqual(result, { status: 'stale' });
  assert.deepEqual(calls, ['persist', 'rollback']);
});

test('history persistence failure reclaims the unowned promoted file', async () => {
  const historyError = new Error('settings are unwritable');
  const calls: string[] = [];

  const result = await handoffPromotedDownloadHistory({
    persistHistory: async () => {
      calls.push('persist');
      throw historyError;
    },
    isStale: () => false,
    rollbackHistory: async () => {
      calls.push('rollback');
    },
    cleanupUnownedFile: async () => {
      calls.push('cleanup');
    },
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.status === 'failed' ? result.error : null, historyError);
  assert.deepEqual(calls, ['persist', 'cleanup']);
});

test('cancellation still wins when history persistence itself fails', async () => {
  let stale = false;
  const result = await handoffPromotedDownloadHistory({
    persistHistory: async () => {
      stale = true;
      throw new Error('settings are unwritable');
    },
    isStale: () => stale,
    rollbackHistory: async () => {
      assert.fail('uncommitted history must not be rolled back');
    },
    cleanupUnownedFile: async () => undefined,
  });

  assert.deepEqual(result, { status: 'stale', cleanupError: undefined });
});
