import assert from 'node:assert/strict';
import test from 'node:test';
import { SerializedLatestState } from '../utils/serialized-latest-state.js';

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

test('latest state wins across a delayed transition and shutdown is terminal', async () => {
  let releaseEnable: (() => void) | undefined;
  const enableGate = new Promise<void>(resolve => {
    releaseEnable = resolve;
  });
  const transitions: boolean[] = [];
  const state = new SerializedLatestState(false, async enabled => {
    transitions.push(enabled);
    if (enabled) await enableGate;
  });

  const enabling = state.set(true);
  await nextTurn();
  assert.deepEqual(transitions, [true]);

  const disabling = state.set(false);
  const shutdown = state.shutdown(false);
  const lateEnable = state.set(true);
  releaseEnable?.();
  await Promise.all([enabling, disabling, shutdown, lateEnable]);

  assert.equal(transitions[0], true);
  assert.ok(
    transitions.slice(1).every(enabled => !enabled),
    'no queued or post-shutdown transition may re-enable the resource'
  );
  assert.equal(transitions.at(-1), false);
});

test('a failed state transition does not prevent terminal shutdown', async () => {
  const transitions: boolean[] = [];
  let failFirst = true;
  const state = new SerializedLatestState(false, async enabled => {
    transitions.push(enabled);
    if (failFirst) {
      failFirst = false;
      throw new Error('start failed');
    }
  });

  await assert.rejects(state.set(true), /start failed/);
  await state.shutdown(false);

  assert.deepEqual(transitions, [true, false]);
});

test('requests queued in one turn apply the latest desired state', async () => {
  const transitions: boolean[] = [];
  const state = new SerializedLatestState(false, async enabled => {
    transitions.push(enabled);
  });

  const enabling = state.set(true);
  const disabling = state.set(false);
  await Promise.all([enabling, disabling]);

  assert.deepEqual(transitions, [false, false]);
});
