import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { execa } from 'execa';
import log from 'electron-log';

interface HeadlessChromePaths {
  headlessDir: string;
  chromeDir: string;
  executablePath: string;
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

  const chromeDir = path.join(headlessDir, 'chrome-headless-shell');
  const lockFile = path.join(headlessDir, '.install-lock');

  // Determine executable path based on platform
  let executablePath: string;
  if (process.platform === 'win32') {
    executablePath = path.join(headlessDir, 'headless_shell.exe');
  } else {
    executablePath = path.join(headlessDir, 'headless_shell');
  }

  return { headlessDir, chromeDir, executablePath, lockFile };
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
 * Find the actual executable in the nested directory structure
 */
async function findExecutableInNestedStructure(
  chromeDir: string
): Promise<string | null> {
  try {
    const versionDirs = await fs.readdir(chromeDir);

    // Platform-specific directory patterns
    let versionDirPattern: string;
    let binaryDirPattern: string;
    let executableName: string;

    if (process.platform === 'win32') {
      versionDirPattern = process.arch === 'arm64' ? 'win-arm64-' : 'win64-';
      binaryDirPattern = 'chrome-headless-shell-win';
      executableName = 'chrome-headless-shell.exe';
    } else {
      // macOS
      versionDirPattern = process.arch === 'arm64' ? 'mac_arm-' : 'mac-';
      binaryDirPattern = 'chrome-headless-shell-mac-';
      executableName = 'chrome-headless-shell';
    }

    const versionDir = versionDirs.find(dir =>
      dir.startsWith(versionDirPattern)
    );
    if (!versionDir) return null;

    const platformDir = path.join(chromeDir, versionDir);
    const platformDirs = await fs.readdir(platformDir);
    const binaryDir = platformDirs.find(dir =>
      dir.startsWith(binaryDirPattern)
    );
    if (!binaryDir) return null;

    const executablePath = path.join(platformDir, binaryDir, executableName);

    // Verify the executable exists
    if (await isHeadlessChromeBinaryValid(executablePath)) {
      return executablePath;
    }

    return null;
  } catch (error) {
    log.warn(
      `[HeadlessChrome] Error finding executable in nested structure: ${error}`
    );
    return null;
  }
}

/**
 * Acquire installation lock to prevent concurrent installations
 */
async function acquireInstallLock(lockFile: string): Promise<boolean> {
  try {
    const lockDir = path.dirname(lockFile);
    await fs.mkdir(lockDir, { recursive: true });

    // Check if lock file exists and contains a valid PID
    try {
      const lockContent = await fs.readFile(lockFile, 'utf-8');
      const pid = parseInt(lockContent.trim(), 10);

      if (!isNaN(pid)) {
        // Check if process is still running
        try {
          process.kill(pid, 0); // Signal 0 checks if process exists
          log.info(
            `[HeadlessChrome] Installation already in progress (PID: ${pid})`
          );
          return false;
        } catch (error: any) {
          if (error.code === 'ESRCH') {
            // Process not found, remove stale lock
            log.info(
              `[HeadlessChrome] Removing stale lock file (PID ${pid} not found)`
            );
            await fs.unlink(lockFile);
          } else if (error.code === 'EPERM') {
            // Process exists but we can't signal it (Windows)
            log.info(
              `[HeadlessChrome] Installation already in progress (PID: ${pid})`
            );
            return false;
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        log.warn(`[HeadlessChrome] Error reading lock file: ${error}`);
      }
    }

    // Create lock file with current PID
    await fs.writeFile(lockFile, process.pid.toString());
    return true;
  } catch (error) {
    log.error(`[HeadlessChrome] Failed to acquire installation lock: ${error}`);
    return false;
  }
}

/**
 * Release installation lock
 */
async function releaseInstallLock(lockFile: string): Promise<void> {
  try {
    await fs.unlink(lockFile);
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      log.warn(
        `[HeadlessChrome] Failed to release installation lock: ${error}`
      );
    }
  }
}

/**
 * Download and install headless Chrome using @puppeteer/browsers
 */
async function downloadHeadlessChrome(headlessDir: string): Promise<void> {
  log.info(
    `[HeadlessChrome] Downloading chrome-headless-shell@stable to ${headlessDir}`
  );

  try {
    // Ensure directory exists
    await fs.mkdir(headlessDir, { recursive: true });

    // Use @puppeteer/browsers to download
    const result = await execa(
      'npx',
      [
        '@puppeteer/browsers',
        'install',
        'chrome-headless-shell@stable',
        '--path',
        headlessDir,
      ],
      {
        timeout: 300000, // 5 minutes timeout
        env: { ...process.env },
        windowsHide: true,
      }
    );

    log.info(`[HeadlessChrome] Download completed: ${result.stdout}`);

    // Verify the nested executable exists and is accessible
    const chromeDir = path.join(headlessDir, 'chrome-headless-shell');
    const nestedExecutable = await findExecutableInNestedStructure(chromeDir);

    if (nestedExecutable) {
      log.info(
        `[HeadlessChrome] Verified nested executable at: ${nestedExecutable}`
      );
      // Don't copy the executable - use it in place so it has access to supporting files
    } else {
      log.warn(
        `[HeadlessChrome] Could not find executable in nested structure`
      );
    }
  } catch (error) {
    log.error(`[HeadlessChrome] Download failed: ${error}`);
    throw error;
  }
}

/**
 * Ensure headless Chrome binary is available, downloading if necessary
 */
export async function ensureHeadlessChrome(): Promise<string> {
  const { headlessDir, chromeDir, executablePath, lockFile } =
    getHeadlessChromePaths();

  // First check if nested structure executable exists (preferred)
  const nestedExecutable = await findExecutableInNestedStructure(chromeDir);
  if (nestedExecutable) {
    log.info(`[HeadlessChrome] Using nested binary: ${nestedExecutable}`);
    return nestedExecutable;
  }

  // Fallback to simple executable (for backward compatibility)
  if (await isHeadlessChromeBinaryValid(executablePath)) {
    log.info(`[HeadlessChrome] Using fallback binary: ${executablePath}`);
    return executablePath;
  }

  // Binary not found, need to download
  log.info(`[HeadlessChrome] Binary not found, downloading...`);

  // Acquire lock to prevent concurrent downloads
  if (!(await acquireInstallLock(lockFile))) {
    // Another process is installing, wait and retry
    log.info(
      `[HeadlessChrome] Waiting for concurrent installation to complete...`
    );

    // Wait up to 5 minutes for installation to complete
    const maxWaitTime = 300000; // 5 minutes
    const checkInterval = 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));

      // Check if binary is now available
      if (await isHeadlessChromeBinaryValid(executablePath)) {
        return executablePath;
      }

      const nestedCheck = await findExecutableInNestedStructure(chromeDir);
      if (nestedCheck) {
        return nestedCheck;
      }
    }

    throw new Error(
      'Headless Chrome installation timeout - concurrent installation did not complete'
    );
  }

  try {
    // Download headless Chrome
    await downloadHeadlessChrome(headlessDir);

    // Verify installation - check nested structure first
    const finalNestedCheck = await findExecutableInNestedStructure(chromeDir);
    if (finalNestedCheck) {
      log.info(
        `[HeadlessChrome] Installation successful (nested): ${finalNestedCheck}`
      );
      return finalNestedCheck;
    }

    // Fallback verification
    if (await isHeadlessChromeBinaryValid(executablePath)) {
      log.info(
        `[HeadlessChrome] Installation successful (fallback): ${executablePath}`
      );
      return executablePath;
    }

    throw new Error(
      'Headless Chrome installation completed but binary not found'
    );
  } finally {
    await releaseInstallLock(lockFile);
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

  // First try bundled binary in resources
  const bundledPath = (() => {
    const headlessDir = path.join(
      process.resourcesPath,
      process.arch === 'arm64' ? 'headless-arm64' : 'headless-x64'
    );

    try {
      // Try nested structure first
      const chromeDir = path.join(headlessDir, 'chrome-headless-shell');
      if (fsSync.existsSync(chromeDir)) {
        // Use synchronous version for compatibility with existing code
        const versionDirs = fsSync.readdirSync(chromeDir);

        let versionDirPattern: string;
        let binaryDirPattern: string;
        let executableName: string;

        if (process.platform === 'win32') {
          versionDirPattern =
            process.arch === 'arm64' ? 'win-arm64-' : 'win64-';
          binaryDirPattern = 'chrome-headless-shell-win';
          executableName = 'chrome-headless-shell.exe';
        } else {
          versionDirPattern = process.arch === 'arm64' ? 'mac_arm-' : 'mac-';
          binaryDirPattern = 'chrome-headless-shell-mac-';
          executableName = 'chrome-headless-shell';
        }

        const versionDir = versionDirs.find((dir: string) =>
          dir.startsWith(versionDirPattern)
        );
        if (versionDir) {
          const platformDir = path.join(chromeDir, versionDir);
          const platformDirs = fsSync.readdirSync(platformDir);
          const binaryDir = platformDirs.find((dir: string) =>
            dir.startsWith(binaryDirPattern)
          );
          if (binaryDir) {
            const execPath = path.join(platformDir, binaryDir, executableName);
            if (fsSync.existsSync(execPath)) {
              return execPath;
            }
          }
        }
      }
    } catch (error) {
      log.warn(
        `[HeadlessChrome] Error checking bundled nested structure: ${error}`
      );
    }

    // Fallback to simple structure
    const fallbackExecutable =
      process.platform === 'win32' ? 'headless_shell.exe' : 'headless_shell';
    const fallbackPath = path.join(headlessDir, fallbackExecutable);
    if (fsSync.existsSync(fallbackPath)) {
      return fallbackPath;
    }

    return null;
  })();

  if (bundledPath) {
    log.info(`[HeadlessChrome] Using bundled binary: ${bundledPath}`);
    return bundledPath;
  }

  // Bundled binary not found, use auto-download
  log.info(`[HeadlessChrome] Bundled binary not found, using auto-download`);
  return await ensureHeadlessChrome();
}
