/**
 * After the app stops waiting on a checkout (ten quiet minutes, or "Choose
 * another pack"), the user may still finish paying in the browser. Stripe's
 * webhook credits the device on the server either way; this watch lets the
 * renderer re-read the balance when the user comes back to the app, so the
 * minutes show up without a restart.
 */
export type LateCheckoutWatch = {
  baselineCredits: number;
  // Credits the abandoned pack adds; a smaller rise (a monthly top-up) is
  // not reported as a payment.
  expectedCredits: number | null;
  until: number;
};

export const LATE_CHECKOUT_WATCH_MS = 24 * 60 * 60_000;
export const LATE_CHECKOUT_FOCUS_REFRESH_DEBOUNCE_MS = 15_000;

export function createLateCheckoutWatch({
  baselineCredits,
  expectedCredits,
  now,
}: {
  baselineCredits: number | null;
  expectedCredits: number | null;
  now: number;
}): LateCheckoutWatch | null {
  if (typeof baselineCredits !== 'number') return null;
  return {
    baselineCredits,
    expectedCredits,
    until: now + LATE_CHECKOUT_WATCH_MS,
  };
}

export function isLateCheckoutWatchActive(
  watch: LateCheckoutWatch | null,
  now: number
): watch is LateCheckoutWatch {
  return Boolean(watch && now < watch.until);
}

/**
 * Credits the late payment added, or null when the balance doesn't show one
 * yet (keep watching).
 */
export function lateCheckoutCreditsAdded(
  watch: LateCheckoutWatch,
  balance: number | null | undefined
): number | null {
  if (typeof balance !== 'number') return null;
  const added = balance - watch.baselineCredits;
  if (added <= 0) return null;
  if (watch.expectedCredits != null && added < watch.expectedCredits) {
    return null;
  }
  return added;
}
