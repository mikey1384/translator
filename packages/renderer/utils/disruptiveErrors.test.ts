import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isDisruptiveGlobalError,
  isDisruptiveTaskFailure,
  isExpectedUserFacingFailure,
} from './disruptiveErrors';

test('treats credits and provider quota errors as expected user-facing failures', () => {
  assert.equal(isExpectedUserFacingFailure('insufficient-credits'), true);
  assert.equal(
    isExpectedUserFacingFailure('openai-insufficient-quota'),
    true
  );
  assert.equal(
    isExpectedUserFacingFailure('Your OpenAI API key is invalid or expired.'),
    true
  );
});

test('does not report expected user/account state through global errors', () => {
  assert.equal(
    isDisruptiveGlobalError('insufficient-credits', 'operation'),
    false
  );
  assert.equal(
    isDisruptiveGlobalError(
      'Your OpenAI API key is invalid or expired.',
      'operation'
    ),
    false
  );
});

test('does not report generic failed stages when paired error is expected user state', () => {
  assert.equal(
    isDisruptiveTaskFailure({
      stage: 'Error',
      error: 'insufficient-credits',
    }),
    false
  );
  assert.equal(
    isDisruptiveTaskFailure({
      stage: 'Failed to continue',
      error: 'openai-insufficient-quota',
    }),
    false
  );
});

test('does not report friendly user-facing task messages', () => {
  assert.equal(
    isDisruptiveTaskFailure({
      stage: 'Your OpenAI credit is low. Add credits and try again.',
    }),
    false
  );
});

test('still reports genuine task failures', () => {
  assert.equal(
    isDisruptiveTaskFailure({
      stage: 'Failed to select highlight moments: upstream exception',
    }),
    true
  );
  assert.equal(
    isDisruptiveTaskFailure({
      stage: 'Error',
    }),
    true
  );
});
