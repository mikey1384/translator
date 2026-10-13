// Pending anonymous step counts keyed "YYYY-MM-DD|event". Pure logic so it can
// be tested without Electron; anonymous-usage-counts.ts wires storage and HTTP.

export type PendingCounts = Record<string, number>;

export type UsageCountEntry = {
  key: string;
  day: string;
  event: string;
  n: number;
};

export const MAX_PENDING_DAYS = 14;
export const MAX_ENTRIES_PER_REQUEST = 100;
export const MAX_COUNT_PER_ENTRY = 500;

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Drops malformed entries and days the server would no longer accept. */
export function prunePendingCounts(
  pending: PendingCounts | undefined,
  now: Date
): PendingCounts {
  const oldest = utcDay(
    new Date(now.getTime() - MAX_PENDING_DAYS * 24 * 60 * 60 * 1000)
  );
  const kept: PendingCounts = {};
  for (const [key, n] of Object.entries(pending ?? {})) {
    if (key.slice(0, 10) >= oldest && Number.isInteger(n) && n > 0) {
      kept[key] = n;
    }
  }
  return kept;
}

export function addCount(
  pending: PendingCounts,
  event: string,
  now: Date
): PendingCounts {
  const key = `${utcDay(now)}|${event}`;
  return { ...pending, [key]: (pending[key] ?? 0) + 1 };
}

export function takeBatch(pending: PendingCounts): UsageCountEntry[] {
  return Object.entries(pending)
    .slice(0, MAX_ENTRIES_PER_REQUEST)
    .map(([key, n]) => ({
      key,
      day: key.slice(0, 10),
      event: key.slice(11),
      n: Math.min(n, MAX_COUNT_PER_ENTRY),
    }));
}

/** Subtracts a sent batch; counts added while it was in flight stay pending. */
export function removeSent(
  pending: PendingCounts,
  sent: UsageCountEntry[]
): PendingCounts {
  const left = { ...pending };
  for (const { key, n } of sent) {
    const remaining = (left[key] ?? 0) - n;
    if (remaining > 0) left[key] = remaining;
    else delete left[key];
  }
  return left;
}
