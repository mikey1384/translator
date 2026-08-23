export interface NativeOwnerMonitorOptions {
  executablePath?: string;
  ownerPid?: number;
  controllerPid?: number;
  platform?: NodeJS.Platform;
  onOwnershipLost?: (reason: string, error?: unknown) => unknown;
}

export declare class NativeOwnerMonitor {
  constructor(options?: NativeOwnerMonitorOptions);
  start(): Promise<void>;
  trackProcess(processOrPid: number | { pid?: number }): boolean;
  untrackProcess(processOrPid: number | { pid?: number }): boolean;
  close(): Promise<void>;
}

export declare const NATIVE_OWNER_MONITOR_START_TIMEOUT_MS: 5000;
export declare const NATIVE_OWNER_MONITOR_STOP_TIMEOUT_MS: 2000;

export declare function createNativeOwnerMonitor(
  options?: NativeOwnerMonitorOptions
): NativeOwnerMonitor;

export declare function getOwnerSupervisorPath(options?: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): string;
