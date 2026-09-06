export const PENDING_PRODUCT_EVENT_MAX_AGE_MS = 72 * 60 * 60 * 1000;

export function isFreshProductEvent(
  occurredAt: unknown,
  now = Date.now()
): boolean {
  if (typeof occurredAt !== 'string') return false;
  const time = Date.parse(occurredAt);
  return (
    Number.isFinite(time) &&
    time > now - PENDING_PRODUCT_EVENT_MAX_AGE_MS &&
    time <= now + 5 * 60 * 1000
  );
}
