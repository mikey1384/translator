import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRetryableDubDirectError,
  shouldRetryDubDirectRequest,
} from '../services/stage5-client-retry.ts';

test('isRetryableDubDirectError retries relay cancellation responses', () => {
  const error = {
    response: {
      status: 408,
      data: {
        error: 'Request cancelled',
        message: 'Request was cancelled',
      },
    },
    message: 'Request failed with status code 408',
  };

  assert.equal(isRetryableDubDirectError(error), true);
});

test('isRetryableDubDirectError retries transport failures without a response', () => {
  const error = {
    code: 'ECONNRESET',
    request: {},
    message: 'socket hang up',
  };

  assert.equal(isRetryableDubDirectError(error), true);
});

test('isRetryableDubDirectError rejects auth and quota failures', () => {
  assert.equal(
    isRetryableDubDirectError({
      response: { status: 401, data: { error: 'Unauthorized' } },
      message: 'Request failed with status code 401',
    }),
    false
  );

  assert.equal(
    isRetryableDubDirectError({
      response: { status: 402, data: { error: 'Insufficient credits' } },
      message: 'Request failed with status code 402',
    }),
    false
  );
});

test('isRetryableDubDirectError does not retry successful responses', () => {
  assert.equal(
    isRetryableDubDirectError({
      response: { status: 204, data: { message: 'timeout while draining' } },
      request: {},
      message: 'timeout while draining',
    }),
    false
  );
});

test('shouldRetryDubDirectRequest requires an idempotency key', () => {
  const error = {
    response: {
      status: 408,
      data: {
        error: 'Request cancelled',
        message: 'Request was cancelled',
      },
    },
    message: 'Request failed with status code 408',
  };

  assert.equal(
    shouldRetryDubDirectRequest({
      error,
      attempt: 1,
      maxAttempts: 2,
      hasIdempotencyKey: false,
    }),
    false
  );
});

test('shouldRetryDubDirectRequest retries only while attempts remain', () => {
  const error = {
    code: 'ECONNRESET',
    request: {},
    message: 'socket hang up',
  };

  assert.equal(
    shouldRetryDubDirectRequest({
      error,
      attempt: 1,
      maxAttempts: 2,
      hasIdempotencyKey: true,
    }),
    true
  );

  assert.equal(
    shouldRetryDubDirectRequest({
      error,
      attempt: 2,
      maxAttempts: 2,
      hasIdempotencyKey: true,
    }),
    false
  );
});
