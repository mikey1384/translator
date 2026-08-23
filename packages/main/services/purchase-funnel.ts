/**
 * Purchase funnel event types for credit pack checkout and BYO unlock flows.
 * These events track the full purchase journey from button display to settlement.
 */

import type {
  CreditPackId,
  PurchaseFailureReason,
  PurchaseFunnelEvent,
  PurchasePlacement,
} from '@shared-types/app';

export type {
  CreditPackId,
  PurchaseFailureReason,
  PurchaseFunnelEvent,
  PurchasePlacement,
} from '@shared-types/app';

export const RENDERER_PURCHASE_FUNNEL_EVENTS = Object.freeze([
  'credit_checkout_button_shown',
  'credit_checkout_button_clicked',
  'credit_checkout_failed',
  'byo_unlock_button_shown',
  'byo_unlock_button_clicked',
  'byo_unlock_failed',
] as const satisfies readonly PurchaseFunnelEvent[]);

const rendererPurchaseFunnelEventSet = new Set<PurchaseFunnelEvent>(
  RENDERER_PURCHASE_FUNNEL_EVENTS
);
const creditPackIds = new Set<CreditPackId>([
  'MICRO',
  'STARTER',
  'STANDARD',
  'PRO',
]);
const purchasePlacements = new Set<PurchasePlacement>([
  'zero-credit-banner',
  'credit-ran-out-dialog',
  'settings-credit-card',
  'settings-byo',
  'agent',
]);
const purchaseFailureReasons = new Set<PurchaseFailureReason>([
  'network_error',
  'api_error',
  'stripe_error',
  'settlement_timeout',
  'already_pending',
  'unknown',
]);

/** Terminal checkout events are main-owned and cannot be asserted by a renderer. */
export function isRendererPurchaseFunnelEvent(
  event: unknown
): event is (typeof RENDERER_PURCHASE_FUNNEL_EVENTS)[number] {
  return (
    typeof event === 'string' &&
    rendererPurchaseFunnelEventSet.has(event as PurchaseFunnelEvent)
  );
}

type RendererPurchaseContext = {
  packId?: CreditPackId;
  placement?: PurchasePlacement;
  failureReason?: PurchaseFailureReason;
};

export function parseRendererPurchaseContext(
  context: unknown
): { ok: true; value: RendererPurchaseContext } | { ok: false; error: string } {
  if (context === undefined) return { ok: true, value: {} };
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return { ok: false, error: 'Purchase event context must be an object.' };
  }

  const record = context as Record<string, unknown>;
  const allowedKeys = new Set(['packId', 'placement', 'failureReason']);
  const unknownKey = Object.keys(record).find(key => !allowedKeys.has(key));
  if (unknownKey) {
    return {
      ok: false,
      error: `Purchase event context field ${unknownKey} is not allowed.`,
    };
  }
  if (
    Object.hasOwn(record, 'packId') &&
    !creditPackIds.has(record.packId as CreditPackId)
  ) {
    return { ok: false, error: 'Invalid purchase packId.' };
  }
  if (
    Object.hasOwn(record, 'placement') &&
    !purchasePlacements.has(record.placement as PurchasePlacement)
  ) {
    return { ok: false, error: 'Invalid purchase placement.' };
  }
  if (
    Object.hasOwn(record, 'failureReason') &&
    !purchaseFailureReasons.has(record.failureReason as PurchaseFailureReason)
  ) {
    return { ok: false, error: 'Invalid purchase failureReason.' };
  }

  return {
    ok: true,
    value: {
      ...(Object.hasOwn(record, 'packId')
        ? { packId: record.packId as CreditPackId }
        : {}),
      ...(Object.hasOwn(record, 'placement')
        ? { placement: record.placement as PurchasePlacement }
        : {}),
      ...(Object.hasOwn(record, 'failureReason')
        ? { failureReason: record.failureReason as PurchaseFailureReason }
        : {}),
    },
  };
}

/**
 * Classify a checkout failure based on error information.
 */
export function classifyPurchaseFailure({
  error,
  alreadyPending,
  settlementTimeout,
}: {
  error?: unknown;
  alreadyPending?: boolean;
  settlementTimeout?: boolean;
}): PurchaseFailureReason {
  if (alreadyPending) return 'already_pending';
  if (settlementTimeout) return 'settlement_timeout';

  const errorStr = String(error || '');
  if (errorStr.includes('ECONNREFUSED') || errorStr.includes('ETIMEDOUT')) {
    return 'network_error';
  }
  if (errorStr.includes('stripe') || errorStr.includes('Stripe')) {
    return 'stripe_error';
  }
  if (error) {
    return 'api_error';
  }

  return 'unknown';
}
