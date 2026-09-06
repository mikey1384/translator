import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnalyticsPreferenceController,
  type AnalyticsChoice,
} from '../services/analytics-preference-controller';
import {
  isFreshProductEvent,
  PENDING_PRODUCT_EVENT_MAX_AGE_MS,
} from '../services/product-event-retention';

function harness(
  send: (choice: AnalyticsChoice) => Promise<AnalyticsChoice> = async choice =>
    choice
) {
  let stored: AnalyticsChoice = { enabled: false, revision: 0 };
  let cleared = 0;
  const controller = createAnalyticsPreferenceController({
    read: () => stored,
    write: value => {
      stored = value;
    },
    send,
    clearPending: () => {
      cleared++;
    },
    changed: () => {},
    available: () => true,
  });
  return { controller, stored: () => stored, cleared: () => cleared };
}

test('default denial, explicit opt-in and withdrawal include durable state and in-flight cancellation', async () => {
  const { controller: c, stored, cleared } = harness();
  assert.equal(c.maySend(), false);
  await c.sync();
  assert.equal(c.maySend(), false);
  await c.setEnabled(true);
  assert.equal(c.maySend(), true);
  const oldRevision = c.snapshot().revision;
  const signal = c.signal();
  const off = c.setEnabled(false);
  assert.equal(c.maySend(oldRevision), false);
  assert.equal(signal.aborted, true);
  assert.equal(stored().enabled, false);
  assert.equal(cleared(), 2);
  await off;
  assert.equal(c.snapshot().status, 'ready');
});

test('offline opt-out remains off locally and cannot be overwritten by a late opt-in reply', async () => {
  let release: ((choice: AnalyticsChoice) => void) | undefined;
  const { controller: c } = harness(choice =>
    choice.enabled
      ? new Promise(resolve => {
          release = resolve;
        })
      : Promise.reject(new Error('offline'))
  );
  const on = c.setEnabled(true);
  await Promise.resolve();
  const stale = { enabled: true, revision: c.snapshot().revision };
  const off = c.setEnabled(false);
  release!(stale);
  await Promise.all([on, off]);
  assert.equal(c.snapshot().enabled, false);
  assert.equal(c.snapshot().status, 'pending');
  assert.equal(c.maySend(), false);
});

test('server disagreement fails closed and the next explicit choice advances beyond its revision', async () => {
  let first = true;
  const { controller: c } = harness(async choice => {
    if (first) {
      first = false;
      return { enabled: false, revision: choice.revision + 1000 };
    }
    return choice;
  });
  await c.setEnabled(true);
  const stale = c.snapshot().revision;
  assert.equal(c.snapshot().status, 'pending');
  assert.equal(c.maySend(), false);
  await c.setEnabled(true);
  assert.ok(c.snapshot().revision > stale + 1000);
  assert.equal(c.maySend(), true);
});

test('pending events have a strict 72-hour limit; legacy and invalid timestamps are discarded', () => {
  const now = Date.now();
  assert.equal(
    isFreshProductEvent(
      new Date(now - PENDING_PRODUCT_EVENT_MAX_AGE_MS + 1).toISOString(),
      now
    ),
    true
  );
  for (const value of [
    undefined,
    '',
    'bad',
    new Date(now - PENDING_PRODUCT_EVENT_MAX_AGE_MS).toISOString(),
    new Date(now + 360000).toISOString(),
  ])
    assert.equal(isFreshProductEvent(value, now), false);
});
