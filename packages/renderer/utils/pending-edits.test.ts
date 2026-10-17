import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flushPendingEdits,
  hasPendingEdits,
  registerPendingEdit,
  subscribePendingEdits,
} from './pending-edits';

test('flushPendingEdits commits every pending field and they unregister', () => {
  const committed: string[] = [];
  let changes = 0;
  const unsubscribe = subscribePendingEdits(() => changes++);
  let unregisterA = () => {};
  let unregisterB = () => {};
  unregisterA = registerPendingEdit(() => {
    committed.push('a');
    unregisterA();
  });
  unregisterB = registerPendingEdit(() => {
    committed.push('b');
    unregisterB();
  });
  assert.equal(hasPendingEdits(), true);
  flushPendingEdits();
  assert.deepEqual(committed, ['a', 'b']);
  assert.equal(hasPendingEdits(), false);
  // One notification when edits appeared, one when the last was committed.
  assert.equal(changes, 2);
  unsubscribe();
});

test('a failing flusher does not stop the others', () => {
  const committed: string[] = [];
  const unregisterBad = registerPendingEdit(() => {
    throw new Error('boom');
  });
  const originalError = console.error;
  console.error = () => {};
  let unregisterGood = () => {};
  unregisterGood = registerPendingEdit(() => {
    committed.push('good');
    unregisterGood();
  });
  try {
    flushPendingEdits();
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(committed, ['good']);
  unregisterBad();
});
