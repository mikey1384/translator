import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Browser,
  BrowserPlatform,
  Cache,
  computeExecutablePath,
  getDownloadUrl,
  install,
} from '@puppeteer/browsers';
import {
  releaseInstallLock,
  waitForInstallLock,
  type InstallLockLogger,
} from './headless-chrome-install-lock.js';
import { downloadVerifiedBrowserArchive } from './verified-browser-download.js';

export interface HeadlessChromeProgress {
  stage: 'waiting' | 'downloading' | 'installing' | 'ready';
  downloadedBytes: number;
  totalBytes: number;
}

export interface HeadlessChromeRequest {
  onProgress?: (progress: HeadlessChromeProgress) => void;
  signal?: AbortSignal;
}

interface RuntimeOptions {
  cacheDir: string;
  platform: BrowserPlatform;
  buildId: string;
  baseUrl: string;
  sha256: string;
  size: number;
  logger: InstallLockLogger;
  fetchArchive?: (url: string, init?: RequestInit) => Promise<Response>;
}

export async function isHeadlessChromeBinaryValid(
  executablePath: string,
  platform: BrowserPlatform
): Promise<boolean> {
  try {
    const stat = await fs.stat(executablePath);
    if (!stat.isFile() || stat.size === 0) return false;
    if (
      platform !== BrowserPlatform.WIN64 &&
      platform !== BrowserPlatform.WIN32
    ) {
      await fs.access(executablePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * Windows antivirus often still holds freshly extracted files open, so a
 * folder rename right after extraction can fail briefly. Retry for ~10 s.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (!code || !RENAME_RETRY_CODES.has(code) || attempt >= 9) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

/** One shared download per process; cancellation stops a caller, not prefetch. */
export function createHeadlessChromeRuntime(options: RuntimeOptions) {
  const { cacheDir, platform, buildId, baseUrl, sha256, size, logger } =
    options;
  if (
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !/^[0-9A-Za-z._-]+$/.test(buildId) ||
    !Number.isSafeInteger(size) ||
    size <= 0
  ) {
    throw new Error('Invalid pinned video export tools manifest');
  }
  const location = (root: string) =>
    computeExecutablePath({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId,
      cacheDir: root,
      platform,
    });
  const installationDir = (root: string) =>
    new Cache(root).installationDir(
      Browser.CHROMEHEADLESSSHELL,
      platform,
      buildId
    );
  const receipt = { buildId, platform, sha256 };
  const markerName = '.stage5-verified.json';
  const lockFile = path.join(cacheDir, '.install-lock');
  const listeners = new Set<NonNullable<HeadlessChromeRequest['onProgress']>>();
  let pending: Promise<string> | undefined;
  let latest: HeadlessChromeProgress = {
    stage: 'waiting',
    downloadedBytes: 0,
    totalBytes: size,
  };
  let lastEmittedAt = 0;

  function report(progress: HeadlessChromeProgress, force = false) {
    const stageChanged = progress.stage !== latest.stage;
    latest = progress;
    if (!force && !stageChanged && Date.now() - lastEmittedAt < 150) return;
    lastEmittedAt = Date.now();
    for (const listener of listeners) {
      try {
        listener(progress);
      } catch {
        /* A closed UI cannot fail installation. */
      }
    }
  }

  async function findReady(): Promise<string | null> {
    try {
      const saved = JSON.parse(
        await fs.readFile(
          path.join(installationDir(cacheDir), markerName),
          'utf8'
        )
      );
      if (
        saved.buildId !== buildId ||
        saved.platform !== platform ||
        saved.sha256 !== sha256
      )
        return null;
      return (await isHeadlessChromeBinaryValid(location(cacheDir), platform))
        ? location(cacheDir)
        : null;
    } catch {
      return null;
    }
  }

  // Each Puppeteer upgrade pins a new build; drop the old ones (~250 MB each).
  async function removeOtherVersions(): Promise<void> {
    const current = installationDir(cacheDir);
    const parent = path.dirname(current);
    const prefix = `${platform}-`;
    for (const entry of await fs.readdir(parent).catch(() => [] as string[])) {
      if (entry.startsWith(prefix) && entry !== path.basename(current)) {
        await fs
          .rm(path.join(parent, entry), { recursive: true, force: true })
          .catch(error =>
            logger.warn(
              `[HeadlessChrome] Could not remove old version ${entry}: ${String(error)}`
            )
          );
      }
    }
  }

  async function ensureInstalled(): Promise<string> {
    const existing = await findReady();
    if (existing) return existing;
    report({ stage: 'waiting', downloadedBytes: 0, totalBytes: size });
    const lock = await waitForInstallLock({
      lockFile,
      findReadyValue: findReady,
      maxWaitTime: 30 * 60_000,
      checkInterval: 1000,
      logger,
    });
    if (lock.readyValue !== null) return lock.readyValue;
    let staging: string | undefined;
    try {
      const concurrentlyInstalled = await findReady();
      if (concurrentlyInstalled) return concurrentlyInstalled;
      // The lock owns all scratch under this cache. Recover interrupted downloads.
      for (const entry of await fs.readdir(cacheDir)) {
        if (entry.startsWith('.download-')) {
          await fs.rm(path.join(cacheDir, entry), {
            recursive: true,
            force: true,
          });
        }
      }
      staging = await fs.mkdtemp(path.join(cacheDir, '.download-'));
      report({ stage: 'downloading', downloadedBytes: 0, totalBytes: size });
      const archiveUrl = getDownloadUrl(
        Browser.CHROMEHEADLESSSHELL,
        platform,
        buildId,
        baseUrl
      );
      const browserRoot = path.join(staging, Browser.CHROMEHEADLESSSHELL);
      await fs.mkdir(browserRoot, { recursive: true });
      // Puppeteer trusts cached archives. Only seed its private staging cache
      // after our streaming download verifies both the pinned size and SHA-256.
      await downloadVerifiedBrowserArchive({
        url: archiveUrl.toString(),
        destination: path.join(
          browserRoot,
          `${buildId}-${path.basename(archiveUrl.pathname)}`
        ),
        sha256,
        size,
        fetchArchive: options.fetchArchive,
        onProgress: (downloadedBytes, totalBytes) =>
          report({
            stage: 'downloading',
            downloadedBytes,
            totalBytes,
          }),
      });
      report({ stage: 'installing', downloadedBytes: size, totalBytes: size });
      const installed = await install({
        browser: Browser.CHROMEHEADLESSSHELL,
        buildId,
        platform,
        cacheDir: staging,
        baseUrl,
        expectedHash: sha256,
      });
      if (
        installed.executablePath !== location(staging) ||
        !(await isHeadlessChromeBinaryValid(installed.executablePath, platform))
      ) {
        throw new Error(
          'Video export tools installation has no valid executable'
        );
      }
      report({ stage: 'installing', downloadedBytes: size, totalBytes: size });
      await fs.writeFile(
        path.join(installationDir(staging), markerName),
        JSON.stringify(receipt)
      );
      // Publish only a fully extracted, verified installation, while holding the lock.
      await fs.mkdir(path.dirname(installationDir(cacheDir)), {
        recursive: true,
      });
      await fs.rm(installationDir(cacheDir), { recursive: true, force: true });
      await renameWithRetry(
        installationDir(staging),
        installationDir(cacheDir)
      );
      const ready = await findReady();
      if (!ready)
        throw new Error('Video export tools installation did not verify');
      await removeOtherVersions();
      return ready;
    } finally {
      try {
        if (staging) await fs.rm(staging, { recursive: true, force: true });
      } finally {
        await releaseInstallLock(lockFile, lock.lockToken, logger);
      }
    }
  }

  function ensure({
    onProgress,
    signal,
  }: HeadlessChromeRequest = {}): Promise<string> {
    if (signal?.aborted)
      return Promise.reject(new DOMException('Cancelled', 'AbortError'));
    if (!pending) {
      // Extraction and lock waits report nothing for minutes; re-send the
      // latest state so render watchdogs keep seeing progress.
      const heartbeat = setInterval(() => report(latest, true), 10_000);
      heartbeat.unref?.();
      pending = ensureInstalled()
        .then(result => {
          report({ stage: 'ready', downloadedBytes: size, totalBytes: size });
          return result;
        })
        .finally(() => {
          clearInterval(heartbeat);
          pending = undefined;
        });
    }
    const shared = pending;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        if (onProgress) listeners.delete(onProgress);
        signal?.removeEventListener('abort', abort);
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (onProgress) {
        listeners.add(onProgress);
        try {
          onProgress(latest);
        } catch {
          /* Observe without owning installation. */
        }
      }
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      shared.then(
        result => {
          cleanup();
          resolve(result);
        },
        error => {
          cleanup();
          reject(error);
        }
      );
    });
  }

  return { ensure, findReady };
}
