import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCount,
  MAX_COUNT_PER_ENTRY,
  MAX_ENTRIES_PER_REQUEST,
  prunePendingCounts,
  removeSent,
  takeBatch,
} from '../services/usage-count-buffer';

const now = new Date('2026-10-13T12:00:00Z');

test('counts accumulate per UTC day and event', () => {
  let pending = addCount({}, 'app_open', now);
  pending = addCount(pending, 'app_open', now);
  pending = addCount(pending, 'url_download_started', now);
  pending = addCount(pending, 'app_open', new Date('2026-10-14T00:00:01Z'));
  assert.deepEqual(pending, {
    '2026-10-13|app_open': 2,
    '2026-10-13|url_download_started': 1,
    '2026-10-14|app_open': 1,
  });
});

test('batches split the key and cap counts and entries', () => {
  const pending: Record<string, number> = { '2026-10-13|app_open': 900 };
  for (let i = 0; i < MAX_ENTRIES_PER_REQUEST + 5; i += 1) {
    pending[`2026-10-12|event_${i}`] = 1;
  }
  const batch = takeBatch(pending);
  assert.equal(batch.length, MAX_ENTRIES_PER_REQUEST);
  assert.deepEqual(batch[0], {
    key: '2026-10-13|app_open',
    day: '2026-10-13',
    event: 'app_open',
    n: MAX_COUNT_PER_ENTRY,
  });
});

test('sending subtracts only what was sent', () => {
  const batch = takeBatch({ '2026-10-13|app_open': 900, '2026-10-13|x': 2 });
  // One more app_open and a new event arrived while the request was in flight.
  const after = removeSent(
    { '2026-10-13|app_open': 901, '2026-10-13|x': 2, '2026-10-13|y': 1 },
    batch
  );
  assert.deepEqual(after, { '2026-10-13|app_open': 401, '2026-10-13|y': 1 });
});

test('stale days and malformed counts are pruned', () => {
  assert.deepEqual(
    prunePendingCounts(
      {
        '2026-09-29|app_open': 3,
        '2026-09-28|app_open': 3,
        '2026-10-13|bad': 0,
        '2026-10-13|frac': 1.5,
      },
      now
    ),
    { '2026-09-29|app_open': 3 }
  );
  assert.deepEqual(prunePendingCounts(undefined, now), {});
});
