export type CreditCheckoutCollisionDecision =
  | { action: 'start' }
  | { action: 'block' }
  | { action: 'reopen'; url: string }
  | {
      action: 'replace';
      reason: 'changed_pack_or_quantity' | 'stale_unresolved';
    };

export interface ActiveCreditCheckoutLike {
  sessionId: string;
  packId: string;
  quantity?: number;
  url: string;
}

/**
 * Decide what to do when a checkout creation is requested while another
 * session may already be in flight or waiting for payment.
 *
 * - Clicking the same pack with the same quantity reopens the active Stripe
 *   page (the browser tab was likely closed).
 * - Clicking a different pack OR a different quantity of the same pack (e.g.
 *   changing a $2 offer to $3) replaces the waiting checkout so the user is
 *   never sent back to a Stripe page charging a different amount.
 */
export function decideCreditCheckoutCollision({
  inFlight,
  mode,
  existingSessionId,
  activeCreditCheckout,
  transition,
  requestedPackId,
  requestedQuantity = 1,
}: {
  inFlight: boolean;
  mode: 'credits' | 'byo';
  existingSessionId: string | null | undefined;
  activeCreditCheckout: ActiveCreditCheckoutLike | null;
  transition: 'pending' | 'unresolved' | null | undefined;
  requestedPackId?: string;
  requestedQuantity?: number;
}): CreditCheckoutCollisionDecision {
  if (inFlight) {
    return { action: 'block' };
  }
  if (!existingSessionId) {
    return { action: 'start' };
  }

  const activeMatch =
    mode === 'credits' && activeCreditCheckout?.sessionId === existingSessionId
      ? activeCreditCheckout
      : null;

  const choseAnotherPackOrQuantity =
    requestedPackId != null &&
    activeMatch != null &&
    (requestedPackId !== activeMatch.packId ||
      requestedQuantity !== (activeMatch.quantity ?? 1));

  if (choseAnotherPackOrQuantity) {
    return { action: 'replace', reason: 'changed_pack_or_quantity' };
  }
  if (transition === 'unresolved') {
    return { action: 'replace', reason: 'stale_unresolved' };
  }
  if (activeMatch) {
    return { action: 'reopen', url: activeMatch.url };
  }
  return { action: 'block' };
}

/**
 * Verify that the checkout session returned by the server matches the
 * requested multi-pack count before opening Stripe in the browser.
 * If a server returns a different pack count (e.g. an older server that
 * ignores `quantity` and creates a 1-pack session), record the mismatch and
 * throw so the app refuses to open the wrong checkout URL.
 */
export function assertCheckoutSessionPackCount({
  requestedQuantity,
  responseQuantity,
  onMismatch,
}: {
  requestedQuantity: number;
  responseQuantity: unknown;
  onMismatch?: () => void;
}): void {
  if (requestedQuantity > 1 && responseQuantity !== requestedQuantity) {
    onMismatch?.();
    throw new Error(
      `Checkout was created for ${String(responseQuantity ?? 1)} pack(s), not the ${requestedQuantity} requested.`
    );
  }
}
