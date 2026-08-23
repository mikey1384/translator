import assert from 'node:assert/strict';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import {
  createDevelopmentOwnerLease,
  DEVELOPMENT_OWNER_LEASE_PATH_ENV,
  DEVELOPMENT_OWNER_LEASE_TOKEN_ENV,
  forceKillElectronProcessTree,
} from '../src/development-owner-lease.mjs';

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test('development owner lease accepts only its exact per-launch token', async t => {
  const lease = createDevelopmentOwnerLease();
  await lease.start();
  t.after(() => lease.close());

  const rejectedSocket = net.createConnection(lease.endpoint);
  rejectedSocket.on('error', () => {});
  rejectedSocket.write('wrong-token\n');
  await nextTurn();
  assert.equal(lease.isConnected(), false);

  const authenticatedSocket = net.createConnection(lease.endpoint);
  authenticatedSocket.on('error', () => {});
  authenticatedSocket.write(`${lease.token}\n`);

  assert.equal(await lease.waitForConnection(), true);
  assert.equal(lease.isConnected(), true);
  authenticatedSocket.destroy();
});

test('development owner lease exports both credentials only to its launch environment', async t => {
  const lease = createDevelopmentOwnerLease();
  await lease.start();
  t.after(() => lease.close());

  assert.deepEqual(lease.environment(), {
    [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: lease.endpoint,
    [DEVELOPMENT_OWNER_LEASE_TOKEN_ENV]: lease.token,
  });
});

test(
  'development owner lease endpoint is private and removed by idempotent close',
  { skip: process.platform === 'win32' },
  async () => {
    const lease = createDevelopmentOwnerLease();
    await lease.start();
    const endpointDirectory = path.dirname(lease.endpoint);

    assert.equal((await fs.stat(endpointDirectory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(lease.endpoint)).mode & 0o777, 0o600);
    await Promise.all([lease.close(), lease.close(), lease.revoke()]);
    await assert.rejects(fs.stat(lease.endpoint), { code: 'ENOENT' });
    await assert.rejects(fs.stat(endpointDirectory), { code: 'ENOENT' });
  }
);

test('an unauthenticated connection cannot delay lease revocation', async () => {
  const lease = createDevelopmentOwnerLease();
  await lease.start();

  const unauthenticatedSocket = net.createConnection(lease.endpoint);
  unauthenticatedSocket.on('error', () => {});
  await once(unauthenticatedSocket, 'connect');
  unauthenticatedSocket.write(lease.token.slice(0, 8));
  await nextTurn();

  const socketClosed = once(unauthenticatedSocket, 'close');
  await lease.revoke();
  await socketClosed;
  assert.equal(unauthenticatedSocket.destroyed, true);
});

test('lease revocation drops authenticated ownership before async cleanup settles', async () => {
  let socketDestroyed = false;
  let releaseStart;
  const startGate = new Promise(resolve => {
    releaseStart = resolve;
  });
  const lease = createDevelopmentOwnerLease();
  lease.startPromise = startGate;
  lease.connected = true;
  lease.socket = { destroy: () => (socketDestroyed = true) };
  lease.sockets.add(lease.socket);

  const closing = lease.close();

  assert.equal(lease.isConnected(), false);
  assert.equal(socketDestroyed, true);
  assert.equal(lease.sockets.size, 0);

  releaseStart();
  await closing;
});

test('force-kill targets the detached Electron process group', () => {
  const child = {
    pid: 5151,
    exitCode: null,
    signalCode: null,
    kill: () => assert.fail('direct-child fallback must not be needed'),
  };
  const killedPids = [];

  assert.equal(
    forceKillElectronProcessTree(child, {
      platform: 'darwin',
      killProcessGroup: pid => killedPids.push(pid),
    }),
    true
  );
  assert.deepEqual(killedPids, [5151]);
});

test('force-kill skips an Electron process that has already exited', () => {
  let killCalls = 0;
  const child = { pid: 5252, exitCode: 0, signalCode: null };

  assert.equal(
    forceKillElectronProcessTree(child, {
      platform: 'darwin',
      killProcessGroup: () => {
        killCalls += 1;
      },
    }),
    false
  );
  assert.equal(killCalls, 0);
});
