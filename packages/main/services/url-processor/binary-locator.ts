import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import which from 'which';
import { esmDirname } from '@shared/esm-paths';
import { CancelledError } from '../../../shared/cancelled-error.js';
import { raceOperationCancellation } from '../../utils/operation-cancellation.js';
import { terminateProcess } from '../../utils/process-killer.js';

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

function getManagedBinaryPath(): string {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  return join(app.getPath('userData'), 'bin', `yt-dlp${exeExt}`);
}

function getDevRootCandidates(): string[] {
  const roots = new Set<string>();
  const moduleRoot = join(esmDirname(import.meta.url), '..', '..', '..', '..');
  roots.add(moduleRoot);

  try {
    const appPath = app.getAppPath();
    if (appPath) roots.add(appPath);
  } catch {
    // ignore
  }

  if (process.cwd()) {
    roots.add(process.cwd());
  }

  return [...roots];
}

// Shared helper: Get all possible binary paths in search order
function getBinarySearchPaths(): string[] {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const isPackaged = app.isPackaged;

  const paths: string[] = [];

  // 1. app-managed writable copy
  paths.push(getManagedBinaryPath());

  // 2. packaged app paths
  if (isPackaged) {
    paths.push(
      join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        binaryName
      ),
      join(
        app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
        'node_modules',
        'youtube-dl-exec',
        'bin',
        binaryName
      )
    );
  }

  // 3. dev environment bin candidates
  if (!isPackaged) {
    for (const root of getDevRootCandidates()) {
      paths.push(
        join(root, 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
        join(root, 'node_modules', '.bin', binaryName)
      );
    }
  }

  // 4. Relative path from module (legacy fallback for development)
  paths.push(
    join(
      esmDirname(import.meta.url),
      '..',
      '..',
      'node_modules',
      'youtube-dl-exec',
      'bin',
      binaryName
    )
  );

  return paths;
}

// Main locator function
export async function findYtDlpBinary(): Promise<string | null> {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;

  try {
    // Check filesystem paths
    const searchPaths = getBinarySearchPaths();
    for (const path of searchPaths) {
      if (
        await fsp
          .access(path)
          .then(() => true)
          .catch(() => false)
      ) {
        log.info(`[URLprocessor] Found yt-dlp at: ${path}`);
        await ensureExecutable(path);
        return path;
      }
    }

    // Check system PATH
    const pathBinary = await which(binaryName).catch(() => null);
    if (
      pathBinary &&
      (await fsp
        .access(pathBinary)
        .then(() => true)
        .catch(() => false))
    ) {
      log.info(`[URLprocessor] Found yt-dlp in PATH: ${pathBinary}`);
      return pathBinary;
    }

    log.error(
      '[URLprocessor] yt-dlp binary could not be located in any expected location.'
    );
    return null;
  } catch (error) {
    log.error(
      '[URLprocessor] Unexpected error during yt-dlp binary search:',
      error
    );
    return null;
  }
}

// Test if binary is working
async function runBinaryVersionCheck(
  binaryPath: string,
  timeout: number,
  signal?: AbortSignal
): Promise<string> {
  const proc = execa(binaryPath, ['--version'], {
    timeout,
    windowsHide: true,
  });

  const { stdout } = await raceOperationCancellation(proc, {
    signal,
    context: `while testing yt-dlp binary ${binaryPath}`,
    log,
    onCancel: () =>
      terminateProcess({
        childProcess: proc,
        logPrefix: 'yt-dlp-binary-test',
      }),
  });

  return stdout;
}

export async function testBinary(
  binaryPath: string,
  signal?: AbortSignal
): Promise<boolean> {
  const baseTimeoutMs = 10_000;
  const extendedTimeoutMs = app.isPackaged ? 120_000 : 30_000;
  const timeouts =
    extendedTimeoutMs > baseTimeoutMs
      ? [baseTimeoutMs, extendedTimeoutMs]
      : [baseTimeoutMs];

  for (const timeout of timeouts) {
    try {
      const stdout = await runBinaryVersionCheck(binaryPath, timeout, signal);
      log.info(`[URLprocessor] yt-dlp version detected: ${stdout.trim()}`);
      return true;
    } catch (error: any) {
      if (error instanceof CancelledError) {
        throw error;
      }
      if (error?.timedOut && timeout < extendedTimeoutMs) {
        log.warn(
          `[URLprocessor] yt-dlp --version timed out after ${timeout}ms, retrying with extended timeout...`
        );
        continue;
      }
      const message = error?.shortMessage || error?.message || String(error);
      log.warn(`[URLprocessor] yt-dlp --version failed: ${message}`);
      return false;
    }
  }

  return false;
}

// Get preferred installation path
export function getPreferredInstallPath(): string {
  return getManagedBinaryPath();
}

// Export shared helpers
export { ensureExecutable, getBinarySearchPaths, getManagedBinaryPath };
