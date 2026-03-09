import { join, dirname } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import https from 'node:https';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  findYtDlpBinary,
  testBinary,
  getPreferredInstallPath,
  getManagedBinaryPath,
} from './binary-locator.js';

// Cache for update check - only check once per hour
let lastUpdateCheckTime = 0;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const CONCURRENT_INSTALL_WAIT_TIMEOUT_MS = 120_000;
const CONCURRENT_INSTALL_POLL_MS = 500;
const WAITING_FOR_SETUP_STAGE = 'Waiting for yt-dlp setup…';

let inFlightEnsureYtDlpBinary: Promise<string> | null = null;
let cachedHealthyBinaryPath: string | null = null;
let cachedHealthyBinaryAt = 0;

export class YtDlpSetupError extends Error {
  attemptedUrl?: string;

  constructor(
    message: string,
    options: { attemptedUrl?: string; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'YtDlpSetupError';
    this.attemptedUrl = options.attemptedUrl;
    if ('cause' in options) {
      (this as any).cause = options.cause;
    }
  }
}

/** Progress callback for yt-dlp binary setup */
export type BinarySetupProgress = (info: {
  stage: string;
  percent?: number;
}) => void;

type BinarySetupProgressInfo = {
  stage: string;
  percent?: number;
};

const ensureYtDlpProgressListeners = new Set<BinarySetupProgress>();
let lastEnsureYtDlpProgress: BinarySetupProgressInfo | null = null;

function emitEnsureYtDlpProgress(info: BinarySetupProgressInfo): void {
  lastEnsureYtDlpProgress = info;
  for (const listener of ensureYtDlpProgressListeners) {
    try {
      listener(info);
    } catch {
      // Ignore listener failures so shared progress keeps flowing.
    }
  }
}

function subscribeEnsureYtDlpProgress(
  listener: BinarySetupProgress
): () => void {
  ensureYtDlpProgressListeners.add(listener);
  if (lastEnsureYtDlpProgress) {
    try {
      listener(lastEnsureYtDlpProgress);
    } catch {
      // Ignore listener failures.
    }
  }
  return () => {
    ensureYtDlpProgressListeners.delete(listener);
  };
}

// Concurrent installation protection using file-based mutex

function getInstallLockFilePath(): string {
  return join(app.getPath('userData'), 'bin', '.install-lock');
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function readInstallLockPid(): Promise<number | null> {
  try {
    const pidStr = await fsp.readFile(getInstallLockFilePath(), 'utf8');
    const pid = parseInt(pidStr, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    return false;
  }
}

async function isInstallLockActive(): Promise<boolean> {
  try {
    await fsp.access(getInstallLockFilePath());
  } catch {
    return false;
  }

  const pid = await readInstallLockPid();
  if (isPidAlive(pid)) {
    return true;
  }

  log.info('[URLprocessor] Removing stale installation lock file');
  await fsp.unlink(getInstallLockFilePath()).catch(() => {});
  return false;
}

function getStagedBinaryPath(binaryPath: string): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  const suffix = process.platform === 'win32' ? '.next.exe' : '.next';
  if (binaryPath.endsWith(suffix)) {
    return binaryPath;
  }
  if (ext && binaryPath.endsWith(ext)) {
    return binaryPath.slice(0, -ext.length) + suffix;
  }
  return `${binaryPath}.next`;
}

function getHealthyBinaryCandidates(targetBinaryPath: string): string[] {
  const candidates = new Set<string>();
  const push = (value: string | null | undefined) => {
    const text = String(value || '').trim();
    if (!text) return;
    candidates.add(getStagedBinaryPath(text));
    candidates.add(text);
  };

  push(targetBinaryPath);
  push(getPreferredInstallPath());
  push(getManagedBinaryPath());

  return [...candidates];
}

function isStagedBinaryCandidate(binaryPath: string): boolean {
  return binaryPath === getStagedBinaryPath(binaryPath);
}

async function resolveHealthyBinaryCandidate(
  targetBinaryPath: string
): Promise<string | null> {
  let bestCandidate: { path: string; mtimeMs: number; staged: boolean } | null =
    null;

  for (const candidate of getHealthyBinaryCandidates(targetBinaryPath)) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      if (!(await testBinary(candidate))) {
        continue;
      }
      const stats = await fsp.stat(candidate);
      const nextCandidate = {
        path: candidate,
        mtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
        staged: isStagedBinaryCandidate(candidate),
      };
      if (
        !bestCandidate ||
        nextCandidate.mtimeMs > bestCandidate.mtimeMs ||
        (nextCandidate.mtimeMs === bestCandidate.mtimeMs &&
          nextCandidate.staged &&
          !bestCandidate.staged)
      ) {
        bestCandidate = nextCandidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  return bestCandidate?.path ?? null;
}

async function waitForConcurrentInstall(options: {
  targetBinaryPath: string;
  onProgress?: BinarySetupProgress;
  timeoutMs?: number;
}): Promise<string | null> {
  const {
    targetBinaryPath,
    onProgress,
    timeoutMs = CONCURRENT_INSTALL_WAIT_TIMEOUT_MS,
  } = options;

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    onProgress?.({ stage: WAITING_FOR_SETUP_STAGE });
    const lockActive = await isInstallLockActive();
    if (!lockActive) {
      break;
    }
    await sleep(CONCURRENT_INSTALL_POLL_MS);
  }

  return resolveHealthyBinaryCandidate(targetBinaryPath);
}

async function validateResolvedInstallBinary(
  binaryPath: string
): Promise<boolean> {
  if (app.isPackaged) {
    return true;
  }

  const supportsRequiredFlags = await supportsRequiredYtDlpFlags(binaryPath);
  if (supportsRequiredFlags === true) {
    return true;
  }

  const managedBinaryPath = getManagedBinaryPath();
  if (supportsRequiredFlags == null && binaryPath === managedBinaryPath) {
    log.warn(
      `[URLprocessor] Could not verify required yt-dlp flags on waited managed binary; continuing with existing managed copy: ${binaryPath}`
    );
    return true;
  }

  if (supportsRequiredFlags === false) {
    log.warn(
      `[URLprocessor] Waited yt-dlp binary is incompatible with Translator requirements (missing --js-runtimes): ${binaryPath}`
    );
  } else {
    log.warn(
      `[URLprocessor] Waited yt-dlp binary could not be verified for required flags: ${binaryPath}`
    );
  }

  return false;
}

function rememberHealthyBinary(binaryPath: string): void {
  cachedHealthyBinaryPath = binaryPath;
  cachedHealthyBinaryAt = Date.now();
}

function clearHealthyBinaryCache(): void {
  cachedHealthyBinaryPath = null;
  cachedHealthyBinaryAt = 0;
}

async function refreshCachedHealthyBinary(
  cachedBinaryPath: string
): Promise<string | null> {
  if (app.isPackaged) {
    const refreshed = await ensureWritableBinary();
    return refreshed || null;
  }

  const managedBinaryPath = getManagedBinaryPath();
  const stagedManagedBinaryPath = getStagedBinaryPath(managedBinaryPath);
  const stagedCachedBinaryPath = getStagedBinaryPath(cachedBinaryPath);
  const candidates = [
    stagedManagedBinaryPath,
    managedBinaryPath,
    stagedCachedBinaryPath,
    cachedBinaryPath,
  ].filter((value, index, all) => value && all.indexOf(value) === index);

  for (const candidate of candidates) {
    try {
      await fsp.access(candidate, fs.constants.X_OK);
      if (!(await testBinary(candidate))) {
        continue;
      }
      if (await validateResolvedInstallBinary(candidate)) {
        return candidate;
      }
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

async function getCachedHealthyBinary(
  shouldCheckUpdate: boolean
): Promise<string | null> {
  if (!cachedHealthyBinaryPath || shouldCheckUpdate) {
    return null;
  }

  try {
    await fsp.access(cachedHealthyBinaryPath, fs.constants.X_OK);
    if (Date.now() - cachedHealthyBinaryAt < UPDATE_CHECK_INTERVAL_MS) {
      const refreshedBinary = await refreshCachedHealthyBinary(
        cachedHealthyBinaryPath
      );
      if (refreshedBinary) {
        if (refreshedBinary !== cachedHealthyBinaryPath) {
          log.info(
            `[URLprocessor] Refreshed cached healthy yt-dlp binary: ${cachedHealthyBinaryPath} -> ${refreshedBinary}`
          );
        }
        rememberHealthyBinary(refreshedBinary);
        return refreshedBinary;
      }
      clearHealthyBinaryCache();
    }
  } catch {
    clearHealthyBinaryCache();
  }

  return null;
}

// Create a mutex file to prevent concurrent installations
async function acquireInstallLock(): Promise<boolean> {
  const lockDir = join(app.getPath('userData'), 'bin');
  await fsp.mkdir(lockDir, { recursive: true });
  const lockFile = getInstallLockFilePath();

  try {
    // Try to create lock file exclusively (fails if exists)
    await fsp.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // Lock file exists, check if process is still running
      try {
        const pidStr = await fsp.readFile(lockFile, 'utf8');
        const pid = parseInt(pidStr, 10);

        let stale = false;
        try {
          // Check if process is still running (this will throw if not)
          process.kill(pid, 0);
          stale = false; // Process exists
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            stale = true; // Process not found
          } else if (e.code === 'EPERM') {
            stale = false; // Process exists but protected (Windows services)
          } else {
            throw e; // Unexpected error
          }
        }

        if (!stale) {
          // Process is still running, installation in progress
          log.info(
            `[URLprocessor] Installation already in progress (PID: ${pid})`
          );
          return false;
        } else {
          // Process not running, remove stale lock file
          log.info('[URLprocessor] Removing stale installation lock file');
          await fsp.unlink(lockFile).catch(() => {});

          // Try again
          try {
            await fsp.writeFile(lockFile, process.pid.toString(), {
              flag: 'wx',
            });
            return true;
          } catch {
            return false;
          }
        }
      } catch {
        // Error reading lock file, assume stale
        log.info('[URLprocessor] Removing unreadable installation lock file');
        await fsp.unlink(lockFile).catch(() => {});

        // Try again
        try {
          await fsp.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
          return true;
        } catch {
          return false;
        }
      }
    }
    return false;
  }
}

async function releaseInstallLock(): Promise<void> {
  await fsp.unlink(getInstallLockFilePath()).catch(() => {});
}

// Follow HTTP redirects (GitHub uses 302 for latest releases)
function fetchWithRedirect(
  url: string,
  maxRedirects = 4
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { 'User-Agent': 'yt-dlp-installer' },
        timeout: 30000,
      },
      response => {
        const location = response.headers.location;
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode!) &&
          location &&
          maxRedirects > 0
        ) {
          log.info(`[URLprocessor] Following redirect to: ${location}`);
          response.resume(); // Prevent socket leak
          return resolve(fetchWithRedirect(location, maxRedirects - 1));
        }
        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode} on ${url}`));
        }
        resolve(response);
      }
    );

    request.on('error', (error: any) => {
      if (error.code === 'ENOTFOUND') {
        reject(new Error('No network connection - unable to reach GitHub'));
      } else {
        reject(error);
      }
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// Calculate SHA-256 hash of a file
async function calculateSHA256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Fetch SHA-256 hash from GitHub release
async function fetchSha256ForRelease(
  downloadUrl: string
): Promise<string | null> {
  try {
    // Convert binary download URL to SHA-256 file URL
    const sha256Url = downloadUrl.replace(/\/([^/]+)$/, '/$1.sha256');
    log.info(`[URLprocessor] Fetching SHA-256 from: ${sha256Url}`);

    const response = await fetchWithRedirect(sha256Url);
    let sha256Data = '';

    for await (const chunk of response) {
      sha256Data += chunk.toString();
    }

    // GitHub's SHA-256 files contain just the hash (64 hex chars)
    const hash = sha256Data.trim().split(/\s+/)[0];
    if (hash && hash.length === 64 && /^[a-f0-9]+$/i.test(hash)) {
      return hash.toLowerCase();
    }

    log.warn(`[URLprocessor] Invalid SHA-256 format: ${sha256Data}`);
    return null;
  } catch (error: any) {
    log.warn(`[URLprocessor] Could not fetch SHA-256 hash: ${error.message}`);
    return null;
  }
}

// Shared helper: Make file executable on Unix systems
async function ensureExecutable(binaryPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await fsp.access(binaryPath, fs.constants.X_OK);
    } catch {
      try {
        await execa('chmod', ['+x', binaryPath], { windowsHide: true });
        log.info(`[URLprocessor] Made ${binaryPath} executable.`);
      } catch (e) {
        log.warn(`[URLprocessor] Failed to chmod +x ${binaryPath}:`, e);
      }
    }
  }
}

// Guarantee that a writable copy exists before downloads start
export async function ensureWritableBinary(): Promise<string> {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const userBin = join(app.getPath('userData'), 'bin', binaryName);
  const userBinNext = join(
    app.getPath('userData'),
    'bin',
    `yt-dlp.next${exeExt}`
  );

  // 1. Prefer a staged "next" binary if present and working. This is important
  // on Windows where the primary exe may be locked (AV scanning, etc.) and thus
  // cannot be replaced in-place.
  try {
    const minBytes =
      process.platform === 'win32' ? 10 * 1024 * 1024 : 2 * 1024 * 1024;

    const nextStats = await fsp.stat(userBinNext).catch(() => null);
    if (nextStats && nextStats.size >= minBytes) {
      const nextOk = await testBinary(userBinNext);
      if (nextOk) {
        const userStats = await fsp.stat(userBin).catch(() => null);
        // Do not use a 1s mtime guard here. On some filesystems/environments the
        // staged binary can be created within the same second as the primary,
        // and we still want to prefer it when it's valid.
        const nextIsNewer = !userStats || nextStats.mtimeMs > userStats.mtimeMs;
        if (nextIsNewer) {
          log.info(`[URLprocessor] Using staged yt-dlp binary: ${userBinNext}`);
          rememberHealthyBinary(userBinNext);
          return userBinNext;
        }
      } else {
        log.warn(
          `[URLprocessor] Staged yt-dlp binary is not working, removing: ${userBinNext}`
        );
        await fsp.unlink(userBinNext).catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  // 2. If we already have a user copy, return it.
  try {
    await fsp.access(userBin, fs.constants.X_OK);
    if (await testBinary(userBin)) {
      log.info(`[URLprocessor] Using existing writable binary: ${userBin}`);
      rememberHealthyBinary(userBin);
      return userBin;
    }
    log.warn(
      `[URLprocessor] Existing writable binary is not working, rebuilding: ${userBin}`
    );
  } catch {
    /* fall through and create it */
  }

  // 3. Acquire lock to prevent race conditions
  if (!(await acquireInstallLock())) {
    log.warn('[URLprocessor] Binary copy already in progress; waiting...');
    const awaitedBinary = await waitForConcurrentInstall({
      targetBinaryPath: userBin,
    });
    if (awaitedBinary) {
      rememberHealthyBinary(awaitedBinary);
      return awaitedBinary;
    }
    throw new Error(
      'Failed to create writable binary copy because another setup never completed successfully'
    );
  }

  try {
    log.info(`[URLprocessor] Creating writable binary copy at: ${userBin}`);

    // 4. Create the folder if needed.
    await fsp.mkdir(dirname(userBin), { recursive: true });

    // 5. Copy the bundled binary once (read-only → writable).
    const bundled = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'youtube-dl-exec',
      'bin',
      binaryName
    );

    try {
      await fsp.copyFile(bundled, userBin);
      log.info(`[URLprocessor] Copied bundled binary to writable location`);
    } catch (error: any) {
      log.error(`[URLprocessor] Failed to copy bundled binary:`, error);
      // If the bundled binary is not present (likely due to missing asarUnpack),
      // fall back to downloading directly into the writable location.
      if (error?.code === 'ENOENT') {
        log.info(
          '[URLprocessor] Bundled yt-dlp not found. Falling back to direct download...'
        );
        const downloaded = await downloadBinaryDirectly(userBin);
        // Ensure executable permissions are set on POSIX systems
        if (process.platform !== 'win32') {
          await fsp.chmod(downloaded, 0o755).catch(() => {});
        }
        rememberHealthyBinary(downloaded);
        return downloaded;
      }
      throw new YtDlpSetupError(
        `Could not create writable yt-dlp copy: ${error?.message ?? error}`
      );
    }

    // 6. Mark it executable (macOS / Linux).
    if (process.platform !== 'win32') {
      await fsp.chmod(userBin, 0o755);
    }

    rememberHealthyBinary(userBin);
    return userBin;
  } finally {
    await releaseInstallLock();
  }
}

/**
 * Ensures yt-dlp binary is available and up-to-date.
 * - If binary doesn't exist, installs it
 * - If binary exists, automatically tries to update it (yt-dlp needs frequent updates)
 * - Returns the path to the working binary
 */
export async function ensureYtDlpBinary({
  skipUpdate = false,
  onProgress,
}: {
  skipUpdate?: boolean;
  onProgress?: BinarySetupProgress;
} = {}): Promise<string> {
  const unsubscribe = onProgress
    ? subscribeEnsureYtDlpProgress(onProgress)
    : null;
  if (inFlightEnsureYtDlpBinary) {
    if (!lastEnsureYtDlpProgress && onProgress) {
      onProgress({ stage: WAITING_FOR_SETUP_STAGE });
    }
    try {
      return await inFlightEnsureYtDlpBinary;
    } finally {
      unsubscribe?.();
    }
  }

  const promise = ensureYtDlpBinaryInternal({ skipUpdate }).finally(
    () => {
      if (inFlightEnsureYtDlpBinary === promise) {
        inFlightEnsureYtDlpBinary = null;
      }
      lastEnsureYtDlpProgress = null;
    }
  );
  inFlightEnsureYtDlpBinary = promise;
  try {
    return await promise;
  } finally {
    unsubscribe?.();
  }
}

async function ensureYtDlpBinaryInternal({
  skipUpdate = false,
}: {
  skipUpdate?: boolean;
} = {}): Promise<string> {
  // Start crawling progress immediately so users see movement during slow operations
  const INIT_END = 99; // Crawl toward 99%, which maps to ~4.9% overall (never reaches 5%)
  let currentPercent = 0;
  emitEnsureYtDlpProgress({ stage: 'Initializing…', percent: currentPercent });

  const crawlInterval = setInterval(() => {
    if (currentPercent < INIT_END - 0.5) {
      const remaining = INIT_END - currentPercent;
      currentPercent += remaining * 0.01;
      emitEnsureYtDlpProgress({
        stage: 'Initializing…',
        percent: currentPercent,
      });
    }
  }, 500);

  const stopCrawl = () => clearInterval(crawlInterval);

  try {
    // Check if we should skip update based on time
    const now = Date.now();
    const shouldCheckUpdate =
      !skipUpdate && now - lastUpdateCheckTime > UPDATE_CHECK_INTERVAL_MS;
    const cachedBinary = await getCachedHealthyBinary(shouldCheckUpdate);
    if (cachedBinary) {
      stopCrawl();
      log.info(
        `[URLprocessor] Reusing cached healthy yt-dlp binary: ${cachedBinary}`
      );
      return cachedBinary;
    }

    // For packaged apps, always use the writable binary approach
    if (app.isPackaged) {
      const writablePath = await ensureWritableBinary();

      // Test if it's working
      if (await testBinary(writablePath)) {
        // Binary works - now try to update it (unless recently checked)
        if (shouldCheckUpdate) {
          log.info(
            '[URLprocessor] Attempting to update yt-dlp to latest version...'
          );
          const updateSuccess = await updateExistingBinary(writablePath);
          lastUpdateCheckTime = now;
          if (!updateSuccess) {
            log.warn(
              '[URLprocessor] Update failed, but existing binary works, continuing...'
            );
          }
          // Re-evaluate in case the updater staged a newer side-by-side binary.
          stopCrawl();
          const refreshedBinary = await ensureWritableBinary();
          if (!(await testBinary(refreshedBinary))) {
            clearHealthyBinaryCache();
            const installed = await installNewBinary(emitEnsureYtDlpProgress);
            rememberHealthyBinary(installed);
            return installed;
          }
          rememberHealthyBinary(refreshedBinary);
          return refreshedBinary;
        } else {
          log.info(
            '[URLprocessor] Skipping update check (checked recently or explicitly skipped)'
          );
        }
        stopCrawl();
        rememberHealthyBinary(writablePath);
        return writablePath;
      } else {
        log.warn(
          '[URLprocessor] Writable binary is not working, will reinstall...'
        );
        clearHealthyBinaryCache();
        stopCrawl();
        const installed = await installNewBinary(emitEnsureYtDlpProgress);
        rememberHealthyBinary(installed);
        return installed;
      }
    }

    // For dev environment, prefer a managed app-local binary over arbitrary PATH installs.
    const existingBinary = await findYtDlpBinary();
    const managedBinaryPath = getManagedBinaryPath();

    if (existingBinary) {
      log.info(
        `[URLprocessor] Found existing yt-dlp binary: ${existingBinary}`
      );

      // Test if it's working
      if (await testBinary(existingBinary)) {
        const supportsRequiredFlags =
          await supportsRequiredYtDlpFlags(existingBinary);
        if (supportsRequiredFlags === false) {
          log.warn(
            `[URLprocessor] Existing yt-dlp binary is incompatible with Translator requirements (missing --js-runtimes): ${existingBinary}`
          );
          stopCrawl();
          log.info(
            '[URLprocessor] Installing managed yt-dlp binary for development compatibility...'
          );
          clearHealthyBinaryCache();
          const installed = await installNewBinary(emitEnsureYtDlpProgress);
          rememberHealthyBinary(installed);
          return installed;
        }

        if (supportsRequiredFlags == null) {
          if (existingBinary === managedBinaryPath) {
            log.warn(
              `[URLprocessor] Could not verify required yt-dlp flags on managed binary; continuing with existing managed copy: ${existingBinary}`
            );
          } else {
            log.warn(
              `[URLprocessor] Could not verify required yt-dlp flags on non-managed binary; installing managed copy instead: ${existingBinary}`
            );
            stopCrawl();
            clearHealthyBinaryCache();
            const installed = await installNewBinary(emitEnsureYtDlpProgress);
            rememberHealthyBinary(installed);
            return installed;
          }
        }

        // Only self-update the app-managed copy. We should not mutate random PATH installs.
        if (shouldCheckUpdate && existingBinary === managedBinaryPath) {
          log.info(
            '[URLprocessor] Attempting to update yt-dlp to latest version...'
          );
          const updateSuccess = await updateExistingBinary(existingBinary);
          lastUpdateCheckTime = now;
          if (!updateSuccess) {
            log.warn(
              '[URLprocessor] Update failed, but existing binary works, continuing...'
            );
          }
        } else if (shouldCheckUpdate && existingBinary !== managedBinaryPath) {
          log.info(
            `[URLprocessor] Skipping self-update for non-managed yt-dlp binary: ${existingBinary}`
          );
          lastUpdateCheckTime = now;
        } else {
          log.info(
            '[URLprocessor] Skipping update check (checked recently or explicitly skipped)'
          );
        }
        stopCrawl();
        rememberHealthyBinary(existingBinary);
        return existingBinary;
      } else {
        log.warn(
          '[URLprocessor] Existing binary is not working, will reinstall...'
        );
        clearHealthyBinaryCache();
        stopCrawl();
      }
    }

    // If we get here, we need to install/reinstall
    log.info('[URLprocessor] Installing yt-dlp binary...');
    stopCrawl();
    const installed = await installNewBinary(emitEnsureYtDlpProgress);
    rememberHealthyBinary(installed);
    return installed;
  } catch (error: any) {
    stopCrawl();
    clearHealthyBinaryCache();
    log.error('[URLprocessor] Failed to ensure yt-dlp binary:', error);
    if (error instanceof YtDlpSetupError) {
      throw error;
    }
    throw new YtDlpSetupError(
      `Failed to ensure yt-dlp binary: ${error?.message ?? error}`
    );
  }
}

async function supportsRequiredYtDlpFlags(
  binaryPath: string
): Promise<boolean | null> {
  try {
    const { stdout } = await execa(binaryPath, ['--help'], {
      timeout: 20_000,
      windowsHide: true,
    });
    return stdout.includes('--js-runtimes');
  } catch (error: any) {
    log.warn(
      `[URLprocessor] Could not probe yt-dlp feature support for ${binaryPath}: ${error?.shortMessage || error?.message || error}`
    );
    return null;
  }
}

async function updateExistingBinary(binaryPath: string): Promise<boolean> {
  // Note: Progress is handled by the caller's crawl interval
  try {
    // On Windows, yt-dlp self-update is prone to failing when the executable is
    // locked. We instead stage a freshly downloaded binary side-by-side.
    if (process.platform === 'win32' && app.isPackaged) {
      return await updateExistingBinaryWindowsPackaged(binaryPath);
    }

    log.info(`[URLprocessor] Attempting to update binary: ${binaryPath}`);

    // Get version before update for comparison
    let versionBefore = '';
    try {
      const { stdout } = await execa(binaryPath, ['--version'], {
        timeout: 10000,
        windowsHide: true,
      });
      versionBefore = stdout.trim();
    } catch {
      // If we can't get version, proceed anyway
    }

    const result = await execa(binaryPath, ['-U', '--quiet'], {
      timeout: 120000,
      windowsHide: true, // Prevent console flash on Windows
    });

    const success =
      result.stdout.includes('up to date') ||
      result.stdout.includes('updated') ||
      result.stdout.includes('Successfully updated') ||
      result.exitCode === 0;

    if (success) {
      log.info('[URLprocessor] Binary update completed successfully');

      // Post-update sanity check: verify the binary was actually updated
      if (versionBefore) {
        try {
          const { stdout } = await execa(binaryPath, ['--version'], {
            timeout: 10000,
            windowsHide: true,
          });
          const versionAfter = stdout.trim();
          if (
            versionBefore === versionAfter &&
            !result.stdout.includes('up to date')
          ) {
            log.warn(
              '[URLprocessor] Update claimed success but version unchanged - binary may still be locked'
            );
            return false;
          }
          log.info(`[URLprocessor] Version after update: ${versionAfter}`);
        } catch {
          // If we can't get version after update, assume it worked
          log.warn('[URLprocessor] Could not verify version after update');
        }
      }

      // Log version after update
      await testBinary(binaryPath);
    } else {
      log.warn(
        '[URLprocessor] Update command completed but result unclear:',
        result.stdout
      );
    }
    return success;
  } catch (error: any) {
    log.error('[URLprocessor] Failed to update existing binary:', error);
    return false;
  }
}

async function updateExistingBinaryWindowsPackaged(
  existingPath: string
): Promise<boolean> {
  // Serialize update attempts across app instances.
  if (!(await acquireInstallLock())) {
    log.warn(
      '[URLprocessor] yt-dlp update already in progress by another process'
    );
    return false;
  }

  const exeExt = '.exe';
  const binDir = dirname(existingPath);
  const primaryPath = join(binDir, `yt-dlp${exeExt}`);
  const nextPath = join(binDir, `yt-dlp.next${exeExt}`);

  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp${exeExt}`;

  try {
    // If we can fetch the expected hash, avoid a full download when already up to date.
    const expectedHash = await fetchSha256ForRelease(downloadUrl);
    if (expectedHash) {
      const primaryHash = await calculateSHA256(primaryPath).catch(() => null);
      const nextHash = await calculateSHA256(nextPath).catch(() => null);
      if (primaryHash === expectedHash || nextHash === expectedHash) {
        log.info('[URLprocessor] yt-dlp already up to date (hash match)');
        return true;
      }
    }

    // Download to a temp file first; if something goes wrong we don't clobber an existing working binary.
    const tmpPath = join(
      binDir,
      `yt-dlp.download.${process.pid}.${Date.now()}${exeExt}`
    );
    try {
      await downloadBinaryDirectly(tmpPath);

      // Promote to the staged "next" path (do not overwrite the primary path since it may be locked).
      await fsp.unlink(nextPath).catch(() => {});
      await fsp.rename(tmpPath, nextPath);
      log.info(`[URLprocessor] Staged updated yt-dlp at: ${nextPath}`);
      return true;
    } catch (error: any) {
      await fsp.unlink(tmpPath).catch(() => {});
      log.error('[URLprocessor] Failed to stage updated yt-dlp:', error);
      return false;
    }
  } finally {
    await releaseInstallLock();
  }
}

async function installNewBinary(
  onProgress?: BinarySetupProgress
): Promise<string> {
  // Acquire installation lock
  if (!(await acquireInstallLock())) {
    log.warn('[URLprocessor] Another process is already installing yt-dlp; waiting...');
    const awaitedBinary = await waitForConcurrentInstall({
      targetBinaryPath: getPreferredInstallPath(),
      onProgress,
    });
    if (awaitedBinary && (await validateResolvedInstallBinary(awaitedBinary))) {
      rememberHealthyBinary(awaitedBinary);
      return awaitedBinary;
    }
    const message =
      'yt-dlp setup did not finish successfully in another Translator process. Please try again.';
    log.warn(`[URLprocessor] ${message}`);
    throw new YtDlpSetupError(message);
  }

  try {
    const targetBinaryPath = getPreferredInstallPath();
    const targetBinDir = dirname(targetBinaryPath);

    log.info(`[URLprocessor] Target binary path: ${targetBinaryPath}`);
    onProgress?.({ stage: 'Preparing yt-dlp install…' });

    // Ensure the directory exists
    try {
      await fsp.mkdir(targetBinDir, { recursive: true });
    } catch (error: any) {
      log.error(
        `[URLprocessor] Failed to create binary directory ${targetBinDir}:`,
        error
      );
      throw new Error(
        `Could not create yt-dlp directory. Check antivirus or run portable build. Error: ${error.message}`
      );
    }

    if (app.isPackaged) {
      // For packaged apps, download directly from GitHub
      log.info(
        '[URLprocessor] Packaged app detected, downloading yt-dlp directly from GitHub...'
      );
      try {
        return await downloadBinaryDirectly(targetBinaryPath, onProgress);
      } catch (error: any) {
        // Windows can lock the primary exe; fall back to a side-by-side staged binary.
        if (process.platform === 'win32') {
          const altPath = join(targetBinDir, 'yt-dlp.next.exe');
          log.warn(
            `[URLprocessor] Primary yt-dlp path may be locked; trying staged path: ${altPath}`
          );
          return await downloadBinaryDirectly(altPath, onProgress);
        }
        throw error;
      }
    } else {
      // For development, try postinstall script first
      onProgress?.({ stage: 'Installing yt-dlp…' });
      const postinstallResult = await tryPostinstallScript(targetBinaryPath);
      if (postinstallResult) {
        return postinstallResult;
      }

      // Fallback: direct download from GitHub
      log.info(
        '[URLprocessor] Postinstall script failed, trying direct download...'
      );
      return await downloadBinaryDirectly(targetBinaryPath, onProgress);
    }
  } catch (error: any) {
    log.error('[URLprocessor] Failed to install new binary:', error);
    if (error instanceof YtDlpSetupError) {
      throw error;
    }
    throw new YtDlpSetupError(
      `Failed to install yt-dlp binary: ${error?.message ?? error}`
    );
  } finally {
    await releaseInstallLock();
  }
}

async function tryPostinstallScript(
  targetBinaryPath: string
): Promise<string | null> {
  try {
    // Try to find the package root more reliably than process.cwd()
    const packageRoot = app.isPackaged
      ? dirname(app.getAppPath())
      : process.cwd();
    const expectedPostinstallTarget = join(
      packageRoot,
      'node_modules',
      'youtube-dl-exec',
      'bin',
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    );

    if (targetBinaryPath !== expectedPostinstallTarget) {
      log.info(
        `[URLprocessor] Skipping youtube-dl-exec postinstall for managed target outside package root: ${targetBinaryPath}`
      );
      return null;
    }

    const postinstallScript = join(
      packageRoot,
      'node_modules',
      'youtube-dl-exec',
      'scripts',
      'postinstall.js'
    );

    if (
      !(await fsp
        .access(postinstallScript)
        .then(() => true)
        .catch(() => false))
    ) {
      log.info('[URLprocessor] Postinstall script not found');
      return null;
    }

    log.info('[URLprocessor] Running youtube-dl-exec postinstall script...');

    // Run the postinstall script
    const result = await execa('node', [postinstallScript], {
      cwd: join(packageRoot, 'node_modules', 'youtube-dl-exec'),
      timeout: 120000,
      windowsHide: true,
    });

    log.info('[URLprocessor] Postinstall script completed:', result.stdout);

    // Verify the binary was downloaded
    if (
      await fsp
        .access(targetBinaryPath)
        .then(() => true)
        .catch(() => false)
    ) {
      // Make it executable using shared helper
      await ensureExecutable(targetBinaryPath);

      log.info(
        `[URLprocessor] Successfully installed yt-dlp binary via postinstall: ${targetBinaryPath}`
      );
      return targetBinaryPath;
    } else {
      log.error(
        '[URLprocessor] Binary not found after postinstall script execution'
      );
      return null;
    }
  } catch (error: any) {
    log.error('[URLprocessor] Postinstall script failed:', error);
    return null;
  }
}

async function downloadBinaryDirectly(
  targetPath: string,
  onProgress?: BinarySetupProgress
): Promise<string> {
  log.info('[URLprocessor] Attempting direct download from GitHub...');

  const assetName =
    process.platform === 'win32'
      ? 'yt-dlp.exe'
      : process.platform === 'darwin'
        ? 'yt-dlp_macos'
        : 'yt-dlp';
  const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

  log.info(`[URLprocessor] Downloading from: ${downloadUrl}`);
  onProgress?.({ stage: 'Downloading yt-dlp…', percent: 0 });

  const targetDir = dirname(targetPath);
  await fsp.mkdir(targetDir, { recursive: true });

  try {
    const response = await fetchWithRedirect(downloadUrl);

    // Track download progress
    const contentLength = parseInt(
      response.headers['content-length'] || '0',
      10
    );
    let downloaded = 0;
    let lastReportedPercent = 0;

    const fileStream = createWriteStream(targetPath);

    // Download with progress tracking
    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100);
          // Only report every 5% to avoid spamming
          if (percent >= lastReportedPercent + 5 || percent === 100) {
            lastReportedPercent = percent;
            onProgress?.({ stage: 'Downloading yt-dlp…', percent });
          }
        }
      });
      response.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', resolve);
      response.pipe(fileStream);
    });

    onProgress?.({ stage: 'Verifying yt-dlp…' });

    if (!(await verifyBinaryIntegrity(targetPath))) {
      log.error('[URLprocessor] Downloaded binary failed integrity check');
      await fsp.unlink(targetPath).catch(() => {});
      throw new YtDlpSetupError(
        'Downloaded yt-dlp failed integrity check. Please try again or check your network/antivirus settings.',
        { attemptedUrl: downloadUrl }
      );
    }

    const actualHash = await calculateSHA256(targetPath);
    log.info(`[URLprocessor] Downloaded binary SHA-256: ${actualHash}`);

    const expectedHash = await fetchSha256ForRelease(downloadUrl);
    if (expectedHash && actualHash !== expectedHash) {
      log.error(
        `[URLprocessor] SHA-256 verification failed! Expected: ${expectedHash}, Got: ${actualHash}`
      );
      await fsp.unlink(targetPath).catch(() => {});
      throw new YtDlpSetupError(
        `SHA-256 verification failed for yt-dlp (expected ${expectedHash}, got ${actualHash}).`,
        { attemptedUrl: downloadUrl }
      );
    } else if (expectedHash) {
      log.info('[URLprocessor] SHA-256 verification passed');
    } else {
      log.warn(
        '[URLprocessor] Could not verify SHA-256 (hash file unavailable), but file size looks correct'
      );
    }

    await ensureExecutable(targetPath);

    const stats = await fsp.stat(targetPath);
    log.info(
      `[URLprocessor] Successfully downloaded yt-dlp to: ${targetPath} (${stats.size} bytes)`
    );
    return targetPath;
  } catch (error: any) {
    await fsp.unlink(targetPath).catch(() => {});
    const message = error?.message ?? String(error);
    log.error('[URLprocessor] Failed to download binary directly:', message);

    if (message.includes('No network connection')) {
      log.error('[URLprocessor] Network error - check internet connection');
    } else if (message.includes('timeout')) {
      log.error(
        '[URLprocessor] Download timeout - GitHub may be slow or unreachable'
      );
    } else if (message.includes('SHA-256 verification')) {
      log.error(
        '[URLprocessor] Security error - downloaded file may be corrupted or tampered with'
      );
    }

    if (error instanceof YtDlpSetupError) {
      throw error;
    }

    throw new YtDlpSetupError(
      `Failed to download yt-dlp from ${downloadUrl}: ${message}`,
      { attemptedUrl: downloadUrl, cause: error }
    );
  }
}

// Legacy function for backward compatibility - now just calls ensureYtDlpBinary
export async function installYtDlpBinary(): Promise<string> {
  return ensureYtDlpBinary();
}

/**
 * JS Runtime installer for yt-dlp.
 * yt-dlp requires a JavaScript runtime (node, deno, bun, or quickjs) for YouTube signature decryption.
 * This function checks for existing runtimes. If none are found, we fall back to
 * using the Electron executable as a Node.js runtime via ELECTRON_RUN_AS_NODE=1.
 * See: https://github.com/yt-dlp/yt-dlp/wiki/EJS
 */

let cachedJsRuntime: string | null | undefined = undefined; // undefined = not checked yet
let jsRuntimePromise: Promise<string | null> | null = null; // in-flight promise to prevent concurrent installs

function scrubEnvForNodeProbe(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Keep this in sync with the env-scrubbing used when spawning yt-dlp so we
  // don't mis-detect the embedded runtime due to user-set NODE_OPTIONS.
  const cleaned: NodeJS.ProcessEnv = { ...env };
  for (const key of [
    'NODE_OPTIONS',
    'NPM_CONFIG_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete cleaned[key];
  }
  return cleaned;
}

async function findExistingJsRuntime(): Promise<string | null> {
  const runtimes = [
    { name: 'node', cmd: 'node' },
    { name: 'deno', cmd: 'deno' },
    { name: 'bun', cmd: 'bun' },
  ];

  for (const { name, cmd } of runtimes) {
    try {
      const env = scrubEnvForNodeProbe(process.env);
      if (process.platform === 'win32') {
        // On Windows, use 'where' command
        const { stdout } = await execa('where', [cmd], {
          timeout: 5000,
          windowsHide: true,
        });
        const path = stdout.trim().split('\n')[0]?.trim();
        if (path) {
          // Verify it works
          await execa(path, ['--version'], {
            timeout: 5000,
            windowsHide: true,
            env,
          });
          log.info(`[URLprocessor] Found JS runtime: ${name} at ${path}`);
          return `${name}:${path}`;
        }
      } else {
        // On Unix, use 'which' command
        const { stdout } = await execa('which', [cmd], {
          timeout: 5000,
          windowsHide: true,
        });
        const path = stdout.trim();
        if (path) {
          // Verify it works
          await execa(path, ['--version'], {
            timeout: 5000,
            windowsHide: true,
            env,
          });
          log.info(`[URLprocessor] Found JS runtime: ${name} at ${path}`);
          return `${name}:${path}`;
        }
      }
    } catch {
      // Runtime not found or doesn't work, continue
    }
  }

  // Check common paths for Node.js (packaged apps have minimal PATH)
  const homedir = process.env.HOME || '';
  const commonPaths =
    process.platform === 'win32'
      ? [
          join(
            process.env.ProgramFiles || 'C:\\Program Files',
            'nodejs',
            'node.exe'
          ),
          join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
        ]
      : [
          // macOS/Linux common paths
          '/usr/local/bin/node', // Homebrew Intel, official installer
          '/opt/homebrew/bin/node', // Homebrew Apple Silicon
          join(homedir, '.nvm/current/bin/node'), // nvm
          join(homedir, '.volta/bin/node'), // Volta
          '/usr/bin/node', // System node
        ];

  for (const nodePath of commonPaths) {
    try {
      await fsp.access(nodePath, fs.constants.X_OK);
      await execa(nodePath, ['--version'], {
        timeout: 5000,
        windowsHide: true,
        env: scrubEnvForNodeProbe(process.env),
      });
      log.info(`[URLprocessor] Found Node.js at: ${nodePath}`);
      return `node:${nodePath}`;
    } catch {
      // Not found
    }
  }

  return null;
}

async function findEmbeddedNodeRuntime(): Promise<string | null> {
  const execPath = process.execPath;
  if (!execPath) {
    return null;
  }

  // In Electron, the app/electron executable can behave like Node when this is set.
  const env: NodeJS.ProcessEnv = scrubEnvForNodeProbe(process.env);
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  try {
    await fsp.access(execPath, fs.constants.X_OK);
    const verifyTimeout = process.platform === 'win32' ? 60_000 : 30_000;
    await execa(execPath, ['--version'], {
      timeout: verifyTimeout,
      windowsHide: true,
      env,
    });
    log.info(`[URLprocessor] Using embedded Node.js runtime at: ${execPath}`);
    return `node:${execPath}`;
  } catch (error: any) {
    // If a security scan stalls the first run, prefer working downloads over strict validation.
    if (error?.timedOut) {
      log.warn(
        `[URLprocessor] Embedded Node.js runtime check timed out (security scan?), assuming OK: ${execPath}`
      );
      return `node:${execPath}`;
    }
    log.warn(
      `[URLprocessor] Embedded Node.js runtime check failed: ${error?.message || String(error)}`
    );
    return null;
  }
}

/**
 * Ensures a JavaScript runtime is available for yt-dlp.
 * First checks for existing runtimes (node, deno, bun). If none are found,
 * fall back to the Electron executable as a Node.js runtime.
 * Returns the runtime string in yt-dlp format: "runtime:path" or null if unavailable.
 * Uses in-flight promise pattern to prevent concurrent downloads racing.
 */
export async function ensureJsRuntime({
  onProgress,
}: {
  onProgress?: BinarySetupProgress;
} = {}): Promise<string | null> {
  // Return cached result if available
  if (cachedJsRuntime !== undefined) {
    return cachedJsRuntime;
  }

  // If another call is already in flight, wait for it instead of racing
  if (jsRuntimePromise) {
    log.info('[URLprocessor] JS runtime check already in progress, waiting...');
    return jsRuntimePromise;
  }

  // Start the actual work and store the promise so concurrent calls can wait
  jsRuntimePromise = doEnsureJsRuntime(onProgress);

  try {
    return await jsRuntimePromise;
  } finally {
    jsRuntimePromise = null;
  }
}

async function doEnsureJsRuntime(
  onProgress?: BinarySetupProgress
): Promise<string | null> {
  log.info('[URLprocessor] Checking for JavaScript runtime...');
  onProgress?.({ stage: 'Checking JS runtime…' });

  // First, check for existing runtimes
  const existingRuntime = await findExistingJsRuntime();
  if (existingRuntime) {
    cachedJsRuntime = existingRuntime;
    return existingRuntime;
  }

  // Fall back to embedded Node.js (Electron can run as Node via ELECTRON_RUN_AS_NODE).
  const embeddedNode = await findEmbeddedNodeRuntime();
  if (embeddedNode) {
    cachedJsRuntime = embeddedNode;
    return embeddedNode;
  }

  log.warn('[URLprocessor] No JavaScript runtime available');
  // Do not cache null - user may install Node/Deno/Bun while the app is running.
  cachedJsRuntime = undefined;
  return null;
}

async function verifyBinaryIntegrity(binaryPath: string): Promise<boolean> {
  try {
    // Ensure executable bit is set before attempting to run the binary on POSIX systems
    await ensureExecutable(binaryPath);

    const stats = await fsp.stat(binaryPath);

    // Platform-specific minimum size check
    const minBytes =
      process.platform === 'win32' ? 10 * 1024 * 1024 : 2 * 1024 * 1024; // 10MB for Windows, 2MB for POSIX

    if (stats.size < minBytes) {
      log.warn(
        `[URLprocessor] Binary too small: ${stats.size} bytes (minimum: ${minBytes})`
      );
      return false;
    }

    // Verify the binary can be executed
    return await testBinary(binaryPath);
  } catch (error: any) {
    log.error('[URLprocessor] Failed to verify binary integrity:', error);
    return false;
  }
}
