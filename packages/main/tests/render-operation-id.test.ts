import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  renderOperationPathToken,
  requireRenderOperationId,
} from '../utils/render-operation-id.js';
import { assertRenderOperationAvailable } from '../../renderer/utils/render-operation-reservation.js';

test('render operation IDs reject traversal, controls, and oversized input', () => {
  assert.equal(requireRenderOperationId('render-123'), 'render-123');
  assert.equal(
    requireRenderOperationId(
      'agent-history:merge:00000000-0000-4000-8000-000000000001'
    ),
    'agent-history:merge:00000000-0000-4000-8000-000000000001'
  );
  for (const invalid of [
    '',
    '../escape',
    'nested/path',
    'nested\\path',
    'line\nbreak',
    `render-${'x'.repeat(200)}`,
    null,
  ]) {
    assert.throws(() => requireRenderOperationId(invalid), /Invalid/);
  }
});

test('render path tokens are portable, deterministic, and identity-specific', () => {
  const first = renderOperationPathToken('agent-history:merge:one');
  const same = renderOperationPathToken('agent-history:merge:one');
  const distinct = renderOperationPathToken('agent-history-merge-one');

  assert.equal(first, same);
  assert.notEqual(first, distinct);
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.equal(path.basename(first), first);
  assert.equal(first.includes(':'), false);
});

test('a duplicate active render cannot replace the original promise callbacks', () => {
  const pending = new Map<string, unknown>([['render-123', {}]]);

  assert.throws(
    () => assertRenderOperationAvailable(pending, 'render-123'),
    /already pending/
  );
  assert.doesNotThrow(() =>
    assertRenderOperationAvailable(pending, 'render-456')
  );
  assert.equal(pending.has('render-123'), true);
});
