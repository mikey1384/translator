import type { SrtSegment } from '@shared-types/app';

export type AgentHistoryJobKind = 'transcription' | 'translation' | 'merge';
export type AgentHistoryJobStatus =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentHistoryJob = {
  historyId: string;
  operationId: string;
  kind: AgentHistoryJobKind;
  status: AgentHistoryJobStatus;
  stage: string;
  percent: number;
  inProgress: boolean;
  startedAtIso: string;
  finishedAtIso: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  creditUsage: Record<string, unknown> | null;
};

type TerminalAgentOperationStatus = 'completed' | 'failed' | 'cancelled';

export type TerminalAgentOperationSnapshot = Record<string, unknown> & {
  id: string;
  status: TerminalAgentOperationStatus;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Replays of an accepted or completed operation are read-only. Failed and
 * cancelled operations are intentionally restartable with the same stable
 * operation ID so an MCP retry can preserve downstream spend idempotency.
 */
export function shouldReuseAgentOperation(
  status: AgentHistoryJobStatus | 'idle'
): boolean {
  return (
    status === 'running' || status === 'cancelling' || status === 'completed'
  );
}

export function usesMainOperationCancellation(
  kind: string | null,
  stage: string
): boolean {
  return kind === 'preset-render' && stage.startsWith('encoding ');
}

export type AgentProgressTaskName =
  | 'download'
  | 'transcription'
  | 'translation'
  | 'dubbing'
  | 'summary'
  | 'merge';

export function agentProgressTaskFor(
  kind: string | null,
  stage: string
): AgentProgressTaskName | null {
  if (kind === 'media-workflow') {
    const normalized = stage.toLowerCase();
    if (normalized.includes('download')) return 'download';
    if (normalized.includes('translat')) return 'translation';
    if (normalized.includes('summar')) return 'summary';
    if (normalized.includes('dubb')) return 'dubbing';
    if (normalized.includes('merge') || normalized.includes('encod')) {
      return 'merge';
    }
    return 'transcription';
  }
  if (kind === 'transcription' || kind === 'cue-transcription') {
    return 'transcription';
  }
  if (kind === 'translation' || kind === 'cue-translation') {
    return 'translation';
  }
  if (kind === 'dubbing') return 'dubbing';
  if (kind === 'summary') return 'summary';
  if (kind === 'merge' || kind === 'preset-render') return 'merge';
  return null;
}

/** Retains exact terminal snapshots after a later mounted operation begins. */
export class AgentTerminalOperationRegistry {
  private readonly operations = new Map<
    string,
    TerminalAgentOperationSnapshot
  >();

  constructor(private readonly maxRetainedOperations = 256) {
    if (
      !Number.isSafeInteger(maxRetainedOperations) ||
      maxRetainedOperations < 0
    ) {
      throw new RangeError(
        'maxRetainedOperations must be a non-negative integer.'
      );
    }
  }

  record(snapshot: TerminalAgentOperationSnapshot): void {
    if (
      !snapshot.id ||
      !['completed', 'failed', 'cancelled'].includes(snapshot.status)
    ) {
      throw new TypeError('Only terminal operation snapshots can be retained.');
    }
    this.operations.delete(snapshot.id);
    this.operations.set(snapshot.id, cloneJson(snapshot));
    while (this.operations.size > this.maxRetainedOperations) {
      const oldest = this.operations.keys().next().value as string | undefined;
      if (!oldest) break;
      this.operations.delete(oldest);
    }
  }

  get(operationId: string): TerminalAgentOperationSnapshot | null {
    const snapshot = this.operations.get(operationId);
    return snapshot ? cloneJson(snapshot) : null;
  }

  forget(operationId: string): boolean {
    return this.operations.delete(operationId);
  }

  size(): number {
    return this.operations.size;
  }
}

type MutableJobPatch = Partial<
  Omit<AgentHistoryJob, 'historyId' | 'operationId' | 'kind' | 'startedAtIso'>
>;

export class AgentHistoryJobRegistry {
  private readonly jobs = new Map<string, AgentHistoryJob>();
  private readonly terminalOperations = new Map<string, AgentHistoryJob>();

  constructor(private readonly maxRetainedTerminalJobs = 256) {
    if (
      !Number.isSafeInteger(maxRetainedTerminalJobs) ||
      maxRetainedTerminalJobs < 0
    ) {
      throw new RangeError(
        'maxRetainedTerminalJobs must be a non-negative integer.'
      );
    }
  }

  private pruneTerminalJobs(): void {
    let terminalCount = 0;
    for (const job of this.jobs.values()) {
      if (!job.inProgress) terminalCount += 1;
    }
    if (terminalCount <= this.maxRetainedTerminalJobs) return;

    for (const [historyId, job] of this.jobs) {
      if (job.inProgress) continue;
      this.jobs.delete(historyId);
      terminalCount -= 1;
      if (terminalCount <= this.maxRetainedTerminalJobs) break;
    }

    while (this.terminalOperations.size > this.maxRetainedTerminalJobs) {
      const oldest = this.terminalOperations.keys().next().value as
        | string
        | undefined;
      if (!oldest) break;
      this.terminalOperations.delete(oldest);
    }
  }

  start(args: {
    historyId: string;
    operationId: string;
    kind: AgentHistoryJobKind;
    stage: string;
  }): AgentHistoryJob {
    this.terminalOperations.delete(args.operationId);
    const job: AgentHistoryJob = {
      ...args,
      status: 'running',
      percent: 0,
      inProgress: true,
      startedAtIso: new Date().toISOString(),
      finishedAtIso: null,
      result: null,
      error: null,
      creditUsage: null,
    };
    // Reinsert a restarted history at the newest position for deterministic
    // terminal-result retention.
    this.jobs.delete(args.historyId);
    this.jobs.set(args.historyId, job);
    return { ...job };
  }

  update(
    historyId: string,
    operationId: string,
    patch: MutableJobPatch
  ): boolean {
    const current = this.jobs.get(historyId);
    if (!current || current.operationId !== operationId) return false;

    this.jobs.set(historyId, {
      ...current,
      ...patch,
      percent:
        patch.percent === undefined
          ? current.percent
          : Math.min(100, Math.max(0, patch.percent)),
    });
    return true;
  }

  markCancelling(historyId: string, operationId: string): boolean {
    const current = this.jobs.get(historyId);
    if (
      !current ||
      current.operationId !== operationId ||
      !current.inProgress
    ) {
      return false;
    }
    return this.update(historyId, operationId, {
      status: 'cancelling',
      stage: 'cancelling',
    });
  }

  finish(
    historyId: string,
    operationId: string,
    args:
      | { status: 'completed'; result: Record<string, unknown> }
      | { status: 'failed' | 'cancelled'; error: string | null }
  ): boolean {
    const updated = this.update(historyId, operationId, {
      status: args.status,
      stage: args.status,
      percent: args.status === 'completed' ? 100 : undefined,
      inProgress: false,
      finishedAtIso: new Date().toISOString(),
      result: args.status === 'completed' ? args.result : null,
      error: args.status === 'completed' ? null : args.error,
    });
    if (!updated) return false;

    const finished = this.jobs.get(historyId);
    if (finished) {
      this.jobs.delete(historyId);
      this.jobs.set(historyId, finished);
      this.terminalOperations.delete(operationId);
      this.terminalOperations.set(operationId, { ...finished });
    }
    this.pruneTerminalJobs();
    return true;
  }

  get(historyId: string): AgentHistoryJob | null {
    const job = this.jobs.get(historyId);
    return job ? { ...job } : null;
  }

  getByOperationId(operationId: string): AgentHistoryJob | null {
    for (const job of this.jobs.values()) {
      if (job.operationId === operationId) return { ...job };
    }
    const job = this.terminalOperations.get(operationId);
    return job ? { ...job } : null;
  }

  active(): AgentHistoryJob[] {
    return [...this.jobs.values()]
      .filter(job => job.inProgress)
      .map(job => ({ ...job }));
  }

  size(): number {
    return this.jobs.size;
  }
}

export function createAgentSubtitleBatchSnapshot(
  segments: readonly SrtSegment[],
  {
    offset = 0,
    limit = 50,
    sourceNote,
  }: { offset?: number; limit?: number; sourceNote?: string } = {}
): Record<string, unknown> {
  const normalizedOffset = Math.max(0, Math.floor(offset || 0));
  const normalizedLimit = Math.min(100, Math.max(1, Math.floor(limit || 50)));
  const sliced = segments.slice(
    normalizedOffset,
    normalizedOffset + normalizedLimit
  );

  return {
    offset: normalizedOffset,
    limit: normalizedLimit,
    total: segments.length,
    hasMore: normalizedOffset + sliced.length < segments.length,
    ...(sourceNote ? { sourceNote } : {}),
    cues: sliced.map(cue => ({
      id: cue.id,
      index: cue.index,
      start: cue.start,
      end: cue.end,
      original: cue.original,
      translation: cue.translation || '',
    })),
  };
}
