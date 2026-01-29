import { dialog } from 'electron';
import { execa } from 'execa';
import log from 'electron-log';
import fsp from 'node:fs/promises';
import { getFocusedOrMainWindow } from '../../utils/window.js';
import { resolveBrowserCookiesPath } from './utils.js';
import { settingsStore } from '../../store/settings-store.js';

type WindowsCookieBrowser = 'chrome' | 'edge';

function getAutoCloseEnabled(browser: WindowsCookieBrowser): boolean {
  const key = browser === 'chrome' ? 'cookiesAutoCloseChrome' : 'cookiesAutoCloseEdge';
  return settingsStore.get(key) === true;
}

function setAutoCloseEnabled(browser: WindowsCookieBrowser, enabled: boolean): void {
  const key = browser === 'chrome' ? 'cookiesAutoCloseChrome' : 'cookiesAutoCloseEdge';
  settingsStore.set(key, enabled);
}

export async function isWindowsBrowserRunning(
  browser: WindowsCookieBrowser
): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  const procName = browser === 'chrome' ? 'chrome' : 'msedge';
  try {
    await execa(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-Process -Name ${procName} -ErrorAction SilentlyContinue; if ($p) { exit 0 } else { exit 1 }`,
      ],
      { windowsHide: true, timeout: 5_000 }
    );
    return true;
  } catch {
    return false;
  }
}

async function closeWindowsBrowser(browser: WindowsCookieBrowser): Promise<void> {
  const procName = browser === 'chrome' ? 'chrome' : 'msedge';

  // Best-effort graceful close (sends WM_CLOSE), then force if still running.
  const cmd =
    `$p = Get-Process -Name ${procName} -ErrorAction SilentlyContinue; ` +
    `if ($p) { ` +
    `$p | ForEach-Object { $_.CloseMainWindow() | Out-Null }; ` +
    `Start-Sleep -Milliseconds 1200; ` +
    `$p2 = Get-Process -Name ${procName} -ErrorAction SilentlyContinue; ` +
    `if ($p2) { $p2 | Stop-Process -Force -ErrorAction SilentlyContinue } ` +
    `}`;

  await execa(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
    { windowsHide: true, timeout: 30_000 }
  ).catch(err => {
    // Don't hard-fail here; caller will verify cookie DB accessibility and provide guidance.
    log.warn(
      `[cookies] Failed to close ${browser} via PowerShell (continuing):`,
      err?.message || err
    );
  });
}

async function waitForCookiesDbReadable(
  browser: WindowsCookieBrowser,
  timeoutMs: number
): Promise<boolean> {
  const cookiePath = resolveBrowserCookiesPath(browser);
  if (!cookiePath) return true;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const handle = await fsp.open(cookiePath, 'r');
      await handle.close();
      return true;
    } catch {
      // likely still locked; retry shortly
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

export async function maybeEnsureWindowsCookiesAccessible(opts: {
  browser: WindowsCookieBrowser;
  operationId: string;
}): Promise<void> {
  if (process.platform !== 'win32') return;

  const { browser, operationId } = opts;
  const running = await isWindowsBrowserRunning(browser);
  if (!running) return;

  const enabled = getAutoCloseEnabled(browser);
  if (!enabled) {
    const appName = browser === 'chrome' ? 'Chrome' : 'Edge';
    const options = {
      type: 'warning' as const,
      title: `Close ${appName} to Use Cookies`,
      message: `${appName} is currently running.`,
      detail:
        `On Windows, ${appName} often locks its cookie database while running. ` +
        `Translator can close ${appName} to read cookies, then continue the download. ` +
        `You can reopen ${appName} afterwards.`,
      buttons: [`Close ${appName} and continue`, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      checkboxLabel: `Always close ${appName} automatically when needed`,
      checkboxChecked: false,
      noLink: true,
    };

    const parent = getFocusedOrMainWindow();
    const res = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);

    if (res.response !== 0) {
      throw new Error(
        `To use ${appName} cookies, please close ${appName} completely and retry.`
      );
    }

    if (res.checkboxChecked) {
      setAutoCloseEnabled(browser, true);
    }
  }

  log.info(
    `[cookies] Closing ${browser} to read cookies (Op ID: ${operationId})`
  );
  await closeWindowsBrowser(browser);
  const readable = await waitForCookiesDbReadable(browser, 10_000);
  if (!readable) {
    const appName = browser === 'chrome' ? 'Chrome' : 'Edge';
    throw new Error(
      `${appName} cookies are still locked. Please close ${appName} (including background processes) and retry.`
    );
  }
}
