import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { attachAutoCancelListeners } from '../utils/auto-cancel-listeners.js';

test('main-frame navigation cancels once after irrelevant navigation events', () => {
  const target = new EventEmitter();
  let cancellations = 0;
  const cleanup = attachAutoCancelListeners(target, 'operation-1', () => {
    cancellations += 1;
  });

  target.emit('did-start-navigation', {
    isMainFrame: false,
    isSameDocument: false,
  });
  target.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: true,
  });
  assert.equal(cancellations, 0);

  target.emit('did-start-navigation', {
    isMainFrame: true,
    isSameDocument: false,
  });
  target.emit('render-process-gone');
  target.emit('destroyed');
  assert.equal(cancellations, 1);

  cleanup();
  assert.equal(target.listenerCount('did-start-navigation'), 0);
});
