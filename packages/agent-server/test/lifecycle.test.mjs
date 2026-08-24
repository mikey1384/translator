import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { DevAppController } from '../src/dev-app-controller.mjs';
import { DisconnectAwareStdioServerTransport } from '../src/disconnect-aware-stdio-transport.mjs';
import {
  installTransportBoundLifecycle,
  shouldForceDevelopmentShutdown,
} from '../src/transport-bound-lifecycle.mjs';

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

function createHarness() {
  const processTarget = new EventEmitter();
  const input = new EventEmitter();
  const output = new EventEmitter();
  const errorOutput = new EventEmitter();
  const readline = new EventEmitter();
  let closeCalls = 0;
  let transportCloseCalls = 0;
  const exits = [];

  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
    },
    closeTransport: async () => {
      transportCloseCalls += 1;
    },
    processTarget,
    input,
    outputs: [output, errorOutput],
    readline,
    exit: code => {
      exits.push(code);
    },
  });

  return {
    processTarget,
    input,
    output,
    errorOutput,
    readline,
    lifecycle,
    exits,
    get closeCalls() {
      return closeCalls;
    },
    get transportCloseCalls() {
      return transportCloseCalls;
    },
  };
}

const disconnectCases = [
  ['SIGINT', harness => harness.processTarget.emit('SIGINT'), 0],
  ['SIGTERM', harness => harness.processTarget.emit('SIGTERM'), 0],
  ['SIGHUP', harness => harness.processTarget.emit('SIGHUP'), 0],
  [
    'parent IPC disconnect',
    harness => harness.processTarget.emit('disconnect'),
    1,
  ],
  ['stdin end', harness => harness.input.emit('end'), 0],
  ['stdin close', harness => harness.input.emit('close'), 0],
  [
    'stdin error',
    harness => harness.input.emit('error', new Error('closed')),
    1,
  ],
  ['readline close', harness => harness.readline.emit('close'), 0],
  ['stdout close', harness => harness.output.emit('close'), 0],
  [
    'stdout error',
    harness => harness.output.emit('error', new Error('closed')),
    1,
  ],
  ['stderr close', harness => harness.errorOutput.emit('close'), 0],
  [
    'stderr error',
    harness => harness.errorOutput.emit('error', new Error('closed')),
    1,
  ],
  ['transport close', harness => harness.lifecycle.transportClosed(), 0],
];

for (const [name, trigger, expectedExitCode] of disconnectCases) {
  test(`${name} closes the development controller before exit`, async () => {
    const harness = createHarness();
    trigger(harness);
    await nextTurn();

    assert.equal(harness.closeCalls, 1);
    assert.equal(harness.transportCloseCalls, 1);
    assert.deepEqual(harness.exits, [expectedExitCode]);
    harness.lifecycle.dispose();
  });
}

test('concurrent shutdown requests preserve the most severe exit code', async () => {
  const output = new EventEmitter();
  const exits = [];
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {},
    processTarget: new EventEmitter(),
    input: new EventEmitter(),
    outputs: [output],
    exit: code => exits.push(code),
  });

  output.emit('error', new Error('closed'));
  await lifecycle.requestShutdown('output:error', 1);

  assert.deepEqual(exits, [1]);
});

test('shutdown waits for Playwright close and remains idempotent across triggers', async () => {
  const processTarget = new EventEmitter();
  const input = new EventEmitter();
  let releaseClose;
  const closeGate = new Promise(resolve => {
    releaseClose = resolve;
  });
  let closeCalls = 0;
  let transportCloseCalls = 0;
  const exits = [];
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
      await closeGate;
    },
    closeTransport: async () => {
      transportCloseCalls += 1;
    },
    processTarget,
    input,
    outputs: [],
    exit: code => exits.push(code),
  });

  processTarget.emit('SIGTERM');
  input.emit('end');
  input.emit('close');
  lifecycle.transportClosed();
  await nextTurn();

  assert.equal(closeCalls, 1);
  assert.equal(transportCloseCalls, 0);
  assert.deepEqual(exits, []);

  releaseClose();
  await nextTurn();
  await nextTurn();

  assert.equal(closeCalls, 1);
  assert.equal(transportCloseCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('ownership loss force-closes a hung development app once', async () => {
  const processTarget = new EventEmitter();
  const input = new EventEmitter();
  const closeGate = new Promise(() => {});
  let closeCalls = 0;
  let forceCalls = 0;
  const exits = [];
  let resolveExit;
  const exited = new Promise(resolve => {
    resolveExit = resolve;
  });
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
      await closeGate;
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    forceOnFirstShutdown: shouldForceDevelopmentShutdown,
    processTarget,
    input,
    outputs: [],
    exit: code => {
      exits.push(code);
      resolveExit();
    },
  });

  input.emit('end');
  input.emit('close');
  processTarget.emit('SIGTERM');
  await exited;

  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('ownership loss cannot be held open by a hung transport close', async () => {
  const processTarget = new EventEmitter();
  const input = new EventEmitter();
  let closeCalls = 0;
  let forceCalls = 0;
  let transportCloseCalls = 0;
  const exits = [];
  let resolveExit;
  const exited = new Promise(resolve => {
    resolveExit = resolve;
  });
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
      await new Promise(() => {});
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    forceOnFirstShutdown: shouldForceDevelopmentShutdown,
    closeTransport: () => {
      transportCloseCalls += 1;
      return new Promise(() => {});
    },
    processTarget,
    input,
    outputs: [],
    exit: code => {
      exits.push(code);
      resolveExit();
    },
  });

  input.emit('end');
  input.emit('close');
  processTarget.emit('SIGTERM');
  await exited;

  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 1);
  assert.equal(transportCloseCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('a later signal escapes a transport close that hung after graceful app close', async () => {
  const processTarget = new EventEmitter();
  let closeCalls = 0;
  let forceCalls = 0;
  let transportCloseCalls = 0;
  const exits = [];
  let resolveExit;
  const exited = new Promise(resolve => {
    resolveExit = resolve;
  });
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    forceOnFirstShutdown: shouldForceDevelopmentShutdown,
    closeTransport: () => {
      transportCloseCalls += 1;
      return new Promise(() => {});
    },
    processTarget,
    input: new EventEmitter(),
    outputs: [],
    exit: code => {
      exits.push(code);
      resolveExit();
    },
  });

  const exiting = lifecycle.requestShutdown('command:quit');
  await nextTurn();
  assert.equal(closeCalls, 1);
  assert.equal(transportCloseCalls, 1);
  assert.equal(forceCalls, 0);
  assert.deepEqual(exits, []);

  processTarget.emit('SIGTERM');
  await exited;
  await exiting;

  assert.equal(closeCalls, 1);
  assert.equal(transportCloseCalls, 1);
  assert.equal(forceCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('a transport acknowledging our graceful close does not invoke force close', async () => {
  const processTarget = new EventEmitter();
  const readline = new EventEmitter();
  let closeCalls = 0;
  let forceCalls = 0;
  let transportCloseCalls = 0;
  const exits = [];
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    closeTransport: () => {
      transportCloseCalls += 1;
      readline.emit('close');
    },
    processTarget,
    input: new EventEmitter(),
    outputs: [],
    readline,
    exit: code => exits.push(code),
  });

  await lifecycle.requestShutdown('command:quit');

  assert.equal(closeCalls, 1);
  assert.equal(transportCloseCalls, 1);
  assert.equal(forceCalls, 0);
  assert.deepEqual(exits, [0]);
});

test('explicit quit stays graceful until a repeated trigger escalates once', async () => {
  const processTarget = new EventEmitter();
  const closeGate = new Promise(() => {});
  let closeCalls = 0;
  let forceCalls = 0;
  const exits = [];
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
      await closeGate;
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    forceOnFirstShutdown: shouldForceDevelopmentShutdown,
    processTarget,
    input: new EventEmitter(),
    outputs: [],
    exit: code => exits.push(code),
  });

  const exiting = lifecycle.requestShutdown('command:quit');
  await nextTurn();

  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 0);
  assert.deepEqual(exits, []);

  lifecycle.requestShutdown('command:quit');
  processTarget.emit('SIGINT');
  await exiting;

  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 1);
  assert.deepEqual(exits, [0]);
});

test('explicit quit has one bounded grace period before one force request', async () => {
  let scheduledCallback;
  let scheduledDelay;
  let clearCalls = 0;
  let closeCalls = 0;
  let forceCalls = 0;
  const exits = [];
  const lifecycle = installTransportBoundLifecycle({
    close: async () => {
      closeCalls += 1;
      await new Promise(() => {});
    },
    forceClose: async () => {
      forceCalls += 1;
    },
    processTarget: new EventEmitter(),
    input: new EventEmitter(),
    outputs: [],
    setTimer: (callback, delay) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return { unref() {} };
    },
    clearTimer: () => {
      clearCalls += 1;
    },
    exit: code => exits.push(code),
  });

  const exiting = lifecycle.requestShutdown('command:quit');
  await nextTurn();
  assert.equal(scheduledDelay, 10_000);
  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 0);

  scheduledCallback();
  scheduledCallback();
  lifecycle.requestShutdown('command:quit');
  await exiting;

  assert.equal(closeCalls, 1);
  assert.equal(forceCalls, 1);
  assert.equal(clearCalls, 0);
  assert.deepEqual(exits, [0]);
});

test('DevAppController closes one ElectronApplication exactly once', async () => {
  const controller = new DevAppController();
  let closeCalls = 0;
  controller.app = {
    async close() {
      closeCalls += 1;
      await nextTurn();
    },
  };
  controller.page = { isClosed: () => false };

  await Promise.all([
    controller.close(),
    controller.close(),
    controller.close(),
  ]);

  assert.equal(closeCalls, 1);
  assert.equal(controller.app, null);
  assert.equal(controller.page, null);
});

test('DevAppController distinguishes renderer rejection from unknown delivery', async () => {
  const rejectedController = new DevAppController();
  rejectedController.page = {
    isClosed: () => false,
    evaluate: async () => ({
      ok: false,
      error: { name: 'Error', message: 'renderer rejected request' },
    }),
  };
  await assert.rejects(
    () => rejectedController.call('startTranscription', {}),
    error =>
      error.message === 'renderer rejected request' &&
      error.deliveryState === 'rejected'
  );

  const disconnectedController = new DevAppController();
  disconnectedController.page = {
    isClosed: () => false,
    evaluate: async () => {
      throw new Error('Playwright connection closed');
    },
  };
  await assert.rejects(
    () => disconnectedController.call('startTranscription', {}),
    error =>
      /delivery became unknown/i.test(error.message) &&
      error.deliveryState === 'unknown'
  );
});

test('DevAppController finishes when Electron exits even if Playwright close never settles', async () => {
  const child = new EventEmitter();
  Object.assign(child, { pid: 4177, exitCode: null, signalCode: null });
  const app = new EventEmitter();
  let closeCalls = 0;
  Object.assign(app, {
    process: () => child,
    close() {
      closeCalls += 1;
      return new Promise(() => {});
    },
  });
  const controller = new DevAppController();
  controller.app = app;
  controller.appProcess = child;

  const closing = controller.close();
  await nextTurn();
  child.exitCode = 0;
  child.emit('exit', 0, null);
  await closing;

  assert.equal(closeCalls, 1);
  assert.equal(controller.app, null);
});

test('DevAppController tracks and untracks the exact launched Electron root', async () => {
  const tracked = [];
  const untracked = [];
  const ownerMonitor = {
    trackProcess: child => tracked.push(child),
    untrackProcess: child => untracked.push(child),
  };
  const child = new EventEmitter();
  Object.assign(child, { pid: 4188, exitCode: null, signalCode: null });
  const page = {
    isClosed: () => false,
    url: () => 'file:///renderer/dist/index.html',
    waitForFunction: async () => {},
    evaluate: async () => ({ ok: true, value: { running: true } }),
  };
  const app = new EventEmitter();
  Object.assign(app, {
    process: () => child,
    windows: () => [page],
    close: async () => {},
  });
  const lease = {
    start: async () => {},
    environment: () => ({}),
    isConnected: () => true,
    close: async () => {},
    revoke: async () => {},
  };
  const controller = new DevAppController({
    ownerMonitor,
    createOwnerLease: () => lease,
    loadElectron: async () => ({
      _electron: { launch: async () => app },
    }),
  });

  await controller.launch();
  assert.deepEqual(tracked, [child]);
  child.exitCode = 0;
  child.emit('exit', 0, null);
  assert.deepEqual(untracked, [child]);
  await controller.close();
});

test('shutdown retains an app whose native tracking fails after a late launch', async () => {
  let finishLaunch;
  const electronLaunch = new Promise(resolve => {
    finishLaunch = resolve;
  });
  const child = new EventEmitter();
  Object.assign(child, { pid: 4189, exitCode: null, signalCode: null });
  let appCloseCalls = 0;
  const app = new EventEmitter();
  Object.assign(app, {
    process: () => child,
    windows: () => [],
    close: async () => {
      appCloseCalls += 1;
    },
  });
  const lease = {
    start: async () => {},
    environment: () => ({}),
    isConnected: () => true,
    close: async () => {},
    revoke: async () => {},
  };
  const controller = new DevAppController({
    createOwnerLease: () => lease,
    ownerMonitor: {
      trackProcess() {
        throw new Error('monitor unavailable');
      },
    },
    loadElectron: async () => ({
      _electron: { launch: async () => electronLaunch },
    }),
  });

  const launching = controller.launch();
  await nextTurn();
  const closing = controller.close();
  finishLaunch(app);

  await assert.rejects(launching, /monitor unavailable/);
  await closing;
  assert.equal(appCloseCalls, 1);
  assert.equal(controller.app, null);
});

test('DevAppController closes an app that finishes launching after shutdown starts', async () => {
  const controller = new DevAppController();
  let finishLaunch;
  controller.launchPromise = new Promise(resolve => {
    finishLaunch = resolve;
  });
  let closeCalls = 0;

  const closing = controller.close();
  await nextTurn();
  controller.app = {
    async close() {
      closeCalls += 1;
    },
  };
  finishLaunch();
  await closing;

  assert.equal(closeCalls, 1);
  assert.equal(controller.app, null);
});

test('DevAppController force-kills an app whose Playwright close rejects', async () => {
  const child = { pid: 4191, exitCode: null, signalCode: null };
  let appCloseCalls = 0;
  let leaseRevokeCalls = 0;
  const killed = [];
  const controller = new DevAppController({
    forceKill: activeProcess => {
      killed.push(activeProcess);
      return true;
    },
  });
  controller.ownerLease = {
    close: async () => {},
    async revoke() {
      leaseRevokeCalls += 1;
    },
  };
  controller.appProcess = child;
  controller.app = {
    process: () => child,
    async close() {
      appCloseCalls += 1;
      throw new Error('Playwright close failed');
    },
  };

  await assert.rejects(controller.close(), /Playwright close failed/);

  assert.equal(appCloseCalls, 1);
  assert.equal(leaseRevokeCalls, 1);
  assert.deepEqual(killed, [child]);
  assert.equal(controller.app, null);
  assert.equal(controller.appProcess, null);
});

test('DevAppController force-kills one process while awaiting one Playwright close', async () => {
  let releaseClose;
  const closeGate = new Promise(resolve => {
    releaseClose = resolve;
  });
  let appCloseCalls = 0;
  let leaseCloseCalls = 0;
  let leaseClosePromise = null;
  const closeLeaseOnce = () => {
    if (!leaseClosePromise) {
      leaseCloseCalls += 1;
      leaseClosePromise = Promise.resolve();
    }
    return leaseClosePromise;
  };
  const child = { pid: 4242, exitCode: null, signalCode: null };
  const killed = [];
  const controller = new DevAppController({
    forceKill: activeProcess => {
      killed.push(activeProcess);
      releaseClose();
      return true;
    },
  });
  controller.ownerLease = {
    close: closeLeaseOnce,
    revoke: closeLeaseOnce,
  };
  controller.appProcess = child;
  controller.app = {
    process: () => child,
    async close() {
      appCloseCalls += 1;
      await closeGate;
    },
  };

  await Promise.all([
    controller.close(),
    controller.forceClose(),
    controller.forceClose(),
  ]);

  assert.equal(appCloseCalls, 1);
  assert.equal(leaseCloseCalls, 1);
  assert.deepEqual(killed, [child]);
  assert.equal(controller.app, null);
});

test('DevAppController establishes its private lease before Electron launch', async () => {
  const order = [];
  let launchOptions;
  let appCloseCalls = 0;
  let leaseCloseCalls = 0;
  const child = { pid: 4343, exitCode: null, signalCode: null };
  const page = {
    isClosed: () => false,
    url: () => 'file:///renderer/dist/index.html',
    waitForFunction: async () => {},
    evaluate: async () => ({ ok: true, value: { running: true } }),
  };
  const fakeApp = {
    process: () => child,
    windows: () => [page],
    async close() {
      appCloseCalls += 1;
    },
  };
  const fakeLease = {
    async start() {
      order.push('lease:start');
    },
    environment() {
      return {
        TRANSLATOR_DEV_OWNER_LEASE_PATH: '/tmp/private-owner.sock',
        TRANSLATOR_DEV_OWNER_LEASE_TOKEN: 'private-token',
      };
    },
    isConnected() {
      return true;
    },
    async close() {
      leaseCloseCalls += 1;
    },
  };
  fakeLease.revoke = fakeLease.close;
  const controller = new DevAppController({
    createOwnerLease: () => fakeLease,
    loadElectron: async () => ({
      _electron: {
        async launch(options) {
          order.push('electron:launch');
          launchOptions = options;
          return fakeApp;
        },
      },
    }),
  });

  await controller.launch();

  assert.deepEqual(order, ['lease:start', 'electron:launch']);
  assert.equal(
    launchOptions.env.TRANSLATOR_DEV_OWNER_LEASE_PATH,
    '/tmp/private-owner.sock'
  );
  assert.equal(
    launchOptions.env.TRANSLATOR_DEV_OWNER_LEASE_TOKEN,
    'private-token'
  );
  assert.equal(launchOptions.env.TRANSLATOR_AGENT_DEV, '1');

  await controller.close();
  assert.equal(appCloseCalls, 1);
  assert.equal(leaseCloseCalls, 1);
});

test('DevAppController removes only Playwright signal handlers added by launch', async () => {
  const processTarget = new EventEmitter();
  const retainedHandlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const retained = () => {};
    retainedHandlers.set(signal, retained);
    processTarget.on(signal, retained);
  }
  const page = {
    isClosed: () => false,
    url: () => 'file:///renderer/dist/index.html',
    waitForFunction: async () => {},
    evaluate: async () => ({ ok: true, value: { running: true } }),
  };
  const fakeApp = new EventEmitter();
  Object.assign(fakeApp, {
    process: () => ({ pid: 4393, exitCode: null, signalCode: null }),
    windows: () => [page],
    close: async () => {},
  });
  const fakeLease = {
    start: async () => {},
    environment: () => ({}),
    isConnected: () => true,
    close: async () => {},
    revoke: async () => {},
  };
  const controller = new DevAppController({
    createOwnerLease: () => fakeLease,
    processTarget,
    loadElectron: async () => ({
      _electron: {
        launch: async () => {
          for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
            processTarget.on(signal, () => {});
          }
          return fakeApp;
        },
      },
    }),
  });

  await controller.launch();

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    assert.deepEqual(processTarget.listeners(signal), [
      retainedHandlers.get(signal),
    ]);
  }
  await controller.close();
});

test('DevAppController force completion is independent of a hung Playwright close', async () => {
  const child = { pid: 4444, exitCode: null, signalCode: null };
  let appCloseCalls = 0;
  let leaseRevokeCalls = 0;
  const killed = [];
  const controller = new DevAppController({
    forceKill: activeProcess => {
      killed.push(activeProcess);
      return true;
    },
  });
  controller.ownerLease = {
    async close() {},
    async revoke() {
      leaseRevokeCalls += 1;
    },
  };
  controller.appProcess = child;
  controller.app = {
    process: () => child,
    close() {
      appCloseCalls += 1;
      return new Promise(() => {});
    },
  };

  await controller.forceClose();

  assert.equal(appCloseCalls, 1);
  assert.equal(leaseRevokeCalls, 1);
  assert.deepEqual(killed, [child]);
});

test('DevAppController force completion is independent of hung lease revocation', async () => {
  const child = { pid: 4494, exitCode: null, signalCode: null };
  let appCloseCalls = 0;
  let leaseRevokeCalls = 0;
  const killed = [];
  const controller = new DevAppController({
    forceKill: activeProcess => {
      killed.push(activeProcess);
      return true;
    },
  });
  controller.ownerLease = {
    close: () => new Promise(() => {}),
    revoke() {
      leaseRevokeCalls += 1;
      return new Promise(() => {});
    },
  };
  controller.appProcess = child;
  controller.app = {
    process: () => child,
    close() {
      appCloseCalls += 1;
      return new Promise(() => {});
    },
  };

  await controller.forceClose();

  assert.equal(appCloseCalls, 1);
  assert.equal(leaseRevokeCalls, 1);
  assert.deepEqual(killed, [child]);
});

test('DevAppController aborts and clears a launch whose ownership lease never authenticated', async () => {
  let appCloseCalls = 0;
  let leaseCloseCalls = 0;
  let leaseClosePromise = null;
  const closeLeaseOnce = () => {
    if (!leaseClosePromise) {
      leaseCloseCalls += 1;
      leaseClosePromise = Promise.resolve();
    }
    return leaseClosePromise;
  };
  const child = { pid: 4545, exitCode: null, signalCode: null };
  const page = {
    url: () => 'file:///renderer/dist/index.html',
    isClosed: () => false,
    waitForFunction: async () => {},
  };
  const fakeApp = new EventEmitter();
  Object.assign(fakeApp, {
    process: () => child,
    windows: () => [page],
    close() {
      appCloseCalls += 1;
    },
  });
  const fakeLease = {
    start: async () => {},
    environment: () => ({}),
    isConnected: () => false,
    close: closeLeaseOnce,
    revoke: closeLeaseOnce,
  };
  const killed = [];
  const controller = new DevAppController({
    createOwnerLease: () => fakeLease,
    forceKill: activeProcess => {
      killed.push(activeProcess);
      return true;
    },
    loadElectron: async () => ({
      _electron: { launch: async () => fakeApp },
    }),
  });

  await assert.rejects(
    controller.launch(),
    /without authenticating its development ownership lease/
  );

  assert.equal(appCloseCalls, 1);
  assert.equal(leaseCloseCalls, 1);
  assert.deepEqual(killed, [child]);
  assert.equal(controller.app, null);
  assert.equal(controller.appProcess, null);
  assert.equal(controller.page, null);
  assert.equal(controller.ownerLease, null);
});

test('DevAppController retires a spontaneously closed app before relaunching', async () => {
  const leaseCloseCalls = [0, 0];
  const leases = leaseCloseCalls.map((_, index) => ({
    start: async () => {},
    environment: () => ({}),
    isConnected: () => true,
    async close() {
      leaseCloseCalls[index] += 1;
    },
    async revoke() {
      leaseCloseCalls[index] += 1;
    },
  }));
  const apps = [0, 1].map(index => {
    const page = {
      url: () => 'file:///renderer/dist/index.html',
      isClosed: () => false,
      waitForFunction: async () => {},
      evaluate: async () => ({ ok: true, value: { launch: index + 1 } }),
    };
    const fakeApp = new EventEmitter();
    Object.assign(fakeApp, {
      process: () => ({
        pid: 4600 + index,
        exitCode: null,
        signalCode: null,
      }),
      windows: () => [page],
      close: async () => {},
    });
    return fakeApp;
  });
  let leaseIndex = 0;
  let appIndex = 0;
  const controller = new DevAppController({
    createOwnerLease: () => leases[leaseIndex++],
    loadElectron: async () => ({
      _electron: { launch: async () => apps[appIndex++] },
    }),
  });

  assert.deepEqual(await controller.launch(), { launch: 1 });
  apps[0].emit('close');
  await nextTurn();
  assert.equal(controller.app, null);
  assert.deepEqual(leaseCloseCalls, [1, 0]);

  assert.deepEqual(await controller.launch(), { launch: 2 });
  assert.equal(controller.app, apps[1]);
  await controller.close();
  assert.deepEqual(leaseCloseCalls, [1, 1]);
});

test('DevAppController refuses to overwrite a live app with a missing renderer', async () => {
  const controller = new DevAppController();
  controller.app = {};

  await assert.rejects(controller.launch(), /refusing to overwrite/);
  assert.notEqual(controller.app, null);
});

test('stdio transport reports its own close once', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let disconnects = 0;
  const transport = new DisconnectAwareStdioServerTransport({
    input,
    output,
    onDisconnect: () => {
      disconnects += 1;
    },
  });

  await transport.start();
  await Promise.all([transport.close(), transport.close(), transport.close()]);

  assert.equal(disconnects, 1);
});
