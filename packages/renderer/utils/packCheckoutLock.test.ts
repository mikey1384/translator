import test from 'node:test';
import assert from 'node:assert/strict';
import { isPackCheckoutLocked } from './packCheckoutLock';

test('packs are locked while a checkout is open or being checked', () => {
  assert.equal(
    isPackCheckoutLocked({ checkoutPending: true, checkoutUnresolved: false }),
    true
  );
  assert.equal(
    isPackCheckoutLocked({ checkoutPending: false, checkoutUnresolved: true }),
    true
  );
});

test('packs are free once nothing is waiting (e.g. after "Choose another pack")', () => {
  assert.equal(
    isPackCheckoutLocked({ checkoutPending: false, checkoutUnresolved: false }),
    false
  );
});
