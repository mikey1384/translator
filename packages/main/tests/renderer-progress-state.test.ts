import assert from 'node:assert/strict';
import test from 'node:test';
import { BoundedRecentMap } from '../../renderer/utils/bounded-recent-map.js';
import {
  acceptProgressOperation,
  classifyHighlightProgressStage,
  classifyTerminalProgress,
  isHighlightProgressTerminalStage,
} from '../../renderer/utils/progress-terminal.js';
import { resolveTaskLifecycle } from '../../renderer/state/task-state-transition.js';
import { isExplicitCancellation } from '../../shared/cancelled-error.js';

test('bounded recent maps evict only the oldest retained operation', () => {
  const recent = new BoundedRecentMap<string, number>(2);
  recent.set('first', 1).set('second', 2);
  recent.set('first', 3); // refresh insertion order
  recent.set('third', 4);

  assert.equal(recent.size, 2);
  assert.equal(recent.get('first'), 3);
  assert.equal(recent.has('second'), false);
  assert.equal(recent.get('third'), 4);
});

test('terminal progress uses structured outcomes without stage substrings', () => {
  assert.equal(
    classifyTerminalProgress({
      stage: 'Cannot cancel during final save',
      percent: 80,
    }),
    null
  );
  assert.equal(
    classifyTerminalProgress({ stage: 'Error recovery pass', percent: 70 }),
    null
  );
  assert.equal(
    classifyTerminalProgress({
      stage: 'anything',
      percent: 100,
      error: 'backend failed',
    }),
    'failed'
  );
  assert.equal(
    classifyTerminalProgress({ stage: '__i18n__:process_cancelled' }),
    'cancelled'
  );
  assert.equal(
    classifyTerminalProgress({ stage: '__i18n__:completed', percent: 99 }),
    'completed'
  );
});

test('known cancellation contracts stay exact without keyword heuristics', () => {
  assert.equal(isExplicitCancellation(new Error('Process cancelled')), true);
  assert.equal(
    isExplicitCancellation(new Error('Operation cancelled by user')),
    true
  );
  assert.equal(
    isExplicitCancellation(new Error('Cannot cancel during final save')),
    false
  );
});

test('the first terminal packet seals an operation against duplicates and late progress', () => {
  const terminalOperations = new BoundedRecentMap<string, true>(4);

  assert.equal(
    acceptProgressOperation(terminalOperations, 'dub-1', null),
    true
  );
  assert.equal(
    acceptProgressOperation(
      terminalOperations,
      'dub-1',
      classifyTerminalProgress({ percent: 100, stage: 'ready' })
    ),
    true
  );
  assert.equal(
    acceptProgressOperation(terminalOperations, 'dub-1', 'failed'),
    false
  );
  assert.equal(
    acceptProgressOperation(terminalOperations, 'dub-1', null),
    false
  );
  assert.equal(
    acceptProgressOperation(terminalOperations, 'dub-2', null),
    true
  );
});

test('highlight terminal stages require exact protocol values', () => {
  assert.equal(classifyHighlightProgressStage('readying frames'), 'cutting');
  assert.equal(isHighlightProgressTerminalStage('readying frames'), false);
  assert.equal(classifyHighlightProgressStage('ready'), 'ready');
  assert.equal(isHighlightProgressTerminalStage('ready'), true);
  assert.equal(classifyHighlightProgressStage('cancelled'), 'cancelled');
  assert.equal(classifyHighlightProgressStage('error'), 'error');
});

test('100 percent does not turn a failed task into a completed task', () => {
  const running = { inProgress: true, isCompleted: false };

  assert.deepEqual(
    resolveTaskLifecycle(running, {
      percent: 100,
      inProgress: false,
      isCompleted: false,
    }),
    { inProgress: false, isCompleted: false }
  );
  assert.deepEqual(resolveTaskLifecycle(running, { percent: 100 }), running);
  assert.deepEqual(resolveTaskLifecycle(running, { isCompleted: true }), {
    inProgress: false,
    isCompleted: true,
  });
});

test('ordinary progress opens a new active state and clears stale completion', () => {
  assert.deepEqual(
    resolveTaskLifecycle(
      { inProgress: false, isCompleted: true },
      { percent: 30 }
    ),
    { inProgress: true, isCompleted: false }
  );
  assert.deepEqual(
    resolveTaskLifecycle(
      { inProgress: false, isCompleted: true },
      { percent: 0, inProgress: true, isCompleted: false }
    ),
    { inProgress: true, isCompleted: false }
  );
  assert.deepEqual(
    resolveTaskLifecycle({ inProgress: false }, { inProgress: false }),
    { inProgress: false, isCompleted: false }
  );
  assert.deepEqual(
    resolveTaskLifecycle(
      { inProgress: false, isCompleted: false },
      { inProgress: true, isCompleted: true }
    ),
    { inProgress: false, isCompleted: true },
    'contradictory explicit flags must preserve the terminal invariant'
  );
});
