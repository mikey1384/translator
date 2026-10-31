import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('./credit-store.ts', import.meta.url),
  'utf8'
);

// Pix/UPI and bank-app confirmations can land well after ten minutes. The
// renderer must keep the "waiting for payment confirmation" state and keep
// checking; only main (Stripe says expired/failed) ends the wait.
test('an unconfirmed checkout is never dropped as abandoned on a timer', () => {
  const start = source.indexOf('const refreshUnresolvedCheckout = () => {');
  const end = source.indexOf('const startCheckoutRefreshLoop', start);
  assert.ok(start > 0 && end > start);
  const body = source.slice(start, end);
  assert.doesNotMatch(body, /abandonCheckoutSession/);
  assert.doesNotMatch(body, /stopWaitingOnCheckout\(\{\s*watchForLatePayment/);
  assert.match(body, /CHECKOUT_UNRESOLVED_SLOW_REFRESH_INTERVAL_MS/);
});
