import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentHistoryJobRegistry,
  AgentTerminalOperationRegistry,
  agentProgressTaskFor,
  shouldReuseAgentOperation,
  usesMainOperationCancellation,
} from './agent-history-jobs';

test('idempotent operation replay preserves accepted and completed work', () => {
  assert.equal(shouldReuseAgentOperation('running'), true);
  assert.equal(shouldReuseAgentOperation('cancelling'), true);
  assert.equal(shouldReuseAgentOperation('completed'), true);
});

test('failed and cancelled operations remain explicitly retryable', () => {
  assert.equal(shouldReuseAgentOperation('failed'), false);
  assert.equal(shouldReuseAgentOperation('cancelled'), false);
  assert.equal(shouldReuseAgentOperation('idle'), false);
});

test('a failed history operation can restart with the same stable ID', () => {
  const jobs = new AgentHistoryJobRegistry();
  jobs.start({
    historyId: 'history-1',
    operationId: 'stable-operation-id',
    kind: 'translation',
    stage: 'preparing-translation',
  });
  jobs.finish('history-1', 'stable-operation-id', {
    status: 'failed',
    error: 'temporary failure',
  });

  const restarted = jobs.start({
    historyId: 'history-1',
    operationId: 'stable-operation-id',
    kind: 'translation',
    stage: 'preparing-translation',
  });

  assert.equal(restarted.status, 'running');
  assert.equal(restarted.inProgress, true);
  assert.equal(restarted.error, null);
  assert.equal(restarted.operationId, 'stable-operation-id');
});

test('terminal mounted operations remain addressable after later work', () => {
  const operations = new AgentTerminalOperationRegistry(2);
  operations.record({
    id: 'one',
    status: 'completed',
    result: { path: '/one' },
  });
  operations.record({ id: 'two', status: 'failed', error: 'failed' });

  assert.deepEqual(operations.get('one'), {
    id: 'one',
    status: 'completed',
    result: { path: '/one' },
  });
  operations.record({ id: 'three', status: 'cancelled' });
  assert.equal(operations.get('one'), null);
  assert.equal(operations.size(), 2);
});

test('history terminal results remain addressable by exact operation ID', () => {
  const jobs = new AgentHistoryJobRegistry();
  jobs.start({
    historyId: 'history-1',
    operationId: 'operation-1',
    kind: 'transcription',
    stage: 'transcribing',
  });
  jobs.finish('history-1', 'operation-1', {
    status: 'completed',
    result: { cueCount: 12 },
  });
  jobs.start({
    historyId: 'history-1',
    operationId: 'operation-2',
    kind: 'translation',
    stage: 'translating',
  });

  const retained = jobs.getByOperationId('operation-1');
  assert.equal(retained?.status, 'completed');
  assert.deepEqual(retained?.result, { cueCount: 12 });
  assert.equal(jobs.get('history-1')?.operationId, 'operation-2');
});

test('preset encoding cancellation targets the main FFmpeg operation', () => {
  assert.equal(
    usesMainOperationCancellation(
      'preset-render',
      'encoding youtube_1080p (1/1)'
    ),
    true
  );
  assert.equal(
    usesMainOperationCancellation('preset-render', 'rendering subtitle master'),
    false
  );
  assert.equal(usesMainOperationCancellation('merge', 'merging'), false);
});

test('media workflow progress follows the stage that is actually running', () => {
  assert.equal(
    agentProgressTaskFor('media-workflow', 'downloading'),
    'download'
  );
  assert.equal(
    agentProgressTaskFor('media-workflow', 'transcribing'),
    'transcription'
  );
  assert.equal(
    agentProgressTaskFor('media-workflow', 'translating'),
    'translation'
  );
  assert.equal(
    agentProgressTaskFor('media-workflow', 'summarizing'),
    'summary'
  );
  assert.equal(agentProgressTaskFor('media-workflow', 'dubbing'), 'dubbing');
});

test('history jobs retain credit observations through terminal failure', () => {
  const jobs = new AgentHistoryJobRegistry();
  jobs.start({
    historyId: 'history-credit',
    operationId: 'operation-credit',
    kind: 'transcription',
    stage: 'transcribing',
  });
  jobs.update('history-credit', 'operation-credit', {
    creditUsage: { stage5_credits_consumed: 42 },
    percent: 37,
  });
  jobs.finish('history-credit', 'operation-credit', {
    status: 'failed',
    error: 'provider failed after settlement',
  });
  assert.deepEqual(jobs.getByOperationId('operation-credit')?.creditUsage, {
    stage5_credits_consumed: 42,
  });
  assert.equal(jobs.getByOperationId('operation-credit')?.percent, 37);
});
