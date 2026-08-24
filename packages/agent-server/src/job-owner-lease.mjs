import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, promises as fs } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = 1;
const ALIVE_RESPONSE = 'ALIVE\n';

function createEndpoint({
  platform = process.platform,
  pid = process.pid,
  tempDirectory = os.tmpdir(),
  suffix = randomBytes(8).toString('hex'),
} = {}) {
  const name = `translator-job-owner-${pid}-${suffix}`;
  if (platform === 'win32') {
    return { endpoint: `\\\\.\\pipe\\${name}`, directory: null };
  }
  const directory = mkdtempSync(
    path.join(tempDirectory, `translator-job-owner-${pid}-`)
  );
  chmodSync(directory, 0o700);
  return { endpoint: path.join(directory, 'lease.sock'), directory };
}

export class JobOwnerLease {
  constructor({
    endpoint,
    token = randomBytes(32).toString('hex'),
    platform = process.platform,
    pid = process.pid,
    tempDirectory = os.tmpdir(),
    serverFactory = listener => createServer(listener),
  } = {}) {
    const generated =
      endpoint === undefined
        ? createEndpoint({ platform, pid, tempDirectory })
        : { endpoint, directory: null };
    this.endpoint = generated.endpoint;
    this.endpointDirectory = generated.directory;
    this.token = token;
    this.platform = platform;
    this.pid = pid;
    this.serverFactory = serverFactory;
    this.server = null;
    this.sockets = new Set();
    this.startPromise = null;
    this.closePromise = null;
    this.closed = false;
  }

  descriptor() {
    return {
      protocol_version: PROTOCOL_VERSION,
      endpoint: this.endpoint,
      token: this.token,
      pid: this.pid,
    };
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.closed) {
      return Promise.reject(new Error('Job owner lease is already closed.'));
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
        server.unref?.();
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
    if (this.closed) {
      socket.destroy();
      return;
    }
    this.sockets.add(socket);
    socket.unref?.();
    socket.once('close', () => this.sockets.delete(socket));
    const expected = `${this.token}\n`;
    let request = '';
    const reject = () => socket.destroy();
    socket.on('error', reject);
    socket.on('data', chunk => {
      request += chunk.toString('utf8');
      if (!expected.startsWith(request)) {
        reject();
        return;
      }
      if (request !== expected) return;
      socket.end(ALIVE_RESPONSE);
    });
    socket.once('end', () => {
      if (request !== expected) reject();
    });
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.closePromise = Promise.resolve().then(async () => {
      await this.startPromise?.catch(() => {});
      const server = this.server;
      if (server) {
        await new Promise((resolve, reject) => {
          try {
            server.close(error => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING')
                reject(error);
              else resolve();
            });
          } catch (error) {
            if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolve();
            else reject(error);
          }
        });
      }
      if (this.platform !== 'win32') {
        await fs.unlink(this.endpoint).catch(error => {
          if (error?.code !== 'ENOENT') throw error;
        });
      }
      if (this.endpointDirectory) {
        await fs.rmdir(this.endpointDirectory).catch(error => {
          if (error?.code !== 'ENOENT') throw error;
        });
        this.endpointDirectory = null;
      }
    });
    return this.closePromise;
  }
}

export async function probeJobOwnerLease(
  descriptor,
  { connectionFactory = endpoint => createConnection(endpoint) } = {}
) {
  if (
    descriptor?.protocol_version !== PROTOCOL_VERSION ||
    typeof descriptor?.endpoint !== 'string' ||
    !descriptor.endpoint ||
    !/^[a-f0-9]{64}$/.test(String(descriptor?.token || ''))
  ) {
    return false;
  }
  return new Promise(resolve => {
    let settled = false;
    let response = '';
    let socket;
    try {
      socket = connectionFactory(descriptor.endpoint);
    } catch {
      resolve(false);
      return;
    }
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => socket.write(`${descriptor.token}\n`));
    socket.on('data', chunk => {
      response += chunk.toString('utf8');
      if (!ALIVE_RESPONSE.startsWith(response)) {
        finish(false);
      } else if (response === ALIVE_RESPONSE) {
        finish(true);
      }
    });
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(response === ALIVE_RESPONSE));
  });
}

export function createJobOwnerLease(options) {
  return new JobOwnerLease(options);
}
