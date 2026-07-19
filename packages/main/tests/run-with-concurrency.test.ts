import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWithConcurrency,
  runWithConcurrencySerialFallback,
} from '../services/subtitle-processing/concurrency.js';
import {
  isTranslationAdmissionLimitError,
  isProviderRateLimitError,
  toAdmissionMarkerError,
} from '../services/subtitle-processing/errors.js';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('runWithConcurrency runs every task once with bounded concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const done = new Set<number>();
  await runWithConcurrency({
    taskCount: 20,
    concurrency: 4,
    runTask: async i => {
      assert.ok(!done.has(i), `task ${i} ran twice`);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await sleep(5);
      inFlight--;
      done.add(i);
    },
  });
  assert.equal(done.size, 20);
  assert.ok(peak <= 4, `peak concurrency ${peak} exceeded 4`);
});

test('runWithConcurrency stops scheduling after the first error and rethrows it', async () => {
  const started: number[] = [];
  await assert.rejects(
    runWithConcurrency({
      taskCount: 100,
      concurrency: 3,
      runTask: async i => {
        started.push(i);
        await sleep(2);
        if (i === 4) throw new Error('boom');
      },
    }),
    /boom/
  );
  assert.ok(started.length < 20, `started ${started.length} tasks after error`);
});

test('serial fallback retries credit-pressure failures sequentially', async () => {
  // Simulate a balance that funds exactly one concurrent reservation:
  // any task that starts while another is in flight fails with a 402.
  let inFlight = 0;
  const completed: number[] = [];
  const failedOnce: number[] = [];
  await runWithConcurrencySerialFallback({
    taskCount: 8,
    concurrency: 4,
    isDeferrable: err => String(err).includes('INSUFFICIENT_CREDITS'),
    runTask: async i => {
      inFlight++;
      try {
        await sleep(5);
        if (inFlight > 1) {
          failedOnce.push(i);
          throw new Error('INSUFFICIENT_CREDITS');
        }
        completed.push(i);
      } finally {
        inFlight--;
      }
    },
  });
  assert.equal(completed.length, 8, 'every task eventually completed');
  assert.ok(failedOnce.length > 0, 'the scenario exercised credit pressure');
});

test('serial fallback propagates a genuine (serial) credit failure', async () => {
  await assert.rejects(
    runWithConcurrencySerialFallback({
      taskCount: 4,
      concurrency: 2,
      isDeferrable: err => String(err).includes('INSUFFICIENT_CREDITS'),
      runTask: async () => {
        throw new Error('INSUFFICIENT_CREDITS');
      },
    }),
    /INSUFFICIENT_CREDITS/
  );
});

test('serial retry waits out admission-style rejections until a slot frees', async () => {
  // Slot frees after the 2nd retry attempt of each deferred task.
  const attemptsPerTask = new Map<number, number>();
  const completed: number[] = [];
  let concurrentPhase = true;
  await runWithConcurrencySerialFallback({
    taskCount: 4,
    concurrency: 4,
    isDeferrable: err => String(err).includes('ADMISSION'),
    serialRetry: {
      shouldRetry: err => String(err).includes('ADMISSION'),
      delayMs: 5,
      maxAttempts: 5,
    },
    runTask: async i => {
      if (concurrentPhase && i > 0) {
        concurrentPhase = false;
        throw new Error('ADMISSION');
      }
      const attempts = (attemptsPerTask.get(i) ?? 0) + 1;
      attemptsPerTask.set(i, attempts);
      if (!completed.includes(i) && attempts < 2 && i > 0) {
        throw new Error('ADMISSION');
      }
      completed.push(i);
    },
  });
  assert.equal(new Set(completed).size, 4, 'every task eventually completed');
});

test('serial retry gives up after maxAttempts and propagates', async () => {
  let calls = 0;
  await assert.rejects(
    runWithConcurrencySerialFallback({
      taskCount: 2,
      concurrency: 2,
      isDeferrable: err => String(err).includes('ADMISSION'),
      serialRetry: {
        shouldRetry: err => String(err).includes('ADMISSION'),
        delayMs: 2,
        maxAttempts: 3,
      },
      runTask: async () => {
        calls++;
        throw new Error('ADMISSION');
      },
    }),
    /ADMISSION/
  );
  // first deferred task: 1 initial (concurrent) + 1 serial + 3 retries = 5
  assert.ok(calls <= 8, `unexpected call count ${calls}`);
});

test('admission classifier recognizes axios shapes and re-wrapped messages', () => {
  // Raw axios error from the job endpoint.
  const axiosErr: any = new Error('Request failed with status code 429');
  axiosErr.response = {
    status: 429,
    data: { error: 'too-many-active-translations' },
  };
  assert.ok(isTranslationAdmissionLimitError(axiosErr));

  // What callAIModel throws after preserving the marker in the message.
  assert.ok(
    isTranslationAdmissionLimitError(new Error('too-many-active-translations'))
  );
  assert.ok(
    isTranslationAdmissionLimitError(
      new Error('Stage5 API call failed: translation-rate-limit')
    )
  );

  // Global backlog (503) marker, in both shapes.
  const overload: any = new Error('Request failed with status code 503');
  overload.response = {
    status: 503,
    data: { error: 'translation-queue-overloaded' },
  };
  assert.ok(isTranslationAdmissionLimitError(overload));
  assert.ok(
    isTranslationAdmissionLimitError(new Error('translation-queue-overloaded'))
  );

  // The human-readable message from the queued endpoint's generic throw
  // must NOT match — the marker, not prose, is the contract.
  assert.ok(
    !isTranslationAdmissionLimitError(
      new Error('Too many active translation jobs for this device.')
    )
  );

  // The lossy generic wrap must NOT match (this was the P1 bug).
  assert.ok(
    !isTranslationAdmissionLimitError(
      new Error('Stage5 API call failed: Request failed with status code 429')
    )
  );
  assert.ok(!isTranslationAdmissionLimitError(new Error('boom')));
});

test('toAdmissionMarkerError preserves markers and retry metadata', () => {
  // A crafted upstream error (marker in message, retryAfterSec attached)
  // passes through unchanged — same object, marker and cadence intact.
  const crafted: any = new Error('translation-rate-limit');
  crafted.retryAfterSec = 60;
  const passedThrough = toAdmissionMarkerError(crafted);
  assert.equal(passedThrough, crafted);
  assert.equal((passedThrough as any).retryAfterSec, 60);
  assert.equal(passedThrough.message, 'translation-rate-limit');

  // An axios-shaped error gets its actual marker (not the default) and the
  // Retry-After header parsed onto the normalized error.
  const axiosErr: any = new Error('Request failed with status code 429');
  axiosErr.response = {
    status: 429,
    data: { error: 'translation-rate-limit' },
    headers: { 'retry-after': '45' },
  };
  const normalized = toAdmissionMarkerError(axiosErr);
  assert.equal(normalized.message, 'translation-rate-limit');
  assert.equal((normalized as any).retryAfterSec, 45);

  // No metadata → default marker, no retryAfterSec.
  const bare = toAdmissionMarkerError(new Error('mystery'));
  assert.equal(bare.message, 'too-many-active-translations');
  assert.equal((bare as any).retryAfterSec, undefined);
});

test('provider rate-limit classifier matches BYO error codes only', () => {
  assert.ok(isProviderRateLimitError(new Error('openai-rate-limit')));
  assert.ok(isProviderRateLimitError(new Error('anthropic-rate-limit')));
  assert.ok(!isProviderRateLimitError(new Error('openai-key-invalid')));
  assert.ok(!isProviderRateLimitError(new Error('insufficient-credits')));
  assert.ok(!isProviderRateLimitError(new Error('boom')));
});

test('cancellation wakes a sleeping serial retry immediately', async () => {
  const controller = new AbortController();
  const startedAt = Date.now();
  let sawAbortError = false;

  const run = runWithConcurrencySerialFallback({
    taskCount: 1,
    concurrency: 1,
    isDeferrable: err => String(err).includes('ADMISSION'),
    serialRetry: {
      shouldRetry: err =>
        String(err).includes('ADMISSION') && !controller.signal.aborted,
      delayMs: 60_000, // would stall a full minute without abort support
      maxAttempts: 3,
      signal: controller.signal,
    },
    runTask: async () => {
      if (controller.signal.aborted) {
        sawAbortError = true;
        throw new DOMException('Operation cancelled', 'AbortError');
      }
      throw new Error('ADMISSION');
    },
  });

  setTimeout(() => controller.abort(), 50);
  await assert.rejects(run, /Operation cancelled/);
  const elapsed = Date.now() - startedAt;
  assert.ok(sawAbortError, 'runTask observed the cancellation');
  assert.ok(
    elapsed < 5_000,
    `cancel took ${elapsed}ms; delay was not abortable`
  );
});

test('serial retry passes attempt counts so callers can bound per-class patience', async () => {
  // Credits-style: retry twice, then treat as genuine and propagate.
  let calls = 0;
  await assert.rejects(
    runWithConcurrencySerialFallback({
      taskCount: 2,
      concurrency: 2,
      isDeferrable: err => String(err).includes('CREDITS'),
      serialRetry: {
        shouldRetry: (err, attemptsSoFar) =>
          String(err).includes('CREDITS') && attemptsSoFar < 2,
        delayMs: 2,
        maxAttempts: 10,
      },
      runTask: async () => {
        calls++;
        throw new Error('CREDITS');
      },
    }),
    /CREDITS/
  );
  // 2 concurrent + first deferred task: 1 serial + 2 retries = 3.
  assert.ok(calls <= 6, `unexpected call count ${calls}`);
});

test('serial retry honors per-error delays and the total-delay budget', async () => {
  const delays: number[] = [];
  const startedAt = Date.now();
  await assert.rejects(
    runWithConcurrencySerialFallback({
      taskCount: 1,
      concurrency: 1,
      isDeferrable: err => String(err).includes('ADMISSION'),
      serialRetry: {
        shouldRetry: err => String(err).includes('ADMISSION'),
        delayMs: 1,
        delayMsFor: err => {
          const retryAfter = (err as any).retryAfterSec;
          const ms = retryAfter ? retryAfter * 10 : undefined; // scaled for test
          if (ms !== undefined) delays.push(ms);
          return ms;
        },
        maxAttempts: 100,
        maxTotalDelayMs: 100, // budget forces give-up before maxAttempts
      },
      runTask: async () => {
        const err: any = new Error('ADMISSION');
        err.retryAfterSec = 4; // -> 40ms per retry in this test's scale
        throw err;
      },
    }),
    /ADMISSION/
  );
  assert.ok(delays.length >= 1, 'per-error delay was consulted');
  assert.ok(
    delays.every(d => d === 40),
    `expected Retry-After-derived delays, got ${delays.join(',')}`
  );
  // Budget 100ms with 40ms delays => at most 2 waits before giving up.
  assert.ok(
    delays.length <= 3,
    `budget did not bound retries: ${delays.length}`
  );
  assert.ok(Date.now() - startedAt < 2_000, 'gave up within the budget');
});

test('serial fallback rethrows non-deferrable errors immediately', async () => {
  await assert.rejects(
    runWithConcurrencySerialFallback({
      taskCount: 4,
      concurrency: 2,
      isDeferrable: () => false,
      runTask: async i => {
        if (i === 1) throw new Error('fatal');
      },
    }),
    /fatal/
  );
});
