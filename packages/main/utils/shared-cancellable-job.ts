import { raceOperationCancellation } from './operation-cancellation.js';

export type SharedCancellableJobStatus = 'running' | 'aborting' | 'settled';

export type SharedCancellableJob<T> = {
  promise: Promise<T>;
  controller: AbortController;
  waiterCount: number;
  status: SharedCancellableJobStatus;
};

export function createSharedCancellableJob<T>(
  run: (signal: AbortSignal) => Promise<T>,
  onSettled?: () => void
): SharedCancellableJob<T> {
  const controller = new AbortController();
  const job: SharedCancellableJob<T> = {
    promise: Promise.resolve(undefined as T),
    controller,
    waiterCount: 0,
    status: 'running',
  };

  job.promise = run(controller.signal).finally(() => {
    job.status = 'settled';
    onSettled?.();
  });

  return job;
}

function abortSharedCancellableJobIfIdle<T>(
  job: SharedCancellableJob<T>
): void {
  if (job.waiterCount > 0 || job.status !== 'running') {
    return;
  }

  job.status = 'aborting';
  job.controller.abort();
}

export function attachSharedCancellableJobWaiter<T>(
  job: SharedCancellableJob<T>
): () => void {
  job.waiterCount += 1;
  let released = false;

  return () => {
    if (released) {
      return;
    }
    released = true;
    job.waiterCount = Math.max(0, job.waiterCount - 1);
    abortSharedCancellableJobIfIdle(job);
  };
}

export async function waitForAbortingSharedCancellableJob<T>(
  job: SharedCancellableJob<T>,
  options: {
    signal?: AbortSignal;
    context?: string;
    log?: {
      info?: (...args: any[]) => void;
    };
  } = {}
): Promise<void> {
  await raceOperationCancellation(
    job.promise.catch(() => undefined),
    {
      signal: options.signal,
      context: options.context,
      log: options.log,
    }
  );
}
