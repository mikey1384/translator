import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const OWNER_SUPERVISOR_PATH_ENV = 'TRANSLATOR_OWNER_SUPERVISOR_PATH';
const READY_LINE = 'READY\n';
const MAX_DIAGNOSTIC_BYTES = 4096;
export const NATIVE_OWNER_MONITOR_START_TIMEOUT_MS = 5_000;
export const NATIVE_OWNER_MONITOR_STOP_TIMEOUT_MS = 2_000;

export function getOwnerSupervisorPath({
  env = process.env,
  platform = process.platform,
} = {}) {
  if (env[OWNER_SUPERVISOR_PATH_ENV]) {
    return path.resolve(env[OWNER_SUPERVISOR_PATH_ENV]);
  }

  const executableName =
    platform === 'win32'
      ? 'translator-owner-supervisor.exe'
      : 'translator-owner-supervisor';
  if (path.basename(moduleDirectory) === 'src') {
    return path.resolve(moduleDirectory, '..', 'bin', executableName);
  }
  return path.join(moduleDirectory, executableName);
}

function formatMonitorExit(code, signal, diagnostic) {
  const status = signal ? `signal ${signal}` : `code ${String(code)}`;
  const detail = diagnostic.trim();
  return new Error(
    `Native owner monitor exited before it was ready (${status})${detail ? `: ${detail}` : '.'}`
  );
}

/**
 * Watches the exact process that launched this controller with a native,
 * event-driven process handle. The detached monitor also tracks the launched
 * Electron group, so controller or owner death cannot strand the app merely
 * because unrelated processes inherited every stdio descriptor.
 */
export class NativeOwnerMonitor {
  constructor({
    executablePath = getOwnerSupervisorPath(),
    ownerPid = process.ppid,
    controllerPid = process.pid,
    platform = process.platform,
    spawnImplementation = spawn,
    onOwnershipLost,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = timer => clearTimeout(timer),
  } = {}) {
    this.executablePath = executablePath;
    this.ownerPid = ownerPid;
    this.controllerPid = controllerPid;
    this.platform = platform;
    this.spawnImplementation = spawnImplementation;
    this.onOwnershipLost = onOwnershipLost;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.child = null;
    this.terminationPromise = null;
    this.terminated = false;
    this.startPromise = null;
    this.closePromise = null;
    this.ready = false;
    this.closing = false;
    this.lossReported = false;
    this.trackedPids = new Set();
  }

  start() {
    if (this.startPromise) return this.startPromise;
    if (this.closing) {
      return Promise.reject(new Error('Native owner monitor is closing.'));
    }
    if (!Number.isSafeInteger(this.ownerPid) || this.ownerPid <= 1) {
      return Promise.reject(
        new Error('The controller no longer has a live owning process.')
      );
    }

    this.startPromise = new Promise((resolve, reject) => {
      let settled = false;
      let readiness = '';
      let diagnostic = '';
      let readinessTimer = null;
      let child;
      try {
        child = this.spawnImplementation(
          this.executablePath,
          ['--watch', String(this.ownerPid), String(this.controllerPid)],
          {
            detached: this.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          }
        );
      } catch (error) {
        reject(error);
        return;
      }
      this.child = child;
      let resolveTermination;
      this.terminationPromise = new Promise(resolve => {
        resolveTermination = resolve;
      });
      const finishTermination = () => {
        if (this.terminated) return;
        this.terminated = true;
        resolveTermination();
      };

      const failStart = error => {
        if (settled) return;
        settled = true;
        if (readinessTimer) this.clearTimer(readinessTimer);
        reject(error);
      };
      child.once('error', error => {
        if (settled) this.reportLoss('owner-monitor:process-error', error);
        else failStart(error);
        if (!child.pid) finishTermination();
      });
      child.stdin?.on('error', error => {
        if (!this.closing)
          this.reportLoss('owner-monitor:control-error', error);
      });
      child.stderr?.on('data', chunk => {
        if (diagnostic.length >= MAX_DIAGNOSTIC_BYTES) return;
        diagnostic += chunk
          .toString('utf8')
          .slice(0, MAX_DIAGNOSTIC_BYTES - diagnostic.length);
      });
      child.stdout?.on('data', chunk => {
        if (settled) return;
        readiness += chunk.toString('utf8');
        if (
          readiness.length > READY_LINE.length ||
          !READY_LINE.startsWith(readiness)
        ) {
          failStart(
            new Error(
              'Native owner monitor sent an invalid readiness response.'
            )
          );
          child.kill?.('SIGKILL');
          return;
        }
        if (readiness !== READY_LINE) return;
        settled = true;
        if (readinessTimer) this.clearTimer(readinessTimer);
        this.ready = true;
        resolve();
      });
      child.once('exit', (code, signal) => {
        this.ready = false;
        finishTermination();
        if (!settled) {
          failStart(formatMonitorExit(code, signal, diagnostic));
          return;
        }
        if (!this.closing) {
          this.reportLoss('owner-monitor:exit', { code, signal });
        }
      });
      child.once('close', finishTermination);
      readinessTimer = this.setTimer(() => {
        failStart(
          new Error('Native owner monitor did not become ready in time.')
        );
        child.kill?.('SIGKILL');
      }, NATIVE_OWNER_MONITOR_START_TIMEOUT_MS);
      readinessTimer?.unref?.();
    });

    return this.startPromise;
  }

  reportLoss(reason, error) {
    if (this.closing || this.lossReported) return;
    this.lossReported = true;
    try {
      const result = this.onOwnershipLost?.(reason, error);
      void Promise.resolve(result).catch(() => {});
    } catch {
      // The owner is gone; no owner-controlled output channel is safe here.
    }
  }

  writeControl(command) {
    if (!this.ready || !this.child?.stdin?.writable) {
      throw new Error('Native owner monitor is not ready.');
    }
    try {
      this.child.stdin.write(`${command}\n`, error => {
        if (error) this.reportLoss('owner-monitor:control-error', error);
      });
    } catch (error) {
      this.reportLoss('owner-monitor:control-error', error);
      throw error;
    }
  }

  trackProcess(processOrPid) {
    const pid =
      typeof processOrPid === 'number' ? processOrPid : processOrPid?.pid;
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      throw new Error('Cannot track an invalid Electron process identifier.');
    }
    if (this.trackedPids.has(pid)) return false;
    if (this.trackedPids.size > 0) {
      throw new Error(
        'Native owner monitor already owns a different Electron root.'
      );
    }
    this.writeControl(`TRACK ${pid}`);
    this.trackedPids.add(pid);
    return true;
  }

  untrackProcess(processOrPid) {
    const pid =
      typeof processOrPid === 'number' ? processOrPid : processOrPid?.pid;
    if (!Number.isSafeInteger(pid) || !this.trackedPids.has(pid)) return false;
    this.writeControl(`UNTRACK ${pid}`);
    this.trackedPids.delete(pid);
    return true;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    const child = this.child;
    this.closePromise = Promise.resolve().then(async () => {
      if (!child || child.exitCode != null || child.signalCode != null) return;
      if (this.terminated) return;
      const exited = this.terminationPromise;
      let resolveDeadline;
      const deadline = new Promise(resolve => {
        resolveDeadline = resolve;
      });
      const forceTimer = this.setTimer(() => {
        child.kill?.('SIGKILL');
        // Once shutdown was explicitly requested, a native helper that the OS
        // refuses to reap must not keep its controller alive. The detached
        // helper still watches the exact controller and exits when that owner
        // terminates.
        resolveDeadline();
      }, NATIVE_OWNER_MONITOR_STOP_TIMEOUT_MS);
      forceTimer?.unref?.();
      try {
        child.stdin?.end('CLOSING\n');
      } catch {
        child.kill?.('SIGKILL');
      }
      try {
        await Promise.race([exited, deadline]);
      } finally {
        this.clearTimer(forceTimer);
      }
    });
    return this.closePromise;
  }
}

export function createNativeOwnerMonitor(options) {
  return new NativeOwnerMonitor(options);
}
