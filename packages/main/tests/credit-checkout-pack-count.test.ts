import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCheckoutSessionPackCount,
  decideCreditCheckoutCollision,
} from '../utils/credit-checkout-guard.js';
import { CHECKOUT_PACK_COUNT_MISMATCH } from '../services/handoff-funnel.js';

const activeTwoDollarOffer = {
  sessionId: 'cs_live_two',
  packId: 'MICRO',
  quantity: 2,
  url: 'https://checkout.stripe.com/c/pay/cs_live_two',
};

test('clicking the same pack with the same quantity reopens the active Stripe checkout', () => {
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: activeTwoDollarOffer.sessionId,
      activeCreditCheckout: activeTwoDollarOffer,
      transition: 'pending',
      requestedPackId: 'MICRO',
      requestedQuantity: 2,
    }),
    { action: 'reopen', url: activeTwoDollarOffer.url }
  );
});

test('clicking the same pack with a different quantity replaces the waiting checkout', () => {
  // User opened a $2 offer (2x MICRO), then clicked a $3 offer (3x MICRO):
  // must NOT reopen the $2 Stripe page.
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: activeTwoDollarOffer.sessionId,
      activeCreditCheckout: activeTwoDollarOffer,
      transition: 'pending',
      requestedPackId: 'MICRO',
      requestedQuantity: 3,
    }),
    { action: 'replace', reason: 'changed_pack_or_quantity' }
  );

  // Going back down from 2x MICRO to 1x MICRO also replaces.
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: activeTwoDollarOffer.sessionId,
      activeCreditCheckout: activeTwoDollarOffer,
      transition: 'pending',
      requestedPackId: 'MICRO',
      requestedQuantity: 1,
    }),
    { action: 'replace', reason: 'changed_pack_or_quantity' }
  );
});

test('clicking a different pack replaces the waiting checkout', () => {
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: activeTwoDollarOffer.sessionId,
      activeCreditCheckout: activeTwoDollarOffer,
      transition: 'pending',
      requestedPackId: 'STARTER',
      requestedQuantity: 1,
    }),
    { action: 'replace', reason: 'changed_pack_or_quantity' }
  );
});

test('unresolved checkout is replaced even for the same pack and quantity', () => {
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: activeTwoDollarOffer.sessionId,
      activeCreditCheckout: activeTwoDollarOffer,
      transition: 'unresolved',
      requestedPackId: 'MICRO',
      requestedQuantity: 2,
    }),
    { action: 'replace', reason: 'stale_unresolved' }
  );
});

test('in-flight creation blocks duplicate starts; no active session starts normally', () => {
  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: true,
      mode: 'credits',
      existingSessionId: null,
      activeCreditCheckout: null,
      transition: null,
      requestedPackId: 'MICRO',
      requestedQuantity: 2,
    }),
    { action: 'block' }
  );

  assert.deepEqual(
    decideCreditCheckoutCollision({
      inFlight: false,
      mode: 'credits',
      existingSessionId: null,
      activeCreditCheckout: null,
      transition: null,
      requestedPackId: 'MICRO',
      requestedQuantity: 2,
    }),
    { action: 'start' }
  );
});

test('mismatched server pack count throws before opening checkout and counts checkout_pack_count_mismatch', () => {
  const counted: string[] = [];
  let openedCheckoutUrl = false;

  const runServerResponseGuard = (
    requestedQuantity: number,
    responseQuantity: unknown
  ) => {
    assertCheckoutSessionPackCount({
      requestedQuantity,
      responseQuantity,
      onMismatch: () => counted.push(CHECKOUT_PACK_COUNT_MISMATCH),
    });
    openedCheckoutUrl = true;
  };

  // Older server omits quantity (or returns 1) when 3 packs were requested
  assert.throws(
    () => runServerResponseGuard(3, undefined),
    /1 pack\(s\), not the 3 requested/
  );
  assert.equal(openedCheckoutUrl, false);
  assert.deepEqual(counted, [CHECKOUT_PACK_COUNT_MISMATCH]);

  // Server returns wrong count (2 instead of 4)
  assert.throws(
    () => runServerResponseGuard(4, 2),
    /2 pack\(s\), not the 4 requested/
  );
  assert.equal(openedCheckoutUrl, false);
  assert.deepEqual(counted, [
    CHECKOUT_PACK_COUNT_MISMATCH,
    CHECKOUT_PACK_COUNT_MISMATCH,
  ]);
});

test('matching server pack count or single-pack checkout passes without mismatch count', () => {
  const counted: string[] = [];

  assert.doesNotThrow(() =>
    assertCheckoutSessionPackCount({
      requestedQuantity: 1,
      responseQuantity: undefined,
      onMismatch: () => counted.push(CHECKOUT_PACK_COUNT_MISMATCH),
    })
  );
  assert.doesNotThrow(() =>
    assertCheckoutSessionPackCount({
      requestedQuantity: 3,
      responseQuantity: 3,
      onMismatch: () => counted.push(CHECKOUT_PACK_COUNT_MISMATCH),
    })
  );
  assert.deepEqual(counted, []);
});
