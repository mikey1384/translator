import assert from 'node:assert/strict';
import test from 'node:test';

import { describeTaskFailure } from '../utils/task-failure.js';
import { shouldRetrySerialBatch } from '../services/subtitle-processing/errors.js';
import { isRetryableDubDirectError } from '../services/stage5-client-retry.js';

test('a credit refusal is a failure with its own stage, never a cancel', () => {
  for (const error of [
    new Error('insufficient-credits'),
    { response: { status: 402 } },
  ]) {
    assert.deepEqual(describeTaskFailure(error), {
      insufficientCredits: true,
      cancelled: false,
      stage: '__i18n__:insufficient_credits',
      error: 'insufficient-credits',
    });
  }
});

test('a user cancel wins over a refusal that raced it', () => {
  const failure = describeTaskFailure(new Error('insufficient-credits'), {
    aborted: true,
  });
  assert.equal(failure.cancelled, true);
  assert.equal(failure.stage, '__i18n__:process_cancelled');
  assert.equal(failure.error, undefined);
});

test('other failures send a token stage and keep the detail as the error', () => {
  assert.deepEqual(
    describeTaskFailure(new Error('Request failed with status code 500')),
    {
      insufficientCredits: false,
      cancelled: false,
      stage: '__i18n__:error',
      error: 'Request failed with status code 500',
    }
  );
});

test('serial batches never retry a 402, but wait out admission and rate limits', () => {
  assert.equal(
    shouldRetrySerialBatch(new Error('insufficient-credits')),
    false
  );
  assert.equal(
    shouldRetrySerialBatch({ response: { status: 402 }, message: 'x' }),
    false
  );
  assert.equal(
    shouldRetrySerialBatch(new Error('too-many-active-translations')),
    true
  );
  assert.equal(shouldRetrySerialBatch(new Error('openai-rate-limit')), true);
  const controller = new AbortController();
  controller.abort();
  assert.equal(
    shouldRetrySerialBatch(
      new Error('too-many-active-translations'),
      controller.signal
    ),
    false
  );
});

test('a 402 from the dub relay is never retried', () => {
  assert.equal(
    isRetryableDubDirectError({
      response: { status: 402, data: { error: 'rate limit' } },
    }),
    false
  );
});
