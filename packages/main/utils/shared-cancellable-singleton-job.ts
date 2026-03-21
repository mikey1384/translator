import {
  attachSharedCancellableJobWaiter,
  createSharedCancellableJob,
  type SharedCancellableJob,
  waitForAbortingSharedCancellableJob,
} from './shared-cancellable-job.js';
import {
  raceOperationCancellation,
  throwIfOperationCancelled,
} from './operation-cancellation.js';

type SharedCancellableSingletonJobOptions<T> = {
  getJob: () => SharedCancellableJob<T> | null;
  setJob: (job: SharedCancellableJob<T> | null) => void;
  createValue: (signal: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  onJoin?: () => void;
  beforeJoinContext: string;
  waitContext: string;
  runContext: string;
  abortCleanupContext: string;
  log?: {
    info?: (...args: any[]) => void;
  };
};

export async function waitForSharedCancellableSingletonJob<T>(
  options: SharedCancellableSingletonJobOptions<T>
): Promise<T> {
  const throwIfCancelled = () =>
    throwIfOperationCancelled({
      signal: options.signal,
      context: options.beforeJoinContext,
      log: options.log,
    });

  throwIfCancelled();

  let existingJob = options.getJob();
  while (existingJob?.status === 'aborting') {
    await waitForAbortingSharedCancellableJob(existingJob, {
      signal: options.signal,
      context: options.abortCleanupContext,
      log: options.log,
    });
    throwIfCancelled();
    existingJob = options.getJob();
  }

  if (existingJob) {
    options.onJoin?.();
    const releaseWaiter = attachSharedCancellableJobWaiter(existingJob);
    try {
      return await raceOperationCancellation(existingJob.promise, {
        signal: options.signal,
        context: options.waitContext,
        log: options.log,
      });
    } finally {
      releaseWaiter();
    }
  }

  const job = createSharedCancellableJob(options.createValue, () => {
    if (options.getJob() === job) {
      options.setJob(null);
    }
  });
  options.setJob(job);

  const releaseWaiter = attachSharedCancellableJobWaiter(job);
  try {
    return await raceOperationCancellation(job.promise, {
      signal: options.signal,
      context: options.runContext,
      log: options.log,
    });
  } finally {
    releaseWaiter();
  }
}
