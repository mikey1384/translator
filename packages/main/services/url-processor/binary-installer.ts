import { join } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

/**
 * Ensures yt-dlp binary is available and up-to-date.
 * - If binary doesn't exist, installs it
 * - If binary exists, optionally updates it
 * - Returns the path to the working binary
 */
export async function ensureYtDlpBinary({
  forceUpdate = false,
}: {
  forceUpdate?: boolean;
} = {}): Promise<string | null> {
  log.info('[URLprocessor] Ensuring yt-dlp binary is available...');

  try {
    // First try to find existing binary
    const existingBinary = await findExistingBinary();

    if (existingBinary && !forceUpdate) {
      // Binary exists and we're not forcing an update
      log.info(
        `[URLprocessor] Found existing yt-dlp binary: ${existingBinary}`
      );

      // Optionally check if it's working
      if (await testBinary(existingBinary)) {
        return existingBinary;
      } else {
        log.warn(
          '[URLprocessor] Existing binary is not working, will reinstall...'
        );
      }
    }

    if (existingBinary && forceUpdate) {
      log.info(
        '[URLprocessor] Force update requested, updating existing binary...'
      );
      // Try to update existing binary first
      if (await updateExistingBinary(existingBinary)) {
        return existingBinary;
      } else {
        log.warn('[URLprocessor] Update failed, will reinstall...');
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

async function findExistingBinary(): Promise<string | null> {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const isPackaged = app.isPackaged;

  // Check all the same locations as binary-locator.ts
  const possiblePaths = [
    // CWD node_modules/.bin
    join(process.cwd(), 'node_modules', '.bin', binaryName),

    // System PATH - we'll check this with 'which'
    null, // placeholder, will be filled by 'which'

    // Packaged app paths
    ...(isPackaged
      ? [
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
        ]
      : []),

    // Development path
    join(process.cwd(), 'node_modules', 'youtube-dl-exec', 'bin', binaryName),
  ];

  // Check file system paths
  for (const path of possiblePaths) {
    if (path && fs.existsSync(path)) {
      return path;
    }
  }

  // Check system PATH
  try {
    const which = await import('which');
    const pathBinary = await which.default(binaryName).catch(() => null);
    if (pathBinary && fs.existsSync(pathBinary)) {
      return pathBinary;
    }
  } catch {
    // Ignore errors from 'which'
  }

  return null;
}

async function testBinary(binaryPath: string): Promise<boolean> {
  try {
    // Test if binary is executable and responds
    await execa(binaryPath, ['--version'], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function updateExistingBinary(binaryPath: string): Promise<boolean> {
  try {
    log.info(`[URLprocessor] Attempting to update binary: ${binaryPath}`);
    const result = await execa(binaryPath, ['--update'], { timeout: 120000 });

    const success =
      result.stdout.includes('up to date') || result.stdout.includes('updated');
    if (success) {
      log.info('[URLprocessor] Binary update completed successfully');
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

async function installNewBinary(): Promise<string | null> {
  try {
    // Get the target directory where the binary should be installed
    const isPackaged = app.isPackaged;
    const exeExt = process.platform === 'win32' ? '.exe' : '';
    const binaryName = `yt-dlp${exeExt}`;

    let targetBinDir: string;

    if (isPackaged) {
      // For packaged apps, target the unpacked directory
      targetBinDir = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin'
      );
    } else {
      // For development, target the local node_modules
      targetBinDir = join(
        process.cwd(),
        'node_modules',
        'youtube-dl-exec',
        'bin'
      );
    }

    // Ensure the directory exists
    await fsp.mkdir(targetBinDir, { recursive: true });

    const targetBinaryPath = join(targetBinDir, binaryName);

    log.info(`[URLprocessor] Target binary path: ${targetBinaryPath}`);

    // Try youtube-dl-exec postinstall script first
    const postinstallResult = await tryPostinstallScript(
      targetBinDir,
      binaryName,
      targetBinaryPath
    );
    if (postinstallResult) {
      return postinstallResult;
    }

    // Fallback: direct download from GitHub
    log.info(
      '[URLprocessor] Postinstall script failed, trying direct download...'
    );
    return await downloadBinaryDirectly(targetBinaryPath);
  } catch (error: any) {
    log.error('[URLprocessor] Failed to install new binary:', error);
    return null;
  }
}

async function tryPostinstallScript(
  targetBinDir: string,
  binaryName: string,
  targetBinaryPath: string
): Promise<string | null> {
  try {
    const postinstallScript = join(
      process.cwd(),
      'node_modules',
      'youtube-dl-exec',
      'scripts',
      'postinstall.js'
    );

    if (!fs.existsSync(postinstallScript)) {
      log.info('[URLprocessor] Postinstall script not found');
      return null;
    }

    log.info('[URLprocessor] Running youtube-dl-exec postinstall script...');

    // Set environment variables for the download
    const env = {
      ...process.env,
      YOUTUBE_DL_DIR: targetBinDir,
      YOUTUBE_DL_FILENAME: binaryName,
      DEBUG: 'youtube-dl-exec*',
    };

    // Run the postinstall script
    const result = await execa('node', [postinstallScript], {
      env,
      cwd: join(process.cwd(), 'node_modules', 'youtube-dl-exec'),
      timeout: 120000,
    });

    log.info('[URLprocessor] Postinstall script completed:', result.stdout);

    // Verify the binary was downloaded
    if (fs.existsSync(targetBinaryPath)) {
      // Make it executable on Unix systems
      if (process.platform !== 'win32') {
        try {
          await execa('chmod', ['+x', targetBinaryPath]);
          log.info(
            `[URLprocessor] Made binary executable: ${targetBinaryPath}`
          );
        } catch (chmodError) {
          log.warn(
            '[URLprocessor] Failed to make binary executable:',
            chmodError
          );
        }
      }

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
  targetPath: string
): Promise<string | null> {
  try {
    log.info('[URLprocessor] Attempting direct download from GitHub...');

    // Determine the download URL based on platform
    let downloadUrl: string;

    if (process.platform === 'win32') {
      downloadUrl =
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
    } else {
      downloadUrl =
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    }

    log.info(`[URLprocessor] Downloading from: ${downloadUrl}`);

    // Use curl to download
    await execa('curl', ['-L', '-o', targetPath, downloadUrl], {
      timeout: 120000,
    });

    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      await execa('chmod', ['+x', targetPath]);
    }

    // Verify the download
    if (fs.existsSync(targetPath)) {
      const stats = await fsp.stat(targetPath);
      if (stats.size > 0) {
        log.info(
          `[URLprocessor] Successfully downloaded yt-dlp binary: ${targetPath} (${stats.size} bytes)`
        );
        return targetPath;
      } else {
        log.error('[URLprocessor] Downloaded binary is empty');
        await fsp.unlink(targetPath).catch(() => {});
        return null;
      }
    } else {
      log.error('[URLprocessor] Binary not found after download');
      return null;
    }
  } catch (error: any) {
    log.error('[URLprocessor] Direct download failed:', error);
    return null;
  }
}

// Legacy function for backward compatibility - now just calls ensureYtDlpBinary
export async function installYtDlpBinary(): Promise<string | null> {
  return ensureYtDlpBinary();
}
