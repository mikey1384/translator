import type { ChildProcess } from 'node:child_process';
import type { Server } from 'node:net';

export const DEVELOPMENT_OWNER_LEASE_PATH_ENV: string;
export const DEVELOPMENT_OWNER_LEASE_TOKEN_ENV: string;

export interface DevelopmentOwnerLeaseOptions {
  endpoint?: string;
  token?: string;
  serverFactory?: (listener: (socket: any) => void) => Server;
  platform?: NodeJS.Platform;
  pid?: number;
  tempDirectory?: string;
}

export class DevelopmentOwnerLease {
  constructor(options?: DevelopmentOwnerLeaseOptions);
  readonly endpoint: string;
  readonly token: string;
  environment(): Record<string, string>;
  isConnected(): boolean;
  waitForConnection(): Promise<boolean>;
  start(): Promise<void>;
  revoke(): Promise<void>;
  close(): Promise<void>;
}

export function createDevelopmentOwnerLease(
  options?: DevelopmentOwnerLeaseOptions
): DevelopmentOwnerLease;

export function forceKillElectronProcessTree(
  child: ChildProcess | null | undefined,
  options?: {
    platform?: NodeJS.Platform;
    killProcessGroup?: (pid: number) => unknown;
    spawnSyncImplementation?: (...args: any[]) => {
      error?: Error;
      status?: number | null;
    };
  }
): boolean;
