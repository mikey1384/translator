import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelMergeOperation,
  usesMainProcessMergeCancellation,
} from './merge-cancellation';

test('routes preset encoder cancellation through the main operation registry', async () => {
  const calls: string[] = [];
  const operationId = 'mcp-v2:job-id:render_outputs-encode-1';

  const result = await cancelMergeOperation(operationId, {
    cancelMainOperation: async id => {
      calls.push(`main:${id}`);
      return { success: true };
    },
    cancelSubtitleRender: async id => {
      calls.push(`subtitle:${id}`);
      return { accepted: true, reason: 'accepted' };
    },
  });

  assert.equal(usesMainProcessMergeCancellation(operationId), true);
  assert.deepEqual(calls, [`main:${operationId}`]);
  assert.deepEqual(result, { accepted: true, reason: 'accepted' });
});

test('keeps subtitle-master cancellation on the renderer cancellation channel', async () => {
  const calls: string[] = [];
  const operationId = 'mcp-v2:job-id:render_outputs-merge';

  const result = await cancelMergeOperation(operationId, {
    cancelMainOperation: async id => {
      calls.push(`main:${id}`);
      return { success: true };
    },
    cancelSubtitleRender: async id => {
      calls.push(`subtitle:${id}`);
      return { accepted: true, reason: 'accepted' };
    },
  });

  assert.equal(usesMainProcessMergeCancellation(operationId), false);
  assert.deepEqual(calls, [`subtitle:${operationId}`]);
  assert.deepEqual(result, { accepted: true, reason: 'accepted' });
});

test('reports a missing preset encoder instead of claiming cancellation', async () => {
  const result = await cancelMergeOperation('agent-render-encode-2', {
    cancelMainOperation: async () => ({ success: false }),
    cancelSubtitleRender: async () => ({
      accepted: true,
      reason: 'accepted',
    }),
  });

  assert.deepEqual(result, { accepted: false, reason: 'not_found' });
});
