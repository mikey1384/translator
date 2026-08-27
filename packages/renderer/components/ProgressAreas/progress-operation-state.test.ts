import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProgressOperationComplete } from './progress-operation-state';

test('preserves legacy percent-based completion when lifecycle is omitted', () => {
  assert.equal(resolveProgressOperationComplete(99.9), false);
  assert.equal(resolveProgressOperationComplete(100), true);
});

test('explicit active lifecycle keeps a 100% subphase cancellable', () => {
  assert.equal(resolveProgressOperationComplete(100, false), false);
});

test('explicit terminal lifecycle wins over an incomplete percentage', () => {
  assert.equal(resolveProgressOperationComplete(42, true), true);
});
