export type InterruptedJobKind = 'transcribe' | 'translate';

export interface RunningJobRecord {
  key: string;
  kind: InterruptedJobKind;
  language: string;
  startedAt: number;
  aliveAt: number;
  owner: string;
}

// Several tabs share storage: only a record nobody refreshed for this long
// belongs to a job that is gone.
export const STALE_AFTER_MS = 35_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Records that no live tab is refreshing any more. */
export function staleRecords(
  records: RunningJobRecord[],
  now: number,
  self: string
): RunningJobRecord[] {
  return records.filter(
    r =>
      r.owner !== self &&
      now - r.aliveAt > STALE_AFTER_MS &&
      now - r.startedAt < MAX_AGE_MS
  );
}
