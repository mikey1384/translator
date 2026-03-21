import fsp from 'node:fs/promises';

type CleanupLogger = {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
};

type PendingFileCleanupOutcome = 'deleted' | 'scheduled';

type PendingFileCleanupJob = {
  operationId: string;
  filePath: string;
  eagerResult: Promise<PendingFileCleanupOutcome>;
  resolveEagerResult: (outcome: PendingFileCleanupOutcome) => void;
  eagerResolved: boolean;
  completion: Promise<void>;
  resolveCompletion: () => void;
  backgroundFailureCount: number;
};

type PendingFileCleanupTrackerOptions = {
  deleteFile?: (filePath: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  logger?: CleanupLogger;
  eagerRetryDelaysMs?: number[];
  backgroundRetryDelaysMs?: number[];
};

const DEFAULT_EAGER_RETRY_DELAYS_MS = [150, 300, 600, 1200, 2000];
const DEFAULT_BACKGROUND_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];
const TRANSIENT_DELETE_ERROR_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function describeDeleteFailure(error: unknown): {
  code: string | null;
  retryLikelyToHelp: boolean;
} {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? null;
  return {
    code,
    retryLikelyToHelp: code !== null && TRANSIENT_DELETE_ERROR_CODES.has(code),
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

export function createPendingFileCleanupTracker(
  options: PendingFileCleanupTrackerOptions = {}
) {
  const deleteFile =
    options.deleteFile ?? (filePath => fsp.rm(filePath, { force: true }));
  const sleep = options.sleep ?? defaultSleep;
  const logger = options.logger;
  const eagerRetryDelaysMs =
    options.eagerRetryDelaysMs ?? DEFAULT_EAGER_RETRY_DELAYS_MS;
  const backgroundRetryDelaysMs =
    options.backgroundRetryDelaysMs ?? DEFAULT_BACKGROUND_RETRY_DELAYS_MS;
  const jobs = new Map<string, PendingFileCleanupJob>();

  const finishJob = (job: PendingFileCleanupJob): void => {
    if (jobs.get(job.operationId) === job) {
      jobs.delete(job.operationId);
    }
    if (!job.eagerResolved) {
      job.eagerResolved = true;
      job.resolveEagerResult('scheduled');
    }
    job.resolveCompletion();
  };

  const tryDeleteFile = async (
    job: PendingFileCleanupJob,
    phase: 'eager' | 'background'
  ): Promise<boolean> => {
    try {
      await deleteFile(job.filePath);
      logger?.info?.(
        `[pending-file-cleanup] Deleted discarded pending URL result for ${job.operationId}: ${job.filePath}`
      );
      return true;
    } catch (error) {
      const deleteError = error as NodeJS.ErrnoException;
      if (deleteError?.code === 'ENOENT') {
        logger?.info?.(
          `[pending-file-cleanup] Pending URL result for ${job.operationId} was already gone: ${job.filePath}`
        );
        return true;
      }

      const { code, retryLikelyToHelp } = describeDeleteFailure(error);
      const phaseLabel =
        phase === 'eager'
          ? 'initial discard cleanup'
          : 'background discard cleanup';

      if (phase === 'eager') {
        logger?.warn?.(
          `[pending-file-cleanup] Failed ${phaseLabel} for ${job.operationId} at ${job.filePath}${
            code ? ` (${code})` : ''
          }. Retrying before giving up ownership.`,
          error
        );
      } else {
        job.backgroundFailureCount += 1;
        if (
          job.backgroundFailureCount === 1 ||
          job.backgroundFailureCount % 5 === 0
        ) {
          logger?.warn?.(
            `[pending-file-cleanup] Background cleanup still cannot delete ${job.operationId} at ${job.filePath}${
              code ? ` (${code})` : ''
            }.${
              retryLikelyToHelp
                ? ' Will keep retrying.'
                : ' Keeping ownership and continuing background retries.'
            }`,
            error
          );
        }
      }

      return false;
    }
  };

  const runCleanupJob = async (job: PendingFileCleanupJob): Promise<void> => {
    try {
      if (await tryDeleteFile(job, 'eager')) {
        if (!job.eagerResolved) {
          job.eagerResolved = true;
          job.resolveEagerResult('deleted');
        }
        finishJob(job);
        return;
      }

      for (const delayMs of eagerRetryDelaysMs) {
        await sleep(delayMs);
        if (jobs.get(job.operationId) !== job) {
          finishJob(job);
          return;
        }
        if (await tryDeleteFile(job, 'eager')) {
          if (!job.eagerResolved) {
            job.eagerResolved = true;
            job.resolveEagerResult('deleted');
          }
          finishJob(job);
          return;
        }
      }

      if (!job.eagerResolved) {
        job.eagerResolved = true;
        job.resolveEagerResult('scheduled');
      }
      logger?.warn?.(
        `[pending-file-cleanup] Keeping background ownership for discarded pending URL result ${job.operationId} until ${job.filePath} is actually removed.`
      );

      for (let attempt = 0; jobs.get(job.operationId) === job; attempt += 1) {
        const delayMs =
          backgroundRetryDelaysMs[
            Math.min(attempt, backgroundRetryDelaysMs.length - 1)
          ] ?? DEFAULT_BACKGROUND_RETRY_DELAYS_MS.at(-1)!;
        await sleep(delayMs);
        if (jobs.get(job.operationId) !== job) {
          finishJob(job);
          return;
        }
        if (await tryDeleteFile(job, 'background')) {
          finishJob(job);
          return;
        }
      }
    } catch (error) {
      logger?.error?.(
        `[pending-file-cleanup] Unexpected failure while cleaning ${job.operationId} at ${job.filePath}.`,
        error
      );
      finishJob(job);
    } finally {
      if (jobs.get(job.operationId) !== job) {
        finishJob(job);
      }
    }
  };

  return {
    async discard(
      operationId: string,
      filePath: string
    ): Promise<PendingFileCleanupOutcome> {
      const existing = jobs.get(operationId);
      if (existing) {
        if (existing.filePath !== filePath) {
          logger?.warn?.(
            `[pending-file-cleanup] Reused operation ID ${operationId} for a different pending file. Keeping existing cleanup ownership for ${existing.filePath}.`
          );
        }
        return existing.eagerResult;
      }

      const eagerDeferred = createDeferred<PendingFileCleanupOutcome>();
      const completionDeferred = createDeferred<void>();
      const job: PendingFileCleanupJob = {
        operationId,
        filePath,
        eagerResult: eagerDeferred.promise,
        resolveEagerResult: eagerDeferred.resolve,
        eagerResolved: false,
        completion: completionDeferred.promise,
        resolveCompletion: completionDeferred.resolve,
        backgroundFailureCount: 0,
      };

      jobs.set(operationId, job);
      void runCleanupJob(job);
      return job.eagerResult;
    },

    has(operationId: string): boolean {
      return jobs.has(operationId);
    },

    async waitForCleanup(operationId: string): Promise<void> {
      const job = jobs.get(operationId);
      if (!job) return;
      await job.completion;
    },

    stopAll(): void {
      for (const job of jobs.values()) {
        jobs.delete(job.operationId);
        if (!job.eagerResolved) {
          job.eagerResolved = true;
          job.resolveEagerResult('scheduled');
        }
        job.resolveCompletion();
      }
    },
  };
}
