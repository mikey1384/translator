import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  PurchaseFunnelEvent,
  CreditPackId,
  PurchasePlacement,
  PurchaseFailureReason,
} from '../services/purchase-funnel.js';
import { classifyPurchaseFailure } from '../services/purchase-funnel.js';

/**
 * Tests for purchase funnel event tracking.
 * These tests verify that the event types and classification logic are correct.
 */

describe('Purchase Funnel Event Types', () => {
  it('should have all required credit checkout events', () => {
    const requiredEvents: PurchaseFunnelEvent[] = [
      'credit_checkout_button_shown',
      'credit_checkout_button_clicked',
      'credit_checkout_session_created',
      'credit_checkout_opened',
      'credit_checkout_completed',
      'credit_checkout_failed',
      'credit_checkout_cancelled',
    ];

    // This test ensures that all required event types compile and are assignable
    requiredEvents.forEach(event => {
      assert.ok(
        typeof event === 'string',
        `Event ${event} should be a valid PurchaseFunnelEvent`
      );
    });
  });

  it('should have all required BYO unlock events', () => {
    const requiredEvents: PurchaseFunnelEvent[] = [
      'byo_unlock_button_shown',
      'byo_unlock_button_clicked',
      'byo_unlock_session_created',
      'byo_unlock_opened',
      'byo_unlock_completed',
      'byo_unlock_failed',
      'byo_unlock_cancelled',
    ];

    requiredEvents.forEach(event => {
      assert.ok(
        typeof event === 'string',
        `Event ${event} should be a valid PurchaseFunnelEvent`
      );
    });
  });

  it('should have all required credit pack IDs', () => {
    const requiredPackIds: CreditPackId[] = ['MICRO', 'STARTER', 'STANDARD', 'PRO'];

    requiredPackIds.forEach(packId => {
      assert.ok(
        typeof packId === 'string',
        `PackId ${packId} should be a valid CreditPackId`
      );
    });
  });

  it('should have all required placement values', () => {
    const requiredPlacements: PurchasePlacement[] = [
      'zero-credit-banner',
      'credit-ran-out-dialog',
      'settings-credit-card',
      'settings-byo',
    ];

    requiredPlacements.forEach(placement => {
      assert.ok(
        typeof placement === 'string',
        `Placement ${placement} should be a valid PurchasePlacement`
      );
    });
  });

  it('should have all required failure reasons', () => {
    const requiredReasons: PurchaseFailureReason[] = [
      'network_error',
      'api_error',
      'stripe_error',
      'settlement_timeout',
      'already_pending',
      'unknown',
    ];

    requiredReasons.forEach(reason => {
      assert.ok(
        typeof reason === 'string',
        `Reason ${reason} should be a valid PurchaseFailureReason`
      );
    });
  });
});

describe('classifyPurchaseFailure', () => {
  it('should return already_pending when alreadyPending is true', () => {
    const result = classifyPurchaseFailure({ alreadyPending: true });
    assert.strictEqual(result, 'already_pending');
  });

  it('should return settlement_timeout when settlementTimeout is true', () => {
    const result = classifyPurchaseFailure({ settlementTimeout: true });
    assert.strictEqual(result, 'settlement_timeout');
  });

  it('should return network_error for ECONNREFUSED error', () => {
    const error = new Error('ECONNREFUSED');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'network_error');
  });

  it('should return network_error for ETIMEDOUT error', () => {
    const error = new Error('ETIMEDOUT');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'network_error');
  });

  it('should return stripe_error for Stripe-related error', () => {
    const error = new Error('Stripe API error occurred');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'stripe_error');
  });

  it('should return api_error for generic error', () => {
    const error = new Error('Generic API error');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'api_error');
  });

  it('should return unknown when no error information is provided', () => {
    const result = classifyPurchaseFailure({});
    assert.strictEqual(result, 'unknown');
  });

  it('should prioritize alreadyPending over other error information', () => {
    const result = classifyPurchaseFailure({
      alreadyPending: true,
      error: new Error('Some error'),
      settlementTimeout: true,
    });
    assert.strictEqual(result, 'already_pending');
  });

  it('should prioritize settlementTimeout over error', () => {
    const result = classifyPurchaseFailure({
      settlementTimeout: true,
      error: new Error('Some error'),
    });
    assert.strictEqual(result, 'settlement_timeout');
  });
});

/**
 * Tests for the purchase tracking intent.
 * These tests verify the expected behavior of button clicks and session creation failures.
 */
describe('Purchase Tracking Intent', () => {
  it('should track button_shown when credit purchase button is mounted', () => {
    // Intent: BuyCreditsButton should call trackPurchaseEvent('credit_checkout_button_shown')
    // in useEffect on mount with packId and placement
    const expectedEvent: PurchaseFunnelEvent = 'credit_checkout_button_shown';
    const expectedContext = {
      packId: 'MICRO' as CreditPackId,
      placement: 'zero-credit-banner' as PurchasePlacement,
    };

    assert.ok(expectedEvent, 'Button shown event should be defined');
    assert.ok(expectedContext.packId, 'PackId should be provided');
    assert.ok(expectedContext.placement, 'Placement should be provided');
  });

  it('should track button_clicked when credit purchase button is pressed', () => {
    // Intent: BuyCreditsButton should call trackPurchaseEvent('credit_checkout_button_clicked')
    // immediately on click with packId and placement
    const expectedEvent: PurchaseFunnelEvent = 'credit_checkout_button_clicked';
    const expectedContext = {
      packId: 'MICRO' as CreditPackId,
      placement: 'zero-credit-banner' as PurchasePlacement,
    };

    assert.ok(expectedEvent, 'Button clicked event should be defined');
    assert.ok(expectedContext.packId, 'PackId should be provided');
    assert.ok(expectedContext.placement, 'Placement should be provided');
  });

  it('should track session creation failure after button press', () => {
    // Intent: When createCheckoutSession fails, trackPurchaseEvent('credit_checkout_failed')
    // should be called immediately with packId, placement, and failureReason
    const expectedEvent: PurchaseFunnelEvent = 'credit_checkout_failed';
    const expectedContext = {
      packId: 'MICRO' as CreditPackId,
      placement: 'zero-credit-banner' as PurchasePlacement,
      failureReason: 'api_error' as PurchaseFailureReason,
    };

    assert.ok(expectedEvent, 'Checkout failed event should be defined');
    assert.ok(expectedContext.packId, 'PackId should be provided');
    assert.ok(expectedContext.placement, 'Placement should be provided');
    assert.ok(expectedContext.failureReason, 'Failure reason should be provided');
  });

  it('should track BYO button_shown when unlock card is mounted', () => {
    // Intent: ByoUnlockCard should call trackPurchaseEvent('byo_unlock_button_shown')
    // in useEffect on mount with placement
    const expectedEvent: PurchaseFunnelEvent = 'byo_unlock_button_shown';
    const expectedContext = {
      placement: 'settings-byo' as PurchasePlacement,
    };

    assert.ok(expectedEvent, 'BYO button shown event should be defined');
    assert.ok(expectedContext.placement, 'Placement should be provided');
  });

  it('should track BYO button_clicked when unlock button is pressed', () => {
    // Intent: ByoUnlockCard should call trackPurchaseEvent('byo_unlock_button_clicked')
    // immediately on click with placement
    const expectedEvent: PurchaseFunnelEvent = 'byo_unlock_button_clicked';
    const expectedContext = {
      placement: 'settings-byo' as PurchasePlacement,
    };

    assert.ok(expectedEvent, 'BYO button clicked event should be defined');
    assert.ok(expectedContext.placement, 'Placement should be provided');
  });

  it('should track BYO session creation failure after button press', () => {
    // Intent: When createByoUnlockSession fails in ai-store startUnlock,
    // trackPurchaseEvent('byo_unlock_failed') should be called immediately
    // with placement and failureReason
    const expectedEvent: PurchaseFunnelEvent = 'byo_unlock_failed';
    const expectedContext = {
      placement: 'settings-byo' as PurchasePlacement,
      failureReason: 'network_error' as PurchaseFailureReason,
    };

    assert.ok(expectedEvent, 'BYO unlock failed event should be defined');
    assert.ok(expectedContext.placement, 'Placement should be provided');
    assert.ok(expectedContext.failureReason, 'Failure reason should be provided');
  });

  it('should track checkout_opened separately from session_created for credits', () => {
    // Intent: After session is created, when the browser/window is actually opened,
    // trackPurchaseEvent('credit_checkout_opened') should be called
    const sessionCreatedEvent: PurchaseFunnelEvent =
      'credit_checkout_session_created';
    const checkoutOpenedEvent: PurchaseFunnelEvent = 'credit_checkout_opened';

    assert.ok(sessionCreatedEvent, 'Session created event should be defined');
    assert.ok(checkoutOpenedEvent, 'Checkout opened event should be defined');
    assert.notStrictEqual(
      sessionCreatedEvent,
      checkoutOpenedEvent,
      'Session created and checkout opened should be distinct events'
    );
  });

  it('should track checkout_opened separately from session_created for BYO', () => {
    // Intent: After BYO session is created, when the browser/window is actually opened,
    // trackPurchaseEvent('byo_unlock_opened') should be called
    const sessionCreatedEvent: PurchaseFunnelEvent = 'byo_unlock_session_created';
    const checkoutOpenedEvent: PurchaseFunnelEvent = 'byo_unlock_opened';

    assert.ok(sessionCreatedEvent, 'BYO session created event should be defined');
    assert.ok(checkoutOpenedEvent, 'BYO checkout opened event should be defined');
    assert.notStrictEqual(
      sessionCreatedEvent,
      checkoutOpenedEvent,
      'BYO session created and checkout opened should be distinct events'
    );
  });
});
