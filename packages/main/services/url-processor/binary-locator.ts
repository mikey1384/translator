import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import which from 'which';
import { esmDirname } from '@shared/esm-paths';

// Shared helper: Make file executable on Unix systems
async function ensureExecutable(binaryPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await fsp.access(binaryPath, fs.constants.X_OK);
    } catch {
      try {
        await execa('chmod', ['+x', binaryPath]);
        log.info(`[URLprocessor] Made ${binaryPath} executable.`);
      } catch (e) {
        log.warn(`[URLprocessor] Failed to chmod +x ${binaryPath}:`, e);
      }
    }
  }
}

// Shared helper: Get all possible binary paths in search order
function getBinarySearchPaths(): string[] {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const isPackaged = app.isPackaged;

  const paths: string[] = [];

  // 1. userData (preferred for packaged apps)
  if (isPackaged) {
    paths.push(join(app.getPath('userData'), 'bin', binaryName));
  }

  // 2. dev environment bin (for development)
  if (!isPackaged) {
    paths.push(join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', binaryName));
  }

  // 3. Legacy locations (for backwards compatibility)
  paths.push(
    // CWD node_modules/.bin
    join(process.cwd(), 'node_modules', '.bin', binaryName),
    
    // Old packaged app paths
    ...(isPackaged ? [
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
      ),
    ] : []),
    
    // Relative path from module (for development)
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
      if (await fsp.access(path).then(() => true).catch(() => false)) {
        log.info(`[URLprocessor] Found yt-dlp at: ${path}`);
        await ensureExecutable(path);
        return path;
      }
    }

    // Check system PATH
    const pathBinary = await which(binaryName).catch(() => null);
    if (pathBinary && await fsp.access(pathBinary).then(() => true).catch(() => false)) {
      log.info(`[URLprocessor] Found yt-dlp in PATH: ${pathBinary}`);
      return pathBinary;
    }

    log.error('[URLprocessor] yt-dlp binary could not be located in any expected location.');
    return null;
  } catch (error) {
    log.error('[URLprocessor] Unexpected error during yt-dlp binary search:', error);
    return null;
  }
}

// Test if binary is working
export async function testBinary(binaryPath: string): Promise<boolean> {
  try {
    const { stdout } = await execa(binaryPath, ['--version'], { timeout: 10000 });
    log.info(`[URLprocessor] yt-dlp version detected: ${stdout.trim()}`);
    return true;
  } catch {
    return false;
  }
}

// Get preferred installation path
export function getPreferredInstallPath(): string {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const isPackaged = app.isPackaged;

  if (isPackaged) {
    return join(app.getPath('userData'), 'bin', binaryName);
  } else {
    return join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', binaryName);
  }
}

// Export shared helpers
export { ensureExecutable, getBinarySearchPaths };
