import {
  autoUpdater,
  UpdateCheckResult,
  UpdateInfo,
  ProgressInfo,
} from 'electron-updater';
import { app, BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';
import { settingsStore } from '../store/settings-store.js';

const PENDING_POST_INSTALL_NOTICE_KEY = 'pendingPostInstallNotice';

type PostInstallNotice = {
  version: string;
  releaseName?: string;
  releaseDate?: string;
  notes: string;
};

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function sanitizeReleaseNotes(input: string): string {
  const withBreaks = input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ');
  const withoutHtml = withBreaks.replace(/<[^>]*>/g, '');
  const decoded = decodeHtmlEntities(withoutHtml).replace(/\r\n/g, '\n');
  return decoded
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getReleaseNotesText(info: UpdateInfo | null | undefined): string {
  if (!info) return '';

  const { releaseNotes } = info;
  if (typeof releaseNotes === 'string') {
    return sanitizeReleaseNotes(releaseNotes);
  }

  if (Array.isArray(releaseNotes)) {
    const sections = releaseNotes
      .map((entry: any) => {
        const note = sanitizeReleaseNotes(String(entry?.note ?? ''));
        if (!note) return '';
        const versionText =
          typeof entry?.version === 'string' && entry.version.trim()
            ? `v${entry.version.trim()}`
            : '';
        return versionText ? `${versionText}\n${note}` : note;
      })
      .filter(Boolean);
    return sanitizeReleaseNotes(sections.join('\n\n'));
  }

  return '';
}

function stagePostInstallNotice(info: UpdateInfo | null | undefined): void {
  const targetVersion =
    info && typeof info.version === 'string' ? info.version.trim() : '';
  const notes = getReleaseNotesText(info);

  if (!targetVersion) {
    return;
  }

  if (!notes) {
    settingsStore.set(PENDING_POST_INSTALL_NOTICE_KEY, null);
    log.info(
      `[update] No release notes found for v${targetVersion}; skipping post-install popup`
    );
    return;
  }

  settingsStore.set(PENDING_POST_INSTALL_NOTICE_KEY, {
    targetVersion,
    releaseName:
      info && typeof info.releaseName === 'string'
        ? info.releaseName.trim()
        : undefined,
    releaseDate:
      info && typeof info.releaseDate === 'string'
        ? info.releaseDate.trim()
        : undefined,
    notes,
    preparedAt: new Date().toISOString(),
  });

  log.info(`[update] Staged post-install notes for v${targetVersion}`);
}

function consumePostInstallNotice(): PostInstallNotice | null {
  const pending = settingsStore.get(PENDING_POST_INSTALL_NOTICE_KEY);
  if (!pending) return null;

  const currentVersion = app.getVersion();
  if (pending.targetVersion !== currentVersion) {
    // Keep staged notes until the target version actually launches.
    return null;
  }

  const notes = String(pending.notes || '').trim();
  settingsStore.set(PENDING_POST_INSTALL_NOTICE_KEY, null);

  if (!notes) return null;

  return {
    version: pending.targetVersion,
    releaseName:
      typeof pending.releaseName === 'string'
        ? pending.releaseName.trim()
        : undefined,
    releaseDate:
      typeof pending.releaseDate === 'string'
        ? pending.releaseDate.trim()
        : undefined,
    notes,
  };
}

/* ----------------------------------------------------------
 * A single factory that returns update handlers.
 * No extra "initialize…" call needed.
 * -------------------------------------------------------- */
export function buildUpdateHandlers(opts: {
  mainWindow: BrowserWindow;
  isDev: boolean;
}) {
  const { mainWindow, isDev } = opts;
  let latestAvailableInfo: UpdateInfo | null = null;

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
    latestAvailableInfo = info;
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

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('[update] Update downloaded');
    const noticeSource = info ?? latestAvailableInfo;
    stagePostInstallNotice(noticeSource);
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
  ipcMain.handle('update:get-post-install-notice', () =>
    consumePostInstallNotice()
  );

  /* ------------------------------------------------ */
  return {
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
