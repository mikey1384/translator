import { createConnection } from 'node:net';

export const DEVELOPMENT_OWNER_LEASE_PATH_ENV =
  'TRANSLATOR_DEV_OWNER_LEASE_PATH';
export const DEVELOPMENT_OWNER_LEASE_TOKEN_ENV =
  'TRANSLATOR_DEV_OWNER_LEASE_TOKEN';

type LeaseFailureReason =
  | 'configuration'
  | 'connect:error'
  | 'socket:end'
  | 'socket:close'
  | 'socket:error'
  | 'write:error';

interface LeaseSocket {
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
  write(data: string, callback?: (error?: Error | null) => void): boolean;
  destroy(): void;
}

interface DevelopmentOwnerLeaseClientOptions {
  env?: NodeJS.ProcessEnv;
  connect?: (endpoint: string) => LeaseSocket;
  requestShutdown: (reason: LeaseFailureReason, error?: unknown) => unknown;
}

/**
 * Connects development Electron to a controller-owned, per-launch IPC lease.
 * The controller endpoint is the authority: losing it requests shutdown once,
 * independently of inherited stdout/stderr descriptors.
 */
export function installDevelopmentOwnerLeaseClient({
  env = process.env,
  connect = endpoint => createConnection(endpoint),
  requestShutdown,
}: DevelopmentOwnerLeaseClientOptions) {
  const endpoint = env[DEVELOPMENT_OWNER_LEASE_PATH_ENV];
  const token = env[DEVELOPMENT_OWNER_LEASE_TOKEN_ENV];
  let disposed = false;
  let failed = false;
  let socket: LeaseSocket | null = null;

  const requestOnce = (reason: LeaseFailureReason, error?: unknown) => {
    if (disposed || failed) return;
    failed = true;
    try {
      const result = requestShutdown(reason, error);
      void Promise.resolve(result).catch(() => {});
    } catch {
      // The controller is gone; no controller-owned output is safe here.
    }
  };

  const onConnect = () => {
    try {
      socket?.write(`${token}\n`, error => {
        if (error) requestOnce('write:error', error);
      });
    } catch (error) {
      requestOnce('write:error', error);
    }
  };
  const onEnd = () => requestOnce('socket:end');
  const onClose = () => requestOnce('socket:close');
  const onError = (error: unknown) => requestOnce('socket:error', error);

  if (Boolean(endpoint) !== Boolean(token)) {
    queueMicrotask(() => requestOnce('configuration'));
  } else if (endpoint && token) {
    try {
      socket = connect(endpoint);
      socket.once('connect', onConnect);
      socket.once('end', onEnd);
      socket.once('close', onClose);
      socket.once('error', onError);
    } catch (error) {
      queueMicrotask(() => requestOnce('connect:error', error));
    }
  }

  return {
    isActive: () => Boolean(endpoint && token),
    hasFailed: () => failed,
    dispose() {
      if (disposed) return;
      disposed = true;
      socket?.off('connect', onConnect);
      socket?.off('end', onEnd);
      socket?.off('close', onClose);
      socket?.off('error', onError);
      socket?.destroy();
      socket = null;
    },
  };
}
