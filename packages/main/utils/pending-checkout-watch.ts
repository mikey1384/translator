/**
 * Slow payments (Pix, UPI, bank-app confirmations, a card that first needs
 * international use switched on) can be confirmed by Stripe many minutes
 * after the browser opened. The app keeps watching an open checkout at a slow
 * pace until Stripe says it was paid, it expired or failed, or the session is
 * past Stripe's 24-hour lifetime, and it re-checks those sessions on the next
 * launch. Pure decisions here; credit-handlers does the I/O.
 */

export type PendingCheckoutMode = 'credits' | 'byo';

export type PendingCheckoutRecord = {
  mode: PendingCheckoutMode;
  sessionId: string;
  packId?: string;
  url?: string;
  // When the app created the session (ms since epoch).
  createdAt: number;
};

export type CheckoutSessionStateLike = {
  status?: string | null;
  paymentStatus?: string | null;
  fulfillmentStatus?: string | null;
} | null;

export type SlowCheckoutDecision =
  /** Stripe or our server says it's paid: refresh the balance, show success. */
  | 'paid'
  /** Expired, failed or cancelled: stop waiting, the offer comes back. */
  | 'not_paid'
  /** Still open, or completed with an async payment not yet confirmed. */
  | 'keep_waiting'
  /** Past the session's lifetime, or the server no longer knows it. */
  | 'give_up';

// Faster than this buys nothing for methods that take minutes, and an open
// Stripe page left overnight shouldn't poll the API all night at 2 s.
export const SLOW_CHECKOUT_POLL_INTERVAL_MS = 60_000;
// Stripe Checkout sessions expire 24 h after creation by default; an hour of
// slack covers clock skew and a confirmation that lands right at the end.
export const PENDING_CHECKOUT_MAX_AGE_MS = 25 * 60 * 60_000;

export function decideSlowCheckoutWatch({
  state,
  createdAt,
  now,
  nonRetryableStatus,
}: {
  state: CheckoutSessionStateLike;
  createdAt: number;
  now: number;
  nonRetryableStatus?: number | null;
}): SlowCheckoutDecision {
  if (state) {
    if (state.fulfillmentStatus === 'fulfilled') return 'paid';
    if (
      state.paymentStatus === 'paid' ||
      state.paymentStatus === 'no_payment_required'
    ) {
      return 'paid';
    }
    if (
      state.fulfillmentStatus === 'failed' ||
      state.fulfillmentStatus === 'cancelled' ||
      state.status === 'expired'
    ) {
      return 'not_paid';
    }
  }
  if (typeof nonRetryableStatus === 'number') return 'give_up';
  if (
    !Number.isFinite(createdAt) ||
    now - createdAt > PENDING_CHECKOUT_MAX_AGE_MS
  ) {
    return 'give_up';
  }
  return 'keep_waiting';
}

function isRecord(value: unknown): value is PendingCheckoutRecord {
  const v = value as Partial<PendingCheckoutRecord> | null;
  return (
    !!v &&
    (v.mode === 'credits' || v.mode === 'byo') &&
    typeof v.sessionId === 'string' &&
    v.sessionId.trim().length > 0 &&
    typeof v.createdAt === 'number' &&
    Number.isFinite(v.createdAt)
  );
}

/** Valid records only (the file may be old or hand-edited). */
export function normalizePendingCheckouts(
  raw: unknown
): PendingCheckoutRecord[] {
  return Array.isArray(raw) ? raw.filter(isRecord) : [];
}

/** One open checkout per mode: a new session replaces the previous one. */
export function upsertPendingCheckout(
  list: PendingCheckoutRecord[],
  record: PendingCheckoutRecord
): PendingCheckoutRecord[] {
  return [
    ...normalizePendingCheckouts(list).filter(r => r.mode !== record.mode),
    record,
  ];
}

export function removePendingCheckout(
  list: PendingCheckoutRecord[],
  sessionId: string
): PendingCheckoutRecord[] {
  return normalizePendingCheckouts(list).filter(r => r.sessionId !== sessionId);
}

/** Records still worth re-checking at launch (newest per mode, not expired). */
export function pendingCheckoutsToResume(
  list: unknown,
  now: number
): PendingCheckoutRecord[] {
  const fresh = normalizePendingCheckouts(list).filter(
    r => now - r.createdAt <= PENDING_CHECKOUT_MAX_AGE_MS
  );
  const newestByMode = new Map<PendingCheckoutMode, PendingCheckoutRecord>();
  for (const record of fresh) {
    const current = newestByMode.get(record.mode);
    if (!current || record.createdAt > current.createdAt) {
      newestByMode.set(record.mode, record);
    }
  }
  return [...newestByMode.values()];
}
