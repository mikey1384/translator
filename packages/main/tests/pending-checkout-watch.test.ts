import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PENDING_CHECKOUT_MAX_AGE_MS,
  SLOW_CHECKOUT_POLL_INTERVAL_MS,
  decideSlowCheckoutWatch,
  pendingCheckoutsToResume,
  removePendingCheckout,
  upsertPendingCheckout,
  type PendingCheckoutRecord,
} from '../utils/pending-checkout-watch.js';

const now = Date.UTC(2026, 9, 31, 12);
const open = {
  status: 'open',
  paymentStatus: 'unpaid',
  fulfillmentStatus: null,
};

test('an open checkout keeps being watched well past ten minutes', () => {
  for (const minutes of [10, 15, 60, 6 * 60, 23 * 60]) {
    assert.equal(
      decideSlowCheckoutWatch({
        state: open,
        createdAt: now - minutes * 60_000,
        now,
      }),
      'keep_waiting',
      `${minutes} min`
    );
  }
  assert.ok(SLOW_CHECKOUT_POLL_INTERVAL_MS <= 60_000);
});

test('an async payment (Pix/UPI) completed but not yet confirmed keeps waiting', () => {
  assert.equal(
    decideSlowCheckoutWatch({
      state: {
        status: 'complete',
        paymentStatus: 'unpaid',
        fulfillmentStatus: null,
      },
      createdAt: now - 20 * 60_000,
      now,
    }),
    'keep_waiting'
  );
});

test('paid, fulfilled, expired and failed are final', () => {
  const createdAt = now - 30 * 60_000;
  assert.equal(
    decideSlowCheckoutWatch({
      state: {
        status: 'complete',
        paymentStatus: 'paid',
        fulfillmentStatus: null,
      },
      createdAt,
      now,
    }),
    'paid'
  );
  assert.equal(
    decideSlowCheckoutWatch({
      state: {
        status: 'complete',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'fulfilled',
      },
      createdAt,
      now,
    }),
    'paid'
  );
  assert.equal(
    decideSlowCheckoutWatch({
      state: {
        status: 'expired',
        paymentStatus: 'unpaid',
        fulfillmentStatus: null,
      },
      createdAt,
      now,
    }),
    'not_paid'
  );
  assert.equal(
    decideSlowCheckoutWatch({
      state: {
        status: 'complete',
        paymentStatus: 'unpaid',
        fulfillmentStatus: 'failed',
      },
      createdAt,
      now,
    }),
    'not_paid'
  );
});

test('the watch ends after the session lifetime or when the server forgets it', () => {
  assert.equal(
    decideSlowCheckoutWatch({
      state: open,
      createdAt: now - PENDING_CHECKOUT_MAX_AGE_MS - 1,
      now,
    }),
    'give_up'
  );
  assert.equal(
    decideSlowCheckoutWatch({
      state: null,
      createdAt: now - 60_000,
      now,
      nonRetryableStatus: 404,
    }),
    'give_up'
  );
  // A network blip is not a verdict.
  assert.equal(
    decideSlowCheckoutWatch({ state: null, createdAt: now - 60_000, now }),
    'keep_waiting'
  );
});

test('pending checkouts persist one per mode and resume only while fresh', () => {
  const a: PendingCheckoutRecord = {
    mode: 'credits',
    sessionId: 'cs_a',
    packId: 'MICRO',
    createdAt: now - 60 * 60_000,
  };
  const b: PendingCheckoutRecord = {
    ...a,
    sessionId: 'cs_b',
    createdAt: now - 1_000,
  };
  const byo: PendingCheckoutRecord = {
    mode: 'byo',
    sessionId: 'cs_byo',
    createdAt: now - PENDING_CHECKOUT_MAX_AGE_MS - 5,
  };
  let list = upsertPendingCheckout([], a);
  list = upsertPendingCheckout(list, b);
  list = upsertPendingCheckout(list, byo);
  assert.deepEqual(
    list.map(r => r.sessionId),
    ['cs_b', 'cs_byo']
  );
  assert.deepEqual(
    pendingCheckoutsToResume(list, now).map(r => r.sessionId),
    ['cs_b']
  );
  assert.deepEqual(
    removePendingCheckout(list, 'cs_b').map(r => r.sessionId),
    ['cs_byo']
  );
  assert.deepEqual(pendingCheckoutsToResume([{ junk: true }, null], now), []);
  assert.deepEqual(pendingCheckoutsToResume('nope', now), []);
});
