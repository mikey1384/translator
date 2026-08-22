export type StartupPhase =
  | 'module_load'
  | 'services_initialization'
  | 'app_ready'
  | 'startup_cleanup'
  | 'window_creation'
  | 'renderer_ready'
  | 'runtime';

export type CriticalFailureClass =
  | 'startup_incomplete'
  | 'main_module_load_failed'
  | 'startup_initialization_failed'
  | 'main_process_exception'
  | 'main_process_rejection'
  | 'renderer_process_gone'
  | 'child_process_gone'
  | 'renderer_window_hung';

export type ProcessFailureReason =
  | 'clean-exit'
  | 'abnormal-exit'
  | 'killed'
  | 'crashed'
  | 'oom'
  | 'launch-failed'
  | 'integrity-failure'
  | 'unknown';

export interface PendingCriticalFailure {
  eventId: string;
  failureClass: CriticalFailureClass;
  startupPhase: StartupPhase;
  failedAppVersion: string;
  failedPlatform: 'darwin' | 'win32' | 'linux';
  failedArchitecture: 'arm64' | 'x64' | 'ia32';
  processReason?: ProcessFailureReason;
}

interface StartupHealthController {
  setPhase(startupPhase: StartupPhase): void;
  markSuccessful(): void;
  recordFailure(
    failureClass: CriticalFailureClass,
    startupPhase?: StartupPhase,
    processReason?: ProcessFailureReason
  ): void;
  listPendingFailures(): PendingCriticalFailure[];
  acknowledgeFailure(eventId: string): void;
}

declare global {
  // Installed by boot.mjs before the bundled main process is evaluated.
  // eslint-disable-next-line no-var
  var __translatorStartupHealth: StartupHealthController | undefined;
}

function controller(): StartupHealthController | undefined {
  return globalThis.__translatorStartupHealth;
}

export function setStartupPhase(startupPhase: StartupPhase): void {
  controller()?.setPhase(startupPhase);
}

export function markStartupSuccessful(): void {
  controller()?.markSuccessful();
}

export function recordCriticalFailure(
  failureClass: CriticalFailureClass,
  startupPhase?: StartupPhase,
  processReason?: ProcessFailureReason
): void {
  controller()?.recordFailure(failureClass, startupPhase, processReason);
}

export function listPendingCriticalFailures(): PendingCriticalFailure[] {
  return controller()?.listPendingFailures() ?? [];
}

export function acknowledgeCriticalFailure(eventId: string): void {
  controller()?.acknowledgeFailure(eventId);
}
