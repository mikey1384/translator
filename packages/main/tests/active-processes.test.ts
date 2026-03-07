import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  consumeCancelMarker,
  markCancelled,
} from '../utils/cancel-markers.ts';
import { attachAutoCancelListeners } from '../utils/auto-cancel-listeners.ts';

class FakeWebContents extends EventEmitter {}

test('auto-cancel cleanup removes listeners for completed operations', () => {
  const operationId = 'auto-cancel-cleanup';
  const wc = new FakeWebContents();
  let cancelled = 0;

  const cleanup = attachAutoCancelListeners(
    wc as any,
    operationId,
    () => {
      cancelled += 1;
    }
  );

  assert.equal(wc.listenerCount('destroyed'), 1);
  assert.equal(wc.listenerCount('render-process-gone'), 1);
  assert.equal(wc.listenerCount('will-navigate'), 1);
  assert.equal(wc.listenerCount('did-start-navigation'), 1);

  cleanup();

  assert.equal(wc.listenerCount('destroyed'), 0);
  assert.equal(wc.listenerCount('render-process-gone'), 0);
  assert.equal(wc.listenerCount('will-navigate'), 0);
  assert.equal(wc.listenerCount('did-start-navigation'), 0);

  wc.emit('destroyed');
  assert.equal(cancelled, 0);
});

test('reload auto-cancel invokes the callback once', async () => {
  const operationId = 'auto-cancel-reload';
  const wc = new FakeWebContents();
  let cancelled = 0;

  attachAutoCancelListeners(wc as any, operationId, () => {
    cancelled += 1;
  });

  wc.emit(
    'did-start-navigation',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { isReload: true }
  );
  await Promise.resolve();

  assert.equal(cancelled, 1);
});

test('cancel markers survive a mark/consume round-trip exactly once', () => {
  const operationId = 'cancel-marker-roundtrip';

  markCancelled(operationId);

  assert.equal(consumeCancelMarker(operationId), true);
  assert.equal(consumeCancelMarker(operationId), false);
});
