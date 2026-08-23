import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDevelopmentOwnerLease,
  forceKillElectronProcessTree,
} from './development-owner-lease.mjs';

const packageDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDirectory, '../../..');
const appDirectory = path.join(repoRoot, 'packages', 'main');
const electronExecutable =
  process.platform === 'darwin'
    ? path.join(
        repoRoot,
        'node_modules',
        'electron',
        'dist',
        'Electron.app',
        'Contents',
        'MacOS',
        'Electron'
      )
    : path.join(
        repoRoot,
        'node_modules',
        'electron',
        'dist',
        process.platform === 'win32' ? 'electron.exe' : 'electron'
      );
const CONTROLLER_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

export class DevAppController {
  constructor({
    createOwnerLease = createDevelopmentOwnerLease,
    forceKill = forceKillElectronProcessTree,
    loadElectron = () => import('playwright-core'),
    ownerMonitor = null,
    processTarget = process,
  } = {}) {
    this.app = null;
    this.appProcess = null;
    this.page = null;
    this.ownerLease = null;
    this.launchPromise = null;
    this.closePromise = null;
    this.forceClosePromise = null;
    this.retirementPromise = null;
    this.applicationClosePromises = new WeakMap();
    this.applicationTerminationPromises = new WeakMap();
    this.forceKilledProcesses = new WeakSet();
    this.closing = false;
    this.createOwnerLease = createOwnerLease;
    this.forceKill = forceKill;
    this.loadElectron = loadElectron;
    this.ownerMonitor = ownerMonitor;
    this.processTarget = processTarget;
  }

  launch() {
    if (this.closing) {
      return Promise.reject(
        new Error('Development app controller is shutting down.')
      );
    }
    if (this.page && !this.page.isClosed()) return this.status();
    if (this.launchPromise) return this.launchPromise;
    if (this.app) {
      return Promise.reject(
        new Error(
          'Development Electron is still running without a ready renderer; refusing to overwrite its controller state.'
        )
      );
    }

    const launchPromise = this.launchApplication();
    const trackedLaunchPromise = launchPromise.finally(() => {
      if (this.launchPromise === trackedLaunchPromise) {
        this.launchPromise = null;
      }
    });
    this.launchPromise = trackedLaunchPromise;
    return trackedLaunchPromise;
  }

  async launchApplication() {
    await this.retirementPromise?.catch(() => {});

    const ownerLease = this.createOwnerLease();
    this.ownerLease = ownerLease;
    let activeApp = null;
    let activeProcess = null;

    try {
      await ownerLease.start();
      const { _electron: electron } = await this.loadElectron();
      const signalListeners = this.captureSignalListeners();
      try {
        activeApp = await electron.launch({
          executablePath: electronExecutable,
          args: [appDirectory],
          cwd: appDirectory,
          env: {
            ...process.env,
            TRANSLATOR_AGENT_DEV: '1',
            ...ownerLease.environment(),
          },
          timeout: 45_000,
        });
      } finally {
        // Electron Playwright installs its own process signal handlers even
        // though this controller already owns those signals. Remove only the
        // exact listeners added during this launch call so shutdown continues
        // through one awaited, idempotent controller path.
        this.removeSignalListenersAddedSince(signalListeners);
      }
      activeProcess = activeApp.process?.() ?? null;
      this.app = activeApp;
      this.appProcess = activeProcess;
      // Publish the launched process before native tracking. If shutdown began
      // while electron.launch() was pending and monitor tracking now throws,
      // the shared close path must still retain the exact app it has to reap.
      if (activeProcess) this.ownerMonitor?.trackProcess(activeProcess);
      activeApp.once?.('close', () =>
        this.applicationClosed(activeApp, ownerLease)
      );
      activeProcess?.once?.('exit', () =>
        this.applicationProcessExited(activeProcess)
      );

      if (this.closing) {
        throw new Error(
          'Development app controller disconnected during launch.'
        );
      }
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (this.closing) {
          throw new Error(
            'Development app controller disconnected during launch.'
          );
        }
        const windows = activeApp.windows();
        this.page =
          windows.find(page =>
            page.url().includes('renderer/dist/index.html')
          ) || null;
        if (this.page) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!this.page) {
        throw new Error('Translator renderer did not become ready.');
      }
      await this.page.waitForFunction(
        () => Boolean(window.translatorAgent?.status),
        null,
        { timeout: 20_000 }
      );
      if (!ownerLease.isConnected()) {
        throw new Error(
          'Translator renderer became ready without authenticating its development ownership lease.'
        );
      }
      return this.status();
    } catch (error) {
      if (activeApp && !this.closing) {
        await this.abortFailedLaunch(activeApp, activeProcess, ownerLease);
      } else if (!activeApp) {
        await ownerLease.close().catch(() => {});
        if (this.ownerLease === ownerLease) this.ownerLease = null;
      }
      throw error;
    }
  }

  waitForApplicationTermination(activeApp, activeProcess) {
    if (!activeApp) return Promise.resolve();
    const existing = this.applicationTerminationPromises.get(activeApp);
    if (existing) return existing;
    if (activeProcess?.exitCode != null || activeProcess?.signalCode != null) {
      return Promise.resolve();
    }

    const termination = new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        activeApp.off?.('close', finish);
        activeProcess?.off?.('exit', finish);
        resolve();
      };
      activeApp.once?.('close', finish);
      activeProcess?.once?.('exit', finish);
    });
    this.applicationTerminationPromises.set(activeApp, termination);
    return termination;
  }

  requestApplicationClose(activeApp) {
    if (!activeApp) return Promise.resolve();
    const existing = this.applicationClosePromises.get(activeApp);
    if (existing) return existing;

    const activeProcess =
      this.app === activeApp
        ? this.appProcess
        : (activeApp.process?.() ?? null);
    const terminated = this.waitForApplicationTermination(
      activeApp,
      activeProcess
    );
    let playwrightClose;
    try {
      playwrightClose = Promise.resolve(activeApp.close());
    } catch (error) {
      playwrightClose = Promise.reject(error);
    }
    const closing = Promise.race([playwrightClose, terminated]);
    this.applicationClosePromises.set(activeApp, closing);
    return closing;
  }

  captureSignalListeners() {
    return new Map(
      CONTROLLER_SIGNALS.map(signal => [
        signal,
        new Set(this.processTarget.listeners?.(signal) ?? []),
      ])
    );
  }

  removeSignalListenersAddedSince(snapshot) {
    for (const [signal, originalListeners] of snapshot) {
      for (const listener of this.processTarget.listeners?.(signal) ?? []) {
        if (!originalListeners.has(listener)) {
          this.processTarget.off?.(signal, listener);
        }
      }
    }
  }

  forceProcessOnce(activeProcess) {
    if (
      !activeProcess ||
      this.forceKilledProcesses.has(activeProcess) ||
      activeProcess.exitCode != null ||
      activeProcess.signalCode != null
    ) {
      return false;
    }

    this.forceKilledProcesses.add(activeProcess);
    return this.forceKill(activeProcess);
  }

  applicationProcessExited(activeProcess) {
    try {
      this.ownerMonitor?.untrackProcess(activeProcess);
    } catch {
      // A failed native monitor independently requests controller shutdown.
    }
  }

  applicationClosed(activeApp, ownerLease) {
    if (this.app !== activeApp) return;

    this.page = null;
    if (this.closing) return;

    this.app = null;
    this.appProcess = null;
    if (this.ownerLease === ownerLease) this.ownerLease = null;
    const retirement = Promise.resolve()
      .then(() => ownerLease.close())
      .catch(() => {});
    const trackedRetirement = retirement.finally(() => {
      if (this.retirementPromise === trackedRetirement) {
        this.retirementPromise = null;
      }
    });
    this.retirementPromise = trackedRetirement;
  }

  async abortFailedLaunch(activeApp, activeProcess, ownerLease) {
    const closing = this.requestApplicationClose(activeApp);
    void closing.catch(() => {});

    // Revocation closes the authenticated lease synchronously before its
    // promise performs endpoint cleanup. Observe that cleanup, but do not let
    // a defective close callback hold a forced launch abort open forever.
    try {
      void Promise.resolve(ownerLease.revoke()).catch(() => {});
    } catch {
      // The Electron process tree is still the terminal ownership boundary.
    }
    this.forceProcessOnce(activeProcess);

    if (this.app === activeApp) {
      this.app = null;
      this.appProcess = null;
      this.page = null;
    }
    if (this.ownerLease === ownerLease) this.ownerLease = null;
  }

  async ensureReady() {
    if (!this.page || this.page.isClosed()) {
      throw new Error('Development app is not running. Call app_launch first.');
    }
  }

  async call(method, args = undefined) {
    await this.ensureReady();
    return this.page.evaluate(
      async ({ methodName, methodArgs }) => {
        const bridge = window.translatorAgent;
        const fn = bridge?.[methodName];
        if (typeof fn !== 'function') {
          throw new Error(`Unknown Translator agent method: ${methodName}`);
        }
        return fn(methodArgs);
      },
      { methodName: method, methodArgs: args }
    );
  }

  async status(input = undefined) {
    return this.call('status', input);
  }

  async screenshot(outputPath) {
    await this.ensureReady();
    const destination = path.resolve(outputPath);
    await this.page.screenshot({ path: destination });
    return { outputPath: destination };
  }

  async close() {
    if (this.closePromise) return this.closePromise;

    this.closing = true;
    this.closePromise = Promise.resolve().then(async () => {
      const launchInProgress = this.launchPromise;
      const closeActiveAppOnce = async () => {
        const activeApp = this.app;
        this.page = null;
        await this.requestApplicationClose(activeApp);
      };

      try {
        // Close an already-launched app immediately so Playwright waits reject
        // promptly, then catch an app whose electron.launch resolved after the
        // first snapshot was taken.
        await closeActiveAppOnce();
        await launchInProgress?.catch(() => {});
        await closeActiveAppOnce();
        await this.ownerLease?.close();
        await this.retirementPromise?.catch(() => {});
      } catch (error) {
        // A rejected close is a known failed cleanup, not a reason to forget a
        // potentially live process. Revoke its lease and force the exact child
        // tree once; only a still-pending close waits for external escalation.
        try {
          void Promise.resolve(this.ownerLease?.revoke()).catch(() => {});
        } catch {
          // Process termination remains the final ownership boundary.
        }
        try {
          this.forceProcessOnce(
            this.appProcess ?? this.app?.process?.() ?? null
          );
        } catch {
          // Preserve the original Playwright/lease close failure for callers.
        }
        throw error;
      } finally {
        this.app = null;
        this.appProcess = null;
        this.page = null;
        this.ownerLease = null;
      }
    });
    return this.closePromise;
  }

  forceClose() {
    if (this.forceClosePromise) return this.forceClosePromise;

    const gracefulClose = this.close();
    void gracefulClose.catch(() => {});
    this.forceClosePromise = Promise.resolve().then(() => {
      const launchInProgress = this.launchPromise;
      let firstError = null;

      // Starting revocation is mandatory; awaiting it is not. The force path
      // must remain independent of both Playwright close() and lease endpoint
      // cleanup promises, either of which could be permanently pending.
      try {
        void Promise.resolve(this.ownerLease?.revoke()).catch(() => {});
      } catch (error) {
        firstError ??= error;
      }

      try {
        this.forceProcessOnce(this.appProcess ?? this.app?.process?.() ?? null);
      } catch (error) {
        firstError ??= error;
      }

      if (launchInProgress) {
        void launchInProgress
          .then(
            () =>
              this.forceProcessOnce(
                this.appProcess ?? this.app?.process?.() ?? null
              ),
            () =>
              this.forceProcessOnce(
                this.appProcess ?? this.app?.process?.() ?? null
              )
          )
          .catch(() => {});
      }

      if (firstError) throw firstError;
    });
    return this.forceClosePromise;
  }
}
