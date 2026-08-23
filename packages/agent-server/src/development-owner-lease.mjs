import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

export const DEVELOPMENT_OWNER_LEASE_PATH_ENV =
  'TRANSLATOR_DEV_OWNER_LEASE_PATH';
export const DEVELOPMENT_OWNER_LEASE_TOKEN_ENV =
  'TRANSLATOR_DEV_OWNER_LEASE_TOKEN';

function createLeaseEndpoint({
  platform = process.platform,
  pid = process.pid,
  tempDirectory = os.tmpdir(),
  randomToken = randomBytes(8).toString('hex'),
} = {}) {
  const name = `translator-owner-${pid}-${randomToken}`;
  if (platform === 'win32') {
    return { endpoint: `\\\\.\\pipe\\${name}`, directory: null };
  }

  // A socket created directly under a shared temporary directory exists for a
  // short interval before chmod can run. Create it inside a mode-0700 directory
  // instead, so the endpoint is private from its first observable instant.
  const directory = mkdtempSync(
    path.join(tempDirectory, `translator-owner-${pid}-`)
  );
  chmodSync(directory, 0o700);
  return { endpoint: path.join(directory, 'lease.sock'), directory };
}

export class DevelopmentOwnerLease {
  constructor({
    endpoint,
    token = randomBytes(32).toString('hex'),
    serverFactory = listener => createServer(listener),
    platform = process.platform,
    pid = process.pid,
    tempDirectory = os.tmpdir(),
  } = {}) {
    const generated =
      endpoint === undefined
        ? createLeaseEndpoint({ platform, pid, tempDirectory })
        : { endpoint, directory: null };
    this.endpoint = generated.endpoint;
    this.endpointDirectory = generated.directory;
    this.token = token;
    this.serverFactory = serverFactory;
    this.platform = platform;
    this.server = null;
    this.socket = null;
    this.sockets = new Set();
    this.startPromise = null;
    this.closePromise = null;
    this.closed = false;
    this.connected = false;
    this.resolveConnection = null;
    this.connectionPromise = new Promise(resolve => {
      this.resolveConnection = resolve;
    });
  }

  environment() {
    return {
      [DEVELOPMENT_OWNER_LEASE_PATH_ENV]: this.endpoint,
      [DEVELOPMENT_OWNER_LEASE_TOKEN_ENV]: this.token,
    };
  }

  isConnected() {
    return this.connected;
  }

  waitForConnection() {
    return this.connectionPromise;
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.closed) {
      return Promise.reject(
        new Error('Development owner lease is already closed.')
      );
    }

    this.startPromise = new Promise((resolve, reject) => {
      let listening = false;
      const server = this.serverFactory(socket => this.handleSocket(socket));
      this.server = server;

      server.on('error', error => {
        if (!listening) reject(error);
      });
      server.listen(this.endpoint, () => {
        listening = true;
        if (this.platform === 'win32') {
          resolve();
          return;
        }

        fs.chmod(this.endpoint, 0o600).then(resolve, reject);
      });
    });

    return this.startPromise;
  }

  handleSocket(socket) {
    if (this.closed || this.socket) {
      socket.destroy();
      return;
    }

    this.sockets.add(socket);
    socket.once('close', () => {
      this.sockets.delete(socket);
      if (this.socket === socket) {
        this.socket = null;
        this.connected = false;
      }
    });

    const expectedHandshake = `${this.token}\n`;
    let handshake = '';

    const rejectSocket = () => {
      socket.off('data', onData);
      socket.off('end', rejectSocket);
      socket.destroy();
    };
    const onData = chunk => {
      handshake += chunk.toString('utf8');
      if (!expectedHandshake.startsWith(handshake)) {
        rejectSocket();
        return;
      }
      if (handshake !== expectedHandshake) return;

      socket.off('data', onData);
      socket.off('end', rejectSocket);
      if (this.closed || this.socket) {
        socket.destroy();
        return;
      }

      this.socket = socket;
      this.connected = true;
      this.resolveConnection?.(true);
      this.resolveConnection = null;
    };

    socket.on('error', () => socket.destroy());
    socket.on('data', onData);
    socket.once('end', rejectSocket);
  }

  revoke() {
    return this.close();
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.resolveConnection?.(false);
    this.resolveConnection = null;

    // Revoke ownership synchronously. Endpoint cleanup may need to await a
    // still-starting server, but no authenticated or half-authenticated socket
    // may keep Electron's ownership signal alive during that wait.
    this.socket = null;
    this.connected = false;
    for (const activeSocket of this.sockets) activeSocket.destroy();
    this.sockets.clear();

    this.closePromise = Promise.resolve().then(async () => {
      await this.startPromise?.catch(() => {});

      const activeServer = this.server;
      this.server = null;
      let closeError = null;
      try {
        if (activeServer?.listening) {
          await new Promise((resolve, reject) => {
            try {
              activeServer.close(error => {
                if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
                  reject(error);
                } else {
                  resolve();
                }
              });
            } catch (error) {
              if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolve();
              else reject(error);
            }
          });
        }
      } catch (error) {
        closeError = error;
      }

      try {
        if (this.platform !== 'win32') {
          await fs.unlink(this.endpoint).catch(error => {
            if (error?.code !== 'ENOENT') throw error;
          });
        }
      } catch (error) {
        closeError ??= error;
      }

      try {
        if (this.endpointDirectory) {
          await fs.rmdir(this.endpointDirectory).catch(error => {
            if (error?.code !== 'ENOENT') throw error;
          });
          this.endpointDirectory = null;
        }
      } catch (error) {
        closeError ??= error;
      }

      if (closeError) throw closeError;
    });

    return this.closePromise;
  }
}

export function createDevelopmentOwnerLease(options) {
  return new DevelopmentOwnerLease(options);
}

/** Force-kills the detached Electron process group without using stdio. */
export function forceKillElectronProcessTree(
  child,
  {
    platform = process.platform,
    killProcessGroup = pid => process.kill(-pid, 'SIGKILL'),
    spawnSyncImplementation = spawnSync,
  } = {}
) {
  const pid = child?.pid;
  if (!pid || child.exitCode != null || child.signalCode != null) return false;

  if (platform === 'win32') {
    const result = spawnSyncImplementation(
      'taskkill',
      ['/pid', String(pid), '/T', '/F'],
      { stdio: 'ignore', windowsHide: true }
    );
    if (!result.error && result.status === 0) return true;
  } else {
    try {
      killProcessGroup(pid);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
    }
  }

  try {
    return child.kill?.('SIGKILL') !== false;
  } catch {
    return false;
  }
}
