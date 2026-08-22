/**
 * Purchase funnel event types for credit pack checkout and BYO unlock flows.
 * These events track the full purchase journey from button display to settlement.
 */

export type PurchaseFunnelEvent =
  // Credit pack checkout events
  | 'credit_checkout_button_shown'
  | 'credit_checkout_button_clicked'
  | 'credit_checkout_session_created'
  | 'credit_checkout_opened'
  | 'credit_checkout_completed'
  | 'credit_checkout_failed'
  | 'credit_checkout_cancelled'
  // BYO unlock events
  | 'byo_unlock_button_shown'
  | 'byo_unlock_button_clicked'
  | 'byo_unlock_session_created'
  | 'byo_unlock_opened'
  | 'byo_unlock_completed'
  | 'byo_unlock_failed'
  | 'byo_unlock_cancelled';

export type CreditPackId = 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO';

export type PurchasePlacement =
  | 'zero-credit-banner'
  | 'credit-ran-out-dialog'
  | 'settings-credit-card'
  | 'settings-byo';

export type PurchaseFailureReason =
  | 'network_error'
  | 'api_error'
  | 'stripe_error'
  | 'settlement_timeout'
  | 'already_pending'
  | 'unknown';

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
