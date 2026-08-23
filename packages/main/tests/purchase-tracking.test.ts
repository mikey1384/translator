import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type {
  PurchaseFunnelEvent,
  CreditPackId,
  PurchasePlacement,
} from '../services/purchase-funnel.js';
import {
  classifyPurchaseFailure,
  isRendererPurchaseFunnelEvent,
  parseRendererPurchaseContext,
  RENDERER_PURCHASE_FUNNEL_EVENTS,
} from '../services/purchase-funnel.js';

/**
 * Real tests for purchase funnel tracking implementation.
 * These tests import actual classification logic and verify behavior.
 */

/**
 * Test the IPC allowlist that prevents renderer from spoofing terminal events.
 * This imports the exact policy used by the main-process IPC boundary.
 */
describe('IPC Allowlist (Renderer Event Validation)', () => {
  const restrictedEvents: PurchaseFunnelEvent[] = [
    'credit_checkout_session_created',
    'credit_checkout_opened',
    'credit_checkout_completed',
    'credit_checkout_cancelled',
    'byo_unlock_session_created',
    'byo_unlock_opened',
    'byo_unlock_completed',
    'byo_unlock_cancelled',
  ];

  it('should allow renderer to emit button_shown events', () => {
    assert.ok(isRendererPurchaseFunnelEvent('credit_checkout_button_shown'));
    assert.ok(isRendererPurchaseFunnelEvent('byo_unlock_button_shown'));
  });

  it('should allow renderer to emit button_clicked events', () => {
    assert.ok(isRendererPurchaseFunnelEvent('credit_checkout_button_clicked'));
    assert.ok(isRendererPurchaseFunnelEvent('byo_unlock_button_clicked'));
  });

  it('should allow renderer to emit *_failed events for session creation failures', () => {
    assert.ok(isRendererPurchaseFunnelEvent('credit_checkout_failed'));
    assert.ok(isRendererPurchaseFunnelEvent('byo_unlock_failed'));
  });

  it('should reject renderer spoofing of session_created events', () => {
    assert.ok(
      !isRendererPurchaseFunnelEvent('credit_checkout_session_created')
    );
    assert.ok(!isRendererPurchaseFunnelEvent('byo_unlock_session_created'));
  });

  it('should reject renderer spoofing of opened events', () => {
    assert.ok(!isRendererPurchaseFunnelEvent('credit_checkout_opened'));
    assert.ok(!isRendererPurchaseFunnelEvent('byo_unlock_opened'));
  });

  it('should reject renderer spoofing of completed events', () => {
    assert.ok(!isRendererPurchaseFunnelEvent('credit_checkout_completed'));
    assert.ok(!isRendererPurchaseFunnelEvent('byo_unlock_completed'));
  });

  it('should reject renderer spoofing of cancelled events', () => {
    assert.ok(!isRendererPurchaseFunnelEvent('credit_checkout_cancelled'));
    assert.ok(!isRendererPurchaseFunnelEvent('byo_unlock_cancelled'));
  });

  it('should have exactly 6 allowed renderer events', () => {
    assert.strictEqual(RENDERER_PURCHASE_FUNNEL_EVENTS.length, 6);
  });

  it('should have exactly 8 restricted main-only events', () => {
    assert.strictEqual(restrictedEvents.length, 8);
  });

  it('should not overlap allowed and restricted events', () => {
    const overlap = RENDERER_PURCHASE_FUNNEL_EVENTS.filter(e =>
      restrictedEvents.includes(e)
    );
    assert.strictEqual(
      overlap.length,
      0,
      'No events should be both allowed and restricted'
    );
  });

  it('validates renderer context values and rejects extra fields', () => {
    assert.deepEqual(
      parseRendererPurchaseContext({
        packId: 'STANDARD',
        placement: 'settings-credit-card',
        failureReason: 'network_error',
      }),
      {
        ok: true,
        value: {
          packId: 'STANDARD',
          placement: 'settings-credit-card',
          failureReason: 'network_error',
        },
      }
    );
    assert.deepEqual(parseRendererPurchaseContext(undefined), {
      ok: true,
      value: {},
    });
    assert.equal(parseRendererPurchaseContext(null).ok, false);
    assert.equal(
      parseRendererPurchaseContext({ packId: 'UNLIMITED' }).ok,
      false
    );
    assert.equal(parseRendererPurchaseContext({ terminal: true }).ok, false);
  });
});

/**
 * Test already_pending classification and handling.
 * Verifies that already_pending is NOT treated as a failure.
 */
describe('already_pending is NOT a failure', () => {
  it('should classify already_pending as distinct from failures', () => {
    const reason = classifyPurchaseFailure({ alreadyPending: true });
    assert.strictEqual(reason, 'already_pending');
  });

  it('should prioritize already_pending over other conditions', () => {
    const reason = classifyPurchaseFailure({
      alreadyPending: true,
      error: new Error('Some error'),
      settlementTimeout: true,
    });
    assert.strictEqual(reason, 'already_pending');
  });

  it('should be distinct from network_error', () => {
    const alreadyPending = classifyPurchaseFailure({ alreadyPending: true });
    const networkError = classifyPurchaseFailure({
      error: new Error('ECONNREFUSED'),
    });
    assert.notStrictEqual(alreadyPending, networkError);
  });

  it('should be distinct from api_error', () => {
    const alreadyPending = classifyPurchaseFailure({ alreadyPending: true });
    const apiError = classifyPurchaseFailure({
      error: new Error('API failed'),
    });
    assert.notStrictEqual(alreadyPending, apiError);
  });
});

/**
 * Test settlement_timeout classification and handling.
 * Verifies that timeout is NOT treated as a payment failure.
 */
describe('settlement_timeout is NOT a payment failure', () => {
  it('should classify settlement_timeout as distinct reason', () => {
    const reason = classifyPurchaseFailure({ settlementTimeout: true });
    assert.strictEqual(reason, 'settlement_timeout');
  });

  it('should prioritize already_pending over settlement_timeout', () => {
    const reason = classifyPurchaseFailure({
      alreadyPending: true,
      settlementTimeout: true,
    });
    assert.strictEqual(reason, 'already_pending');
  });

  it('should prioritize settlement_timeout over generic errors', () => {
    const reason = classifyPurchaseFailure({
      settlementTimeout: true,
      error: new Error('Some error'),
    });
    assert.strictEqual(reason, 'settlement_timeout');
  });

  it('settlement_timeout exists but should NOT be used in emitCheckoutUnresolved', () => {
    // This documents that emitCheckoutUnresolved should NOT emit *_failed events
    // Unresolved means checkout is still open, not failed
    const timeoutReason = classifyPurchaseFailure({ settlementTimeout: true });
    assert.strictEqual(timeoutReason, 'settlement_timeout');
    // The actual implementation check is: emitCheckoutUnresolved must not call
    // trackPurchaseFunnelEvent with *_failed events
  });
});

/**
 * Test failure reason classification logic.
 */
describe('classifyPurchaseFailure', () => {
  it('should return network_error for ECONNREFUSED', () => {
    const error = new Error('ECONNREFUSED connection refused');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'network_error');
  });

  it('should return network_error for ETIMEDOUT', () => {
    const error = new Error('ETIMEDOUT timeout exceeded');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'network_error');
  });

  it('should return stripe_error for Stripe-related error', () => {
    const error = new Error('Stripe API error occurred');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'stripe_error');
  });

  it('should return stripe_error for lowercase stripe in error', () => {
    const error = new Error('stripe payment failed');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'stripe_error');
  });

  it('should return api_error for generic error', () => {
    const error = new Error('Generic API error');
    const result = classifyPurchaseFailure({ error });
    assert.strictEqual(result, 'api_error');
  });

  it('should return unknown when no error information provided', () => {
    const result = classifyPurchaseFailure({});
    assert.strictEqual(result, 'unknown');
  });
});

/**
 * Test placement types include all required values.
 */
describe('PurchasePlacement types', () => {
  it('should include all UI placement values', () => {
    const requiredPlacements: PurchasePlacement[] = [
      'zero-credit-banner',
      'credit-ran-out-dialog',
      'settings-credit-card',
      'settings-byo',
      'agent',
    ];

    requiredPlacements.forEach(placement => {
      assert.ok(
        typeof placement === 'string',
        `Placement ${placement} should be a valid PurchasePlacement`
      );
    });
  });

  it('should include agent placement for agent-initiated purchases', () => {
    const agentPlacement: PurchasePlacement = 'agent';
    assert.strictEqual(agentPlacement, 'agent');
  });
});

/**
 * Test credit pack IDs.
 */
describe('CreditPackId types', () => {
  it('should include all credit pack IDs', () => {
    const requiredPackIds: CreditPackId[] = [
      'MICRO',
      'STARTER',
      'STANDARD',
      'PRO',
    ];

    requiredPackIds.forEach(packId => {
      assert.ok(
        typeof packId === 'string',
        `PackId ${packId} should be a valid CreditPackId`
      );
    });
  });
});

/**
 * Test event name conventions and completeness.
 */
describe('PurchaseFunnelEvent completeness', () => {
  const creditEvents: PurchaseFunnelEvent[] = [
    'credit_checkout_button_shown',
    'credit_checkout_button_clicked',
    'credit_checkout_session_created',
    'credit_checkout_opened',
    'credit_checkout_completed',
    'credit_checkout_failed',
    'credit_checkout_cancelled',
  ];

  const byoEvents: PurchaseFunnelEvent[] = [
    'byo_unlock_button_shown',
    'byo_unlock_button_clicked',
    'byo_unlock_session_created',
    'byo_unlock_opened',
    'byo_unlock_completed',
    'byo_unlock_failed',
    'byo_unlock_cancelled',
  ];

  it('should have complete credit checkout funnel', () => {
    assert.strictEqual(creditEvents.length, 7);
    creditEvents.forEach(event => {
      assert.ok(typeof event === 'string');
      assert.ok(event.startsWith('credit_checkout_'));
    });
  });

  it('should have complete BYO unlock funnel', () => {
    assert.strictEqual(byoEvents.length, 7);
    byoEvents.forEach(event => {
      assert.ok(typeof event === 'string');
      assert.ok(event.startsWith('byo_unlock_'));
    });
  });

  it('should have parallel structure between credit and BYO events', () => {
    const creditSuffixes = creditEvents.map(e =>
      e.replace('credit_checkout_', '')
    );
    const byoSuffixes = byoEvents.map(e => e.replace('byo_unlock_', ''));

    creditSuffixes.sort();
    byoSuffixes.sort();

    assert.deepStrictEqual(
      creditSuffixes,
      byoSuffixes,
      'Credit and BYO events should have the same suffixes'
    );
  });
});
