import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createDevelopmentOwnerLease } from '../../agent-server/src/development-owner-lease.mjs';
import {
  DEVELOPMENT_OWNER_LEASE_PATH_ENV,
  DEVELOPMENT_OWNER_LEASE_TOKEN_ENV,
  installDevelopmentOwnerLeaseClient,
} from '../development-owner-lease.js';

function nextTurn(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timeout: NodeJS.Timeout;
  const timed = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timed]).finally(() => clearTimeout(timeout));
}

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  destroyed = false;

  write(data: string, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(data);
    callback?.(null);
    return true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

test('development owner lease client sends the exact launch token', () => {
  const socket = new FakeSocket();
  let connectedEndpoint: string | null = null;
  const client = installDevelopmentOwnerLeaseClient({
    env: {
      [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: '/tmp/translator-owner.sock',
      [DEVELOPMENT_OWNER_LEASE_TOKEN_ENV]: 'private-token',
    },
    connect: endpoint => {
      connectedEndpoint = endpoint;
      return socket;
    },
    requestShutdown: () => assert.fail('lease must remain connected'),
  });

  socket.emit('connect');

  assert.equal(connectedEndpoint, '/tmp/translator-owner.sock');
  assert.deepEqual(socket.writes, ['private-token\n']);
  assert.equal(client.isActive(), true);
  client.dispose();
});

test('repeated owner lease loss events request Electron shutdown once', () => {
  const socket = new FakeSocket();
  const reasons: string[] = [];
  const client = installDevelopmentOwnerLeaseClient({
    env: {
      [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: '/tmp/translator-owner.sock',
      [DEVELOPMENT_OWNER_LEASE_TOKEN_ENV]: 'private-token',
    },
    connect: () => socket,
    requestShutdown: reason => reasons.push(reason),
  });

  socket.emit('connect');
  socket.emit('end');
  socket.emit('close');

  assert.deepEqual(reasons, ['socket:end']);
  assert.equal(client.hasFailed(), true);
  client.dispose();
});

test('a synchronous lease handshake write failure requests shutdown once', () => {
  const socket = new FakeSocket();
  socket.write = () => {
    throw new Error('lease pipe closed');
  };
  const reasons: string[] = [];
  const client = installDevelopmentOwnerLeaseClient({
    env: {
      [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: '/tmp/translator-owner.sock',
      [DEVELOPMENT_OWNER_LEASE_TOKEN_ENV]: 'private-token',
    },
    connect: () => socket,
    requestShutdown: reason => reasons.push(reason),
  });

  assert.doesNotThrow(() => socket.emit('connect'));
  socket.emit('close');

  assert.deepEqual(reasons, ['write:error']);
  client.dispose();
});

test('a partial lease configuration fails closed once', async () => {
  const reasons: string[] = [];
  const client = installDevelopmentOwnerLeaseClient({
    env: {
      [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: '/tmp/translator-owner.sock',
    },
    requestShutdown: reason => reasons.push(reason),
  });

  await nextTurn();

  assert.deepEqual(reasons, ['configuration']);
  assert.equal(client.hasFailed(), true);
  client.dispose();
});

test('closing the controller lease shuts down its authenticated Electron client', async t => {
  const lease = createDevelopmentOwnerLease();
  await lease.start();
  let shutdownRequests = 0;
  let resolveShutdown: (() => void) | undefined;
  const shutdown = new Promise<void>(resolve => {
    resolveShutdown = resolve;
  });
  const client = installDevelopmentOwnerLeaseClient({
    env: lease.environment(),
    requestShutdown: () => {
      shutdownRequests += 1;
      resolveShutdown?.();
    },
  });

  t.after(async () => {
    client.dispose();
    await lease.close();
  });

  assert.equal(
    await withTimeout(
      lease.waitForConnection(),
      2_000,
      'Electron client did not authenticate its owner lease'
    ),
    true
  );
  await lease.revoke();
  await withTimeout(
    shutdown,
    2_000,
    'Electron client did not react to owner lease loss'
  );
  await nextTurn();

  assert.equal(shutdownRequests, 1);
});

test('development mode without lease credentials remains backward compatible', () => {
  let shutdownRequests = 0;
  const client = installDevelopmentOwnerLeaseClient({
    env: { TRANSLATOR_AGENT_DEV: '1' },
    requestShutdown: () => {
      shutdownRequests += 1;
    },
  });

  assert.equal(client.isActive(), false);
  assert.equal(client.hasFailed(), false);
  assert.equal(shutdownRequests, 0);
  client.dispose();
});
