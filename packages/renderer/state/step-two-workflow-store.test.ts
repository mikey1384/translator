import test from 'node:test';
import assert from 'node:assert/strict';

import { useStepTwoWorkflowStore } from './step-two-workflow-store';

test('step two workflow tracks translate intent through handoff and running phases', () => {
  useStepTwoWorkflowStore.getState().clearWorkflow();

  const runToken = useStepTwoWorkflowStore.getState().startWorkflow({
    kind: 'translate',
    language: 'spanish',
    sourceKey: 'path:/tmp/video.mp4',
    transcriptionOperationId: 'transcribe-1',
  });

  let state = useStepTwoWorkflowStore.getState();
  assert.equal(state.kind, 'translate');
  assert.equal(state.phase, 'transcribing');
  assert.equal(state.language, 'spanish');
  assert.equal(state.sourceKey, 'path:/tmp/video.mp4');
  assert.equal(state.transcriptionOperationId, 'transcribe-1');
  assert.equal(state.followUpId, null);

  state.transitionToHandoff({
    expectedRunToken: runToken,
    followUpId: 'request-1',
  });

  state = useStepTwoWorkflowStore.getState();
  assert.equal(state.phase, 'handoff');
  assert.equal(state.followUpId, 'request-1');

  state.transitionToRunning({
    expectedRunToken: runToken,
    followUpId: 'translate-1',
  });

  state = useStepTwoWorkflowStore.getState();
  assert.equal(state.phase, 'running');
  assert.equal(state.followUpId, 'translate-1');

  state.clearWorkflow({ expectedRunToken: runToken });

  state = useStepTwoWorkflowStore.getState();
  assert.equal(state.kind, null);
  assert.equal(state.phase, null);
  assert.equal(state.transcriptionOperationId, null);
  assert.equal(state.followUpId, null);
  assert.equal(state.language, null);
  assert.equal(state.sourceKey, null);
});

test('stale run tokens cannot mutate a newer step two workflow', () => {
  useStepTwoWorkflowStore.getState().clearWorkflow();

  const staleRunToken = useStepTwoWorkflowStore.getState().startWorkflow({
    kind: 'translate',
    language: 'french',
    sourceKey: 'path:/tmp/old.mp4',
    transcriptionOperationId: 'transcribe-old',
  });

  const currentRunToken = useStepTwoWorkflowStore.getState().startWorkflow({
    kind: 'highlight',
    language: 'english',
    sourceKey: 'path:/tmp/new.mp4',
    transcriptionOperationId: null,
  });

  const state = useStepTwoWorkflowStore.getState();
  state.transitionToRunning({
    expectedRunToken: staleRunToken,
    followUpId: 'translate-old',
  });
  state.clearWorkflow({ expectedRunToken: staleRunToken });

  let nextState = useStepTwoWorkflowStore.getState();
  assert.equal(nextState.kind, 'highlight');
  assert.equal(nextState.phase, 'handoff');
  assert.equal(nextState.language, 'english');
  assert.equal(nextState.sourceKey, 'path:/tmp/new.mp4');

  nextState.transitionToRunning({
    expectedRunToken: currentRunToken,
    followUpId: 42,
  });

  nextState = useStepTwoWorkflowStore.getState();
  assert.equal(nextState.phase, 'running');
  assert.equal(nextState.followUpId, 42);
});
