import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STALE_AFTER_MS,
  staleRecords,
  type RunningJobRecord,
} from './interrupted-job-records';

const now = 1_000_000_000;
const record = (patch: Partial<RunningJobRecord>): RunningJobRecord => ({
  key: '/v.mp4',
  kind: 'translate',
  language: 'korean',
  startedAt: now - 60_000,
  aliveAt: now - STALE_AFTER_MS - 1,
  owner: 'other-tab',
  ...patch,
});

test('a job nobody refreshes any more was interrupted', () => {
  assert.equal(staleRecords([record({})], now, 'me').length, 1);
});

test('jobs still running in this or another tab are not interrupted', () => {
  assert.equal(staleRecords([record({ owner: 'me' })], now, 'me').length, 0);
  assert.equal(
    staleRecords([record({ aliveAt: now - 5_000 })], now, 'me').length,
    0
  );
});

test('very old leftovers are ignored', () => {
  assert.equal(
    staleRecords(
      [record({ startedAt: now - 30 * 24 * 60 * 60 * 1000 })],
      now,
      'me'
    ).length,
    0
  );
});
