// Dependency-free worker-pool helpers (kept importable from plain node tests).

/** Sleep that resolves early (without throwing) when the signal aborts. */
function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Run `taskCount` tasks through a fixed-size worker pool.
 * Stops scheduling new tasks after the first error; in-flight tasks are
 * allowed to settle, then the first error is rethrown.
 */
export async function runWithConcurrency({
  taskCount,
  concurrency,
  runTask,
}: {
  taskCount: number;
  concurrency: number;
  runTask: (index: number) => Promise<void>;
}): Promise<void> {
  let next = 0;
  let firstError: unknown = null;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, taskCount)) },
    async () => {
      while (firstError === null) {
        const index = next++;
        if (index >= taskCount) return;
        try {
          await runTask(index);
        } catch (err) {
          firstError ??= err;
          return;
        }
      }
    }
  );
  await Promise.all(workers);
  if (firstError !== null) throw firstError;
}

/**
 * Like runWithConcurrency, but errors matching `isDeferrable` don't fail the
 * run: the task is deferred and, once every in-flight task has settled, the
 * deferred tasks are retried one at a time. Built for Stage5 credit
 * reservations — N concurrent LLM calls transiently reserve N× the credits,
 * so a 402 under concurrency may succeed once siblings settle and refund.
 * A deferrable error during the serial retry is genuine and propagates.
 */
export async function runWithConcurrencySerialFallback({
  taskCount,
  concurrency,
  runTask,
  isDeferrable,
  onFallback,
  serialRetry,
}: {
  taskCount: number;
  concurrency: number;
  runTask: (index: number) => Promise<void>;
  isDeferrable: (err: unknown) => boolean;
  onFallback?: (deferredCount: number) => void;
  /**
   * During the serial phase, errors matching `shouldRetry` wait and retry
   * the same task, up to `maxAttempts` per task — for rejections that clear
   * on their own (e.g. server admission limits with Retry-After).
   * `shouldRetry` receives the per-task attempt count so callers can give
   * different error classes different patience. `delayMsFor` overrides the
   * fixed `delayMs` per error (e.g. honoring a server Retry-After header);
   * `maxTotalDelayMs` bounds the cumulative wait per task — when the next
   * delay would exceed the remaining budget the error propagates instead.
   * When `signal` aborts, an in-progress delay resolves immediately so the
   * next runTask attempt can observe the cancellation without waiting.
   */
  serialRetry?: {
    shouldRetry: (err: unknown, attemptsSoFar: number) => boolean;
    delayMs: number;
    delayMsFor?: (err: unknown) => number | undefined;
    maxAttempts: number;
    maxTotalDelayMs?: number;
    signal?: AbortSignal;
  };
}): Promise<void> {
  const deferred: number[] = [];
  let fallbackMode = false;

  await runWithConcurrency({
    taskCount,
    concurrency,
    runTask: async index => {
      if (fallbackMode) {
        deferred.push(index);
        return;
      }
      try {
        await runTask(index);
      } catch (err) {
        if (isDeferrable(err)) {
          fallbackMode = true;
          deferred.push(index);
          return;
        }
        throw err;
      }
    },
  });

  if (deferred.length > 0) {
    onFallback?.(deferred.length);
    deferred.sort((a, b) => a - b);
    for (const index of deferred) {
      let attempts = 0;
      let totalDelayMs = 0;
      for (;;) {
        try {
          await runTask(index);
          break;
        } catch (err) {
          if (
            serialRetry &&
            attempts < serialRetry.maxAttempts &&
            serialRetry.shouldRetry(err, attempts)
          ) {
            const delay = serialRetry.delayMsFor?.(err) ?? serialRetry.delayMs;
            const budget = serialRetry.maxTotalDelayMs ?? Infinity;
            if (totalDelayMs + delay > budget) {
              throw err;
            }
            attempts++;
            totalDelayMs += delay;
            await delayWithAbort(delay, serialRetry.signal);
            continue;
          }
          throw err;
        }
      }
    }
  }
}
