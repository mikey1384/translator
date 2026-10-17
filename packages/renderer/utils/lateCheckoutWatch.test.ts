import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LATE_CHECKOUT_WATCH_MS,
  createLateCheckoutWatch,
  isLateCheckoutWatchActive,
  lateCheckoutCreditsAdded,
} from './lateCheckoutWatch';

test('no watch without a known starting balance', () => {
  assert.equal(
    createLateCheckoutWatch({
      baselineCredits: null,
      expectedCredits: 100,
      now: 0,
    }),
    null
  );
});

test('a late payment of the abandoned pack is reported', () => {
  const watch = createLateCheckoutWatch({
    baselineCredits: 1_000,
    expectedCredits: 50_000,
    now: 0,
  })!;
  assert.equal(isLateCheckoutWatchActive(watch, 1), true);
  assert.equal(lateCheckoutCreditsAdded(watch, 1_000), null);
  assert.equal(lateCheckoutCreditsAdded(watch, 51_000), 50_000);
});

test('a smaller rise (monthly top-up) is not a payment', () => {
  const watch = createLateCheckoutWatch({
    baselineCredits: 1_000,
    expectedCredits: 50_000,
    now: 0,
  })!;
  assert.equal(lateCheckoutCreditsAdded(watch, 6_000), null);
});

test('without a known pack any rise counts', () => {
  const watch = createLateCheckoutWatch({
    baselineCredits: 0,
    expectedCredits: null,
    now: 0,
  })!;
  assert.equal(lateCheckoutCreditsAdded(watch, 10), 10);
  assert.equal(lateCheckoutCreditsAdded(watch, undefined), null);
});

test('the watch ends after a day', () => {
  const watch = createLateCheckoutWatch({
    baselineCredits: 0,
    expectedCredits: null,
    now: 0,
  });
  assert.equal(isLateCheckoutWatchActive(watch, LATE_CHECKOUT_WATCH_MS), false);
  assert.equal(isLateCheckoutWatchActive(null, 0), false);
});
