import assert from 'node:assert/strict';
import test from 'node:test';
import { createWindowCreationCoordinator } from '../window-creation-coordinator.js';

interface FakeWindow {
  id: number;
  destroyed: boolean;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('coalesces concurrent startup and macOS activate window requests', async () => {
  let current: FakeWindow | null = null;
  let createCount = 0;
  const pending = deferred<void>();
  const created = { id: 1, destroyed: false };
  const coordinator = createWindowCreationCoordinator<FakeWindow>({
    getCurrent: () => current,
    setCurrent: window => {
      current = window;
    },
    isDestroyed: window => window.destroyed,
    create: async () => {
      createCount += 1;
      // Electron publishes BrowserWindow before loadFile and first-tab setup
      // finish. Reproduce that interval so a later caller cannot escape early.
      current = created;
      await pending.promise;
      return created;
    },
  });

  const startupRequest = coordinator.ensure();
  const activateRequest = coordinator.ensure();
  await Promise.resolve();

  assert.equal(createCount, 1);
  assert.equal(coordinator.isCreating(), true);

  let lateRequestResolved = false;
  const lateRequest = coordinator.ensure().then(window => {
    lateRequestResolved = true;
    return window;
  });
  await Promise.resolve();
  assert.equal(lateRequestResolved, false);

  pending.resolve();
  assert.equal(await startupRequest, created);
  assert.equal(await activateRequest, created);
  assert.equal(await lateRequest, created);
  assert.equal(createCount, 1);
  assert.equal(coordinator.isCreating(), false);
});

test('reuses the current live window without invoking the factory', async () => {
  const current: FakeWindow = { id: 1, destroyed: false };
  let createCount = 0;
  const coordinator = createWindowCreationCoordinator<FakeWindow>({
    getCurrent: () => current,
    setCurrent: () => {},
    isDestroyed: window => window.destroyed,
    create: async () => {
      createCount += 1;
      return { id: 2, destroyed: false };
    },
  });

  assert.equal(await coordinator.ensure(), current);
  assert.equal(createCount, 0);
});

test('a stale window closing cannot clear its live replacement', () => {
  const stale: FakeWindow = { id: 1, destroyed: true };
  const replacement: FakeWindow = { id: 2, destroyed: false };
  let current: FakeWindow | null = replacement;
  const coordinator = createWindowCreationCoordinator<FakeWindow>({
    getCurrent: () => current,
    setCurrent: window => {
      current = window;
    },
    isDestroyed: window => window.destroyed,
    create: async () => replacement,
  });

  assert.equal(coordinator.clearIfCurrent(stale), false);
  assert.equal(current, replacement);
  assert.equal(coordinator.clearIfCurrent(replacement), true);
  assert.equal(current, null);
});

test('a failed creation releases the single-flight slot for retry', async () => {
  let current: FakeWindow | null = null;
  let createCount = 0;
  const coordinator = createWindowCreationCoordinator<FakeWindow>({
    getCurrent: () => current,
    setCurrent: window => {
      current = window;
    },
    isDestroyed: window => window.destroyed,
    create: async () => {
      createCount += 1;
      if (createCount === 1) throw new Error('load failed');
      const window = { id: 2, destroyed: false };
      current = window;
      return window;
    },
  });

  await assert.rejects(coordinator.ensure(), /load failed/);
  assert.equal(coordinator.isCreating(), false);
  assert.equal((await coordinator.ensure()).id, 2);
  assert.equal(createCount, 2);
});
