/**
 * Paid subtitle jobs that are running, one record per source. Main keeps the
 * list on disk so it survives a crash or force-quit; tabs change it only
 * through the operations below, so two tabs never overwrite each other.
 */

export type InterruptedJobKind = 'transcribe' | 'translate';

export interface RunningJobRecord {
  key: string;
  kind: InterruptedJobKind;
  language: string;
  startedAt: number;
  aliveAt: number;
  /** The tab that runs the job. */
  owner: string;
  /** The app run (main-process boot) the job belongs to. */
  session?: string;
  /** The subtitles that were on screen when a translation started. */
  documentId?: string | null;
}

export type RunningJobOp =
  | { type: 'start'; record: RunningJobRecord }
  | { type: 'attachDocument'; key: string; owner: string; documentId: string }
  | { type: 'heartbeat'; owner: string; now: number }
  | { type: 'end'; owner: string }
  | { type: 'dismiss'; key: string; keepOwner: string };

export const RUNNING_JOBS_CHANNEL = 'running-subtitle-jobs:op';
export const RUNNING_JOBS_LIST_CHANNEL = 'running-subtitle-jobs:list';

const MAX_RECORDS = 50;

export function isRunningJobRecord(r: any): r is RunningJobRecord {
  return Boolean(
    r &&
    typeof r.key === 'string' &&
    (r.kind === 'transcribe' || r.kind === 'translate') &&
    typeof r.language === 'string' &&
    typeof r.startedAt === 'number' &&
    typeof r.aliveAt === 'number' &&
    typeof r.owner === 'string'
  );
}

export function sanitizeRunningJobRecords(value: unknown): RunningJobRecord[] {
  return Array.isArray(value) ? value.filter(isRunningJobRecord) : [];
}

export function applyRunningJobOp(
  records: RunningJobRecord[],
  op: RunningJobOp,
  session?: string
): RunningJobRecord[] {
  switch (op.type) {
    case 'start': {
      if (!isRunningJobRecord(op.record)) return records;
      // A new run for this source replaces any leftover record.
      const rest = records.filter(r => r.key !== op.record.key);
      const record = session ? { ...op.record, session } : op.record;
      return [...rest, record].slice(-MAX_RECORDS);
    }
    case 'attachDocument':
      return records.map(r =>
        r.key === op.key && r.owner === op.owner
          ? { ...r, documentId: op.documentId }
          : r
      );
    case 'heartbeat':
      return records.map(r =>
        r.owner === op.owner ? { ...r, aliveAt: op.now } : r
      );
    case 'end':
      return records.filter(r => r.owner !== op.owner);
    case 'dismiss':
      return records.filter(r => r.key !== op.key || r.owner === op.keepOwner);
    default:
      return records;
  }
}

// Several tabs share the list: only a record nobody refreshed for this long
// belongs to a job that is gone.
export const STALE_AFTER_MS = 35_000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Records that no live tab is refreshing any more. A record from an earlier
 * app run is gone at once: that run quit or crashed.
 */
export function staleRecords(
  records: RunningJobRecord[],
  now: number,
  self: string,
  currentSession?: string | null
): RunningJobRecord[] {
  return records.filter(r => {
    if (r.owner === self || now - r.startedAt >= MAX_AGE_MS) return false;
    const earlierRun = Boolean(
      currentSession && r.session && r.session !== currentSession
    );
    return earlierRun || now - r.aliveAt > STALE_AFTER_MS;
  });
}
