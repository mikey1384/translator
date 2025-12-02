import {
  autoUpdater,
  UpdateCheckResult,
  UpdateInfo,
  ProgressInfo,
} from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

/* ----------------------------------------------------------
 * A single factory that returns update handlers.
 * No extra "initialize…" call needed.
 * -------------------------------------------------------- */
export function buildUpdateHandlers(opts: {
  mainWindow: BrowserWindow;
  isDev: boolean;
}) {
  const { mainWindow, isDev } = opts;

  if (isDev) {
    log.info('[update] Skipping auto-update in dev mode');
    return null;
  }

  /* 1️⃣  Configure ---------------------------------------------------- */
  autoUpdater.autoDownload = true; // download automatically in background
  autoUpdater.disableWebInstaller = true; // VSCode-style in-place update
  autoUpdater.logger = log;
  // Force Windows builds to use our Cloudflare generic feed going forward
  try {
    if (process.platform === 'win32') {
      const url = 'https://downloads.stage5.tools/win/latest/';
      // setFeedURL overrides provider selection from app-update.yml
      autoUpdater.setFeedURL({ provider: 'generic', url });
      log.info(`[update] Windows feed set to generic: ${url}`);
    }
  } catch (e) {
    log.warn('[update] Failed to set Windows feed URL:', e);
  }
  autoUpdater.channel = 'latest'; // or 'beta', 'alpha', …

  /* 2️⃣  Event fan-out to renderer ----------------------------------- */
  const send = (chan: string, payload?: any) => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed()
    ) {
      mainWindow.webContents.send(`update:${chan}`, payload);
    } else {
      log.warn(
        `[update] Renderer window unavailable, dropping event: update:${chan}`
      );
    }
  };

  autoUpdater.on('error', err => {
    log.error('[update] Error:', err);
    send('error', err == null ? 'unknown' : String(err));
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('[update] Update available:', info);
    log.info('[update] Starting automatic download...');
    send('available', info);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[update] Update not available');
    send('not-available');
  });

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    log.info(`[update] Download progress: ${progress.percent}%`);
    send('progress', progress.percent);
  });

  autoUpdater.on('update-downloaded', () => {
    log.info('[update] Update downloaded');
    send('downloaded');
  });

  /* 3️⃣  IPC API ------------------------------------------------------ */
  async function checkForUpdates(_evt: any): Promise<UpdateCheckResult | null> {
    try {
      log.info('[update] Checking for updates...');
      return await autoUpdater.checkForUpdates();
    } catch (err: any) {
      log.error('[update] Check for updates failed:', err);
      throw err;
    }
  }

  async function downloadUpdate(_evt: any): Promise<void> {
    try {
      log.info('[update] Starting download...');
      await autoUpdater.downloadUpdate();
    } catch (err: any) {
      log.error('[update] Download failed:', err);
      throw err;
    }
  }

  async function installUpdate(_evt: any): Promise<void> {
    try {
      log.info('[update] Installing update...');
      // will quit & relaunch automatically
      autoUpdater.quitAndInstall();
    } catch (err: any) {
      log.error('[update] Install failed:', err);
      throw err;
    }
  }

  // Register IPC handlers
  ipcMain.handle('update:check', checkForUpdates);
  ipcMain.handle('update:download', downloadUpdate);
  ipcMain.handle('update:install', installUpdate);

  /* ------------------------------------------------ */
  return {
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
