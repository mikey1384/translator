import { join, dirname } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import https from 'node:https';
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  findYtDlpBinary,
  testBinary,
  getPreferredInstallPath,
} from './binary-locator.js';

// Cache for update check - only check once per hour
let lastUpdateCheckTime = 0;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

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

// Concurrent installation protection using file-based mutex

// Create a mutex file to prevent concurrent installations
async function acquireInstallLock(): Promise<boolean> {
  const lockDir = join(app.getPath('userData'), 'bin');
  await fsp.mkdir(lockDir, { recursive: true });
  const lockFile = join(lockDir, '.install-lock');

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
  const lockFile = join(app.getPath('userData'), 'bin', '.install-lock');
  await fsp.unlink(lockFile).catch(() => {});
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

  // 1. If we already have a user copy, return it.
  try {
    await fsp.access(userBin, fs.constants.X_OK);
    log.info(`[URLprocessor] Using existing writable binary: ${userBin}`);
    return userBin;
  } catch {
    /* fall through and create it */
  }

  // 2. Acquire lock to prevent race conditions
  if (!(await acquireInstallLock())) {
    log.warn(
      '[URLprocessor] Binary copy already in progress by another process'
    );
    // Wait a bit and check if the binary now exists
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      await fsp.access(userBin, fs.constants.X_OK);
      return userBin;
    } catch {
      throw new Error(
        'Failed to create writable binary copy due to concurrent access'
      );
    }
  }

  try {
    log.info(`[URLprocessor] Creating writable binary copy at: ${userBin}`);

    // 3. Create the folder if needed.
    await fsp.mkdir(dirname(userBin), { recursive: true });

    // 4. Copy the bundled binary once (read-only → writable).
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
        return downloaded;
      }
      throw new YtDlpSetupError(
        `Could not create writable yt-dlp copy: ${error?.message ?? error}`
      );
    }

    // 5. Mark it executable (macOS / Linux).
    if (process.platform !== 'win32') {
      await fsp.chmod(userBin, 0o755);
    }

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
  // Start crawling progress immediately so users see movement during slow operations
  const INIT_END = 99; // Crawl toward 99%, which maps to ~4.9% overall (never reaches 5%)
  let currentPercent = 0;
  onProgress?.({ stage: 'Initializing…', percent: currentPercent });

  const crawlInterval = setInterval(() => {
    if (currentPercent < INIT_END - 0.5) {
      const remaining = INIT_END - currentPercent;
      currentPercent += remaining * 0.01;
      onProgress?.({ stage: 'Initializing…', percent: currentPercent });
    }
  }, 500);

  const stopCrawl = () => clearInterval(crawlInterval);

  try {
    // Check if we should skip update based on time
    const now = Date.now();
    const shouldCheckUpdate =
      !skipUpdate && now - lastUpdateCheckTime > UPDATE_CHECK_INTERVAL_MS;

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
        } else {
          log.info(
            '[URLprocessor] Skipping update check (checked recently or explicitly skipped)'
          );
        }
        stopCrawl();
        return writablePath;
      } else {
        log.warn(
          '[URLprocessor] Writable binary is not working, will reinstall...'
        );
        stopCrawl();
        return await installNewBinary(onProgress);
      }
    }

    // For dev environment, use existing logic
    const existingBinary = await findYtDlpBinary();

    if (existingBinary) {
      log.info(
        `[URLprocessor] Found existing yt-dlp binary: ${existingBinary}`
      );

      // Test if it's working
      if (await testBinary(existingBinary)) {
        // Binary works - now try to update it (unless recently checked)
        if (shouldCheckUpdate) {
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
        } else {
          log.info(
            '[URLprocessor] Skipping update check (checked recently or explicitly skipped)'
          );
        }
        stopCrawl();
        return existingBinary;
      } else {
        log.warn(
          '[URLprocessor] Existing binary is not working, will reinstall...'
        );
        stopCrawl();
      }
    }

    // If we get here, we need to install/reinstall
    log.info('[URLprocessor] Installing yt-dlp binary...');
    stopCrawl();
    return await installNewBinary(onProgress);
  } catch (error: any) {
    stopCrawl();
    log.error('[URLprocessor] Failed to ensure yt-dlp binary:', error);
    if (error instanceof YtDlpSetupError) {
      throw error;
    }
    throw new YtDlpSetupError(
      `Failed to ensure yt-dlp binary: ${error?.message ?? error}`
    );
  }
}

async function updateExistingBinary(
  binaryPath: string
): Promise<boolean> {
  // Note: Progress is handled by the caller's crawl interval
  try {
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

async function installNewBinary(
  onProgress?: BinarySetupProgress
): Promise<string> {
  // Acquire installation lock
  if (!(await acquireInstallLock())) {
    const message =
      'Another Translator instance is already downloading yt-dlp. Please wait and try again.';
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
      return await downloadBinaryDirectly(targetBinaryPath, onProgress);
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
 * This function checks for existing runtimes and installs QuickJS if none are found.
 * See: https://github.com/yt-dlp/yt-dlp/wiki/EJS
 */

let cachedJsRuntime: string | null | undefined = undefined; // undefined = not checked yet
let jsRuntimePromise: Promise<string | null> | null = null; // in-flight promise to prevent concurrent installs

async function findExistingJsRuntime(): Promise<string | null> {
  const runtimes = [
    { name: 'node', cmd: 'node' },
    { name: 'deno', cmd: 'deno' },
    { name: 'bun', cmd: 'bun' },
  ];

  for (const { name, cmd } of runtimes) {
    try {
      if (process.platform === 'win32') {
        // On Windows, use 'where' command
        const { stdout } = await execa('where', [cmd], {
          timeout: 5000,
          windowsHide: true,
        });
        const path = stdout.trim().split('\n')[0]?.trim();
        if (path) {
          // Verify it works
          await execa(path, ['--version'], { timeout: 5000, windowsHide: true });
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
          await execa(path, ['--version'], { timeout: 5000, windowsHide: true });
          log.info(`[URLprocessor] Found JS runtime: ${name} at ${path}`);
          return `${name}:${path}`;
        }
      }
    } catch {
      // Runtime not found or doesn't work, continue
    }
  }

  // Check common Windows paths for Node.js
  if (process.platform === 'win32') {
    const winPaths = [
      join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
    ];
    for (const nodePath of winPaths) {
      try {
        await fsp.access(nodePath, fs.constants.X_OK);
        await execa(nodePath, ['--version'], { timeout: 5000, windowsHide: true });
        log.info(`[URLprocessor] Found Node.js at: ${nodePath}`);
        return `node:${nodePath}`;
      } catch {
        // Not found
      }
    }
  }

  return null;
}

function getQuickJsDownloadUrl(): { url: string; filename: string } {
  const platform = process.platform;
  const arch = process.arch;

  // QuickJS-ng releases from https://github.com/aspect-build/aspect-js
  // These are standalone binaries that work well with yt-dlp
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      return {
        url: 'https://github.com/aspect-build/aspect-js/releases/latest/download/aspect-js-darwin-aarch64',
        filename: 'aspect-js',
      };
    }
    return {
      url: 'https://github.com/aspect-build/aspect-js/releases/latest/download/aspect-js-darwin-x86_64',
      filename: 'aspect-js',
    };
  }

  if (platform === 'linux') {
    if (arch === 'arm64') {
      return {
        url: 'https://github.com/aspect-build/aspect-js/releases/latest/download/aspect-js-linux-aarch64',
        filename: 'aspect-js',
      };
    }
    return {
      url: 'https://github.com/aspect-build/aspect-js/releases/latest/download/aspect-js-linux-x86_64',
      filename: 'aspect-js',
    };
  }

  if (platform === 'win32') {
    return {
      url: 'https://github.com/aspect-build/aspect-js/releases/latest/download/aspect-js-windows-x86_64.exe',
      filename: 'aspect-js.exe',
    };
  }

  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function downloadQuickJs(
  onProgress?: BinarySetupProgress
): Promise<string> {
  const { url, filename } = getQuickJsDownloadUrl();
  const targetDir = join(app.getPath('userData'), 'bin');
  const targetPath = join(targetDir, filename);

  log.info(`[URLprocessor] Downloading QuickJS from: ${url}`);
  onProgress?.({ stage: 'Downloading JS runtime…', percent: 0 });

  await fsp.mkdir(targetDir, { recursive: true });

  try {
    const response = await fetchWithRedirect(url);

    const contentLength = parseInt(
      response.headers['content-length'] || '0',
      10
    );
    let downloaded = 0;
    let lastReportedPercent = 0;

    const fileStream = createWriteStream(targetPath);

    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (contentLength > 0) {
          const percent = Math.round((downloaded / contentLength) * 100);
          if (percent >= lastReportedPercent + 10 || percent === 100) {
            lastReportedPercent = percent;
            onProgress?.({ stage: 'Downloading JS runtime…', percent });
          }
        }
      });
      response.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', resolve);
      response.pipe(fileStream);
    });

    // Make executable
    await ensureExecutable(targetPath);

    // Verify it works by running a trivial JS expression
    try {
      await execa(targetPath, ['-e', '1'], { timeout: 10000, windowsHide: true });
      log.info(`[URLprocessor] QuickJS installed and verified at: ${targetPath}`);
    } catch (error: any) {
      log.warn(`[URLprocessor] QuickJS execution check failed: ${error.message}`);
      // Delete the broken binary so next attempt will re-download
      await fsp.unlink(targetPath).catch(() => {});
      throw new Error(`QuickJS binary failed execution test: ${error.message}`);
    }

    const stats = await fsp.stat(targetPath);
    log.info(`[URLprocessor] QuickJS binary size: ${stats.size} bytes`);

    return targetPath;
  } catch (error: any) {
    await fsp.unlink(targetPath).catch(() => {});
    log.error('[URLprocessor] Failed to download QuickJS:', error);
    throw new Error(`Failed to download QuickJS: ${error.message}`);
  }
}

/**
 * Ensures a JavaScript runtime is available for yt-dlp.
 * First checks for existing runtimes (node, deno, bun), then installs QuickJS if needed.
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

  // Check if we already have QuickJS installed
  const quickJsFilename = process.platform === 'win32' ? 'aspect-js.exe' : 'aspect-js';
  const installedQuickJs = join(app.getPath('userData'), 'bin', quickJsFilename);

  try {
    await fsp.access(installedQuickJs, fs.constants.X_OK);
    // QuickJS doesn't support --version, use -e to run a trivial JS expression
    await execa(installedQuickJs, ['-e', '1'], { timeout: 5000, windowsHide: true });
    log.info(`[URLprocessor] Found installed QuickJS at: ${installedQuickJs}`);
    cachedJsRuntime = `quickjs:${installedQuickJs}`;
    return cachedJsRuntime;
  } catch {
    // Not installed or corrupt/incompatible - will trigger re-download
  }

  // No runtime found, install QuickJS
  log.info('[URLprocessor] No JS runtime found, installing QuickJS...');

  try {
    const quickJsPath = await downloadQuickJs(onProgress);
    cachedJsRuntime = `quickjs:${quickJsPath}`;
    log.info(`[URLprocessor] JS runtime ready: ${cachedJsRuntime}`);
    return cachedJsRuntime;
  } catch (error: any) {
    log.error('[URLprocessor] Failed to install QuickJS:', error);
    // Cache null so we don't keep retrying
    cachedJsRuntime = null;
    return null;
  }
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
