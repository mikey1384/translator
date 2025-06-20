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
  ensureExecutable 
} from './binary-locator.js';

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
          log.info(`[URLprocessor] Installation already in progress (PID: ${pid})`);
          return false;
        } else {
          // Process not running, remove stale lock file
          log.info('[URLprocessor] Removing stale installation lock file');
          await fsp.unlink(lockFile).catch(() => {});
          
          // Try again
          try {
            await fsp.writeFile(lockFile, process.pid.toString(), { flag: 'wx' });
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
function fetchWithRedirect(url: string, maxRedirects = 4): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { 
      headers: { 'User-Agent': 'yt-dlp-installer' },
      timeout: 30000
    }, (response) => {
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(response.statusCode!) && location && maxRedirects > 0) {
        log.info(`[URLprocessor] Following redirect to: ${location}`);
        return resolve(fetchWithRedirect(location, maxRedirects - 1));
      }
      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode} on ${url}`));
      }
      resolve(response);
    });
    
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
async function fetchSha256ForRelease(downloadUrl: string): Promise<string | null> {
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

/**
 * Ensures yt-dlp binary is available and up-to-date.
 * - If binary doesn't exist, installs it
 * - If binary exists, automatically tries to update it (yt-dlp needs frequent updates)
 * - Returns the path to the working binary
 */
export async function ensureYtDlpBinary({
  skipUpdate = false,
}: {
  skipUpdate?: boolean;
} = {}): Promise<string | null> {
  log.info('[URLprocessor] Ensuring yt-dlp binary is available...');

  try {
    // First try to find existing binary
    const existingBinary = await findYtDlpBinary();

    if (existingBinary) {
      log.info(`[URLprocessor] Found existing yt-dlp binary: ${existingBinary}`);

      // Test if it's working
      if (await testBinary(existingBinary)) {
        // Binary works - now try to update it (unless explicitly skipped)
        if (!skipUpdate) {
          log.info('[URLprocessor] Attempting to update yt-dlp to latest version...');
          const updateSuccess = await updateExistingBinary(existingBinary);
          if (!updateSuccess) {
            log.warn('[URLprocessor] Update failed, but existing binary works, continuing...');
          }
        } else {
          log.info('[URLprocessor] Skipping update as requested');
        }
        return existingBinary;
      } else {
        log.warn('[URLprocessor] Existing binary is not working, will reinstall...');
      }
    }

    // If we get here, we need to install/reinstall
    log.info('[URLprocessor] Installing yt-dlp binary...');
    return await installNewBinary();
  } catch (error: any) {
    log.error('[URLprocessor] Failed to ensure yt-dlp binary:', error);
    return null;
  }
}

async function updateExistingBinary(binaryPath: string): Promise<boolean> {
  try {
    log.info(`[URLprocessor] Attempting to update binary: ${binaryPath}`);

    // Check if binary is writable before attempting update
    try {
      await fsp.access(binaryPath, fs.constants.W_OK);
    } catch (error) {
      log.warn(`[URLprocessor] Binary not writable, skipping update: ${binaryPath}`);
      return false; // Return false since update did not occur
    }

    const result = await execa(binaryPath, ['-U'], { timeout: 120000 });

    const success =
      result.stdout.includes('up to date') || 
      result.stdout.includes('updated') ||
      result.stdout.includes('Successfully updated');
      
    if (success) {
      log.info('[URLprocessor] Binary update completed successfully');
      // Log version after update
      await testBinary(binaryPath);
    } else {
      log.warn('[URLprocessor] Update command completed but result unclear:', result.stdout);
    }
    return success;
  } catch (error: any) {
    log.error('[URLprocessor] Failed to update existing binary:', error);
    return false;
  }
}

async function installNewBinary(): Promise<string | null> {
  // Acquire installation lock
  if (!(await acquireInstallLock())) {
    log.warn('[URLprocessor] Installation already in progress by another process');
    return null;
  }

  try {
    const targetBinaryPath = getPreferredInstallPath();
    const targetBinDir = dirname(targetBinaryPath);

    log.info(`[URLprocessor] Target binary path: ${targetBinaryPath}`);

    // Ensure the directory exists
    try {
      await fsp.mkdir(targetBinDir, { recursive: true });
    } catch (error: any) {
      log.error(`[URLprocessor] Failed to create binary directory ${targetBinDir}:`, error);
      throw new Error(`Could not create yt-dlp directory. Check antivirus or run portable build. Error: ${error.message}`);
    }

    if (app.isPackaged) {
      // For packaged apps, download directly from GitHub
      log.info('[URLprocessor] Packaged app detected, downloading yt-dlp directly from GitHub...');
      return await downloadBinaryDirectly(targetBinaryPath);
    } else {
      // For development, try postinstall script first
      const postinstallResult = await tryPostinstallScript(targetBinaryPath);
      if (postinstallResult) {
        return postinstallResult;
      }

      // Fallback: direct download from GitHub
      log.info('[URLprocessor] Postinstall script failed, trying direct download...');
      return await downloadBinaryDirectly(targetBinaryPath);
    }
  } catch (error: any) {
    log.error('[URLprocessor] Failed to install new binary:', error);
    return null;
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

    if (!(await fsp.access(postinstallScript).then(() => true).catch(() => false))) {
      log.info('[URLprocessor] Postinstall script not found');
      return null;
    }

    log.info('[URLprocessor] Running youtube-dl-exec postinstall script...');

    // Run the postinstall script
    const result = await execa('node', [postinstallScript], {
      cwd: join(packageRoot, 'node_modules', 'youtube-dl-exec'),
      timeout: 120000,
    });

    log.info('[URLprocessor] Postinstall script completed:', result.stdout);

    // Verify the binary was downloaded
    if (await fsp.access(targetBinaryPath).then(() => true).catch(() => false)) {
      // Make it executable using shared helper
      await ensureExecutable(targetBinaryPath);

      log.info(`[URLprocessor] Successfully installed yt-dlp binary via postinstall: ${targetBinaryPath}`);
      return targetBinaryPath;
    } else {
      log.error('[URLprocessor] Binary not found after postinstall script execution');
      return null;
    }
  } catch (error: any) {
    log.error('[URLprocessor] Postinstall script failed:', error);
    return null;
  }
}

async function downloadBinaryDirectly(
  targetPath: string
): Promise<string | null> {
  try {
    log.info('[URLprocessor] Attempting direct download from GitHub...');

    // Determine the download URL based on platform
    const downloadUrl = process.platform === 'win32' 
      ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
      : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

    log.info(`[URLprocessor] Downloading from: ${downloadUrl}`);

    // Ensure the target directory exists
    const targetDir = dirname(targetPath);
    await fsp.mkdir(targetDir, { recursive: true });

    // Download with redirect following
    const response = await fetchWithRedirect(downloadUrl);
    
    // Stream the response to the target file
    const fileStream = createWriteStream(targetPath);
    await pipeline(response, fileStream);

    // Verify the download
    const stats = await fsp.stat(targetPath);
    if (stats.size < 5 * 1024 * 1024) { // Less than 5MB is suspicious
      log.error(`[URLprocessor] Downloaded binary is too small: ${stats.size} bytes`);
      await fsp.unlink(targetPath).catch(() => {});
      return null;
    }

    // Calculate SHA-256 and verify against GitHub's published hash
    const actualHash = await calculateSHA256(targetPath);
    log.info(`[URLprocessor] Downloaded binary SHA-256: ${actualHash}`);
    
    // Fetch expected hash from GitHub
    const expectedHash = await fetchSha256ForRelease(downloadUrl);
    if (expectedHash && actualHash !== expectedHash) {
      log.error(`[URLprocessor] SHA-256 verification failed! Expected: ${expectedHash}, Got: ${actualHash}`);
      await fsp.unlink(targetPath).catch(() => {});
      throw new Error('Downloaded yt-dlp failed SHA-256 verification');
    } else if (expectedHash) {
      log.info('[URLprocessor] SHA-256 verification passed');
    } else {
      log.warn('[URLprocessor] Could not verify SHA-256 (hash file unavailable), but file size looks correct');
    }

    // Make executable on Unix systems
    await ensureExecutable(targetPath);

    log.info(`[URLprocessor] Successfully downloaded yt-dlp to: ${targetPath} (${stats.size} bytes)`);
    return targetPath;
  } catch (error: any) {
    log.error('[URLprocessor] Failed to download binary directly:', error);
    
    // Provide specific error messages for common issues
    if (error.message?.includes('No network connection')) {
      log.error('[URLprocessor] Network error - check internet connection');
    } else if (error.message?.includes('timeout')) {
      log.error('[URLprocessor] Download timeout - GitHub may be slow or unreachable');
    } else if (error.message?.includes('SHA-256 verification')) {
      log.error('[URLprocessor] Security error - downloaded file may be corrupted or tampered with');
    }
    
    return null;
  }
}

// Legacy function for backward compatibility - now just calls ensureYtDlpBinary
export async function installYtDlpBinary(): Promise<string | null> {
  return ensureYtDlpBinary();
}