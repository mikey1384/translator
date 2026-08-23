import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Browser,
  Cache,
  computeExecutablePath,
  detectBrowserPlatform,
  install,
} from '@puppeteer/browsers';
import { app } from 'electron';
import log from 'electron-log';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/lib/puppeteer/revisions.js';
import {
  releaseInstallLock,
  waitForInstallLock,
} from './headless-chrome-install-lock.js';

const HEADLESS_CHROME_BUILD_ID = PUPPETEER_REVISIONS['chrome-headless-shell'];

if (
  typeof HEADLESS_CHROME_BUILD_ID !== 'string' ||
  !/^[0-9A-Za-z._-]+$/.test(HEADLESS_CHROME_BUILD_ID)
) {
  throw new Error('Puppeteer did not expose a valid headless-shell revision.');
}

interface HeadlessChromePaths {
  headlessDir: string;
  lockFile: string;
}

/**
 * Get the expected paths for headless Chrome binary
 */
function getHeadlessChromePaths(): HeadlessChromePaths {
  const headlessDir = path.join(
    app.getPath('userData'),
    'bin',
    process.arch === 'arm64' ? 'headless-arm64' : 'headless-x64'
  );

  const lockFile = path.join(headlessDir, '.install-lock');

  return { headlessDir, lockFile };
}

/**
 * Check if headless Chrome binary exists and is executable
 */
async function isHeadlessChromeBinaryValid(
  executablePath: string
): Promise<boolean> {
  try {
    const stat = await fs.stat(executablePath);
    if (!stat.isFile()) return false;

    // On Windows, just check if file exists
    if (process.platform === 'win32') return true;

    // On Unix-like systems, check if executable
    try {
      await fs.access(executablePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Resolve only the executable owned by the lockfile-pinned Puppeteer build.
 */
async function findPinnedExecutable(
  headlessDir: string
): Promise<string | null> {
  try {
    const platform = detectBrowserPlatform();
    if (!platform) return null;

    const executablePath = computeExecutablePath({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: HEADLESS_CHROME_BUILD_ID,
      cacheDir: headlessDir,
      platform,
    });
    if (await isHeadlessChromeBinaryValid(executablePath)) {
      return executablePath;
    }

    return null;
  } catch (error) {
    log.warn(`[HeadlessChrome] Error resolving pinned executable: ${error}`);
    return null;
  }
}

/**
 * Download and install headless Chrome using @puppeteer/browsers
 */
async function downloadHeadlessChrome(headlessDir: string): Promise<void> {
  log.info(
    `[HeadlessChrome] Downloading chrome-headless-shell@${HEADLESS_CHROME_BUILD_ID} to ${headlessDir}`
  );

  try {
    // Ensure directory exists
    await fs.mkdir(headlessDir, { recursive: true });

    const platform = detectBrowserPlatform();
    if (!platform) {
      throw new Error(
        `Unsupported platform for headless Chrome: ${process.platform}/${process.arch}`
      );
    }

    // @puppeteer/browsers treats an existing installation directory as a
    // completed cache hit. Remove only this exact browser/platform/build while
    // holding the install lock so a truncated prior download is repairable.
    const installationDir = new Cache(headlessDir).installationDir(
      Browser.CHROMEHEADLESSSHELL,
      platform,
      HEADLESS_CHROME_BUILD_ID
    );
    await fs.rm(installationDir, { recursive: true, force: true });

    const installedBrowser = await install({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: HEADLESS_CHROME_BUILD_ID,
      cacheDir: headlessDir,
      platform,
    });

    if (!(await isHeadlessChromeBinaryValid(installedBrowser.executablePath))) {
      throw new Error(
        'Puppeteer reported a completed headless Chrome install without an executable binary'
      );
    }

    log.info(
      `[HeadlessChrome] Download completed at ${installedBrowser.executablePath}`
    );

    const pinnedExecutable = await findPinnedExecutable(headlessDir);
    if (pinnedExecutable !== installedBrowser.executablePath) {
      throw new Error(
        'Puppeteer installed headless Chrome outside the pinned cache location'
      );
    }

    log.info(
      `[HeadlessChrome] Verified pinned executable: ${pinnedExecutable}`
    );
  } catch (error) {
    log.error(`[HeadlessChrome] Download failed: ${error}`);
    throw error;
  }
}

/**
 * Ensure headless Chrome binary is available, downloading if necessary
 */
export async function ensureHeadlessChrome(): Promise<string> {
  const { headlessDir, lockFile } = getHeadlessChromePaths();

  const pinnedExecutable = await findPinnedExecutable(headlessDir);
  if (pinnedExecutable) {
    log.info(`[HeadlessChrome] Using pinned binary: ${pinnedExecutable}`);
    return pinnedExecutable;
  }

  // Binary not found, need to download
  log.info(`[HeadlessChrome] Binary not found, downloading...`);

  // Wait up to five minutes for an active installer, but retry the atomic
  // acquisition each turn. If that installer exits, its stale lock is
  // recovered immediately instead of forcing this process to time out.
  const maxWaitTime = 300000;
  const checkInterval = 5000;
  const lock = await waitForInstallLock({
    lockFile,
    findReadyValue: () => findPinnedExecutable(headlessDir),
    maxWaitTime,
    checkInterval,
    logger: log,
  });
  if (lock.readyValue !== null) return lock.readyValue;
  const lockToken = lock.lockToken;

  try {
    // The other process can finish between our last executable check and our
    // successful lock creation. Keep its valid result instead of redownloading.
    const concurrentlyInstalled = await findPinnedExecutable(headlessDir);
    if (concurrentlyInstalled) return concurrentlyInstalled;

    // Download headless Chrome
    await downloadHeadlessChrome(headlessDir);

    const installedExecutable = await findPinnedExecutable(headlessDir);
    if (installedExecutable) {
      log.info(
        `[HeadlessChrome] Installation successful: ${installedExecutable}`
      );
      return installedExecutable;
    }

    throw new Error(
      'Headless Chrome installation completed but binary not found'
    );
  } finally {
    await releaseInstallLock(lockFile, lockToken, log);
  }
}

/**
 * Get the headless Chrome executable path for use in packaged apps
 * This function handles both bundled and auto-downloaded binaries
 */
export async function getHeadlessChromePath(): Promise<string> {
  const isDev = !app.isPackaged;

  if (isDev) {
    // In development, let Puppeteer use its own Chrome
    return '';
  }

  const bundledDir = path.join(
    process.resourcesPath,
    process.arch === 'arm64' ? 'headless-arm64' : 'headless-x64'
  );
  const bundledPath = await findPinnedExecutable(bundledDir);

  if (bundledPath) {
    log.info(`[HeadlessChrome] Using bundled binary: ${bundledPath}`);
    return bundledPath;
  }

  // Bundled binary not found, use auto-download
  log.info(`[HeadlessChrome] Bundled binary not found, using auto-download`);
  return await ensureHeadlessChrome();
}
