import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import { fileURLToPath } from 'node:url';
import which from 'which';

export async function findYtDlpBinary(): Promise<string | null> {
  const exeExt = process.platform === 'win32' ? '.exe' : '';
  const binaryName = `yt-dlp${exeExt}`;
  const isPackaged = app.isPackaged;
  const moduleDir = dirname(fileURLToPath(import.meta.url));

  try {
    const cwdBinPath = join(process.cwd(), 'node_modules', '.bin', binaryName);
    if (fs.existsSync(cwdBinPath)) {
      log.info(
        `[URLProcessor] Found yt-dlp in CWD node_modules/.bin: ${cwdBinPath}`
      );
      // Ensure executable (especially needed if found via CWD)
      if (process.platform !== 'win32') {
        try {
          fs.accessSync(cwdBinPath, fs.constants.X_OK);
        } catch {
          try {
            await execa('chmod', ['+x', cwdBinPath]);
            log.info(`[URLProcessor] Made ${cwdBinPath} executable.`);
          } catch (e) {
            log.warn(`[URLProcessor] Failed to chmod +x ${cwdBinPath}:`, e);
            // Continue, it might still work
          }
        }
      }
      return cwdBinPath;
    }

    // 2️⃣ Look in system PATH using the 'which' package
    try {
      const pathBinary = await which(binaryName).catch(() => null);
      if (pathBinary && fs.existsSync(pathBinary)) {
        log.info(
          `[URLProcessor] Found yt-dlp in PATH via 'which': ${pathBinary}`
        );
        // We generally assume PATH binaries are executable, but check anyway
        if (process.platform !== 'win32') {
          try {
            fs.accessSync(pathBinary, fs.constants.X_OK);
          } catch {
            log.warn(
              `[URLProcessor] Binary found in PATH (${pathBinary}) but might not be executable.`
            );
            // Proceed cautiously
          }
        }
        return pathBinary;
      }
    } catch (whichError: any) {
      // Ignore 'not found' errors from 'which', log others
      log.warn(
        `[URLProcessor] Error checking system PATH with 'which' package:`,
        whichError
      );
    }

    // --- Start: Original Packaged App Checks (Integrated) ---

    // 3️⃣ Packaged App: Mac/Linux direct unpacked path
    if (
      (process.platform === 'darwin' || process.platform === 'linux') &&
      isPackaged
    ) {
      const unpackedMacLinux = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        binaryName // Use binaryName here
      );
      if (fs.existsSync(unpackedMacLinux)) {
        log.info(
          `[URLProcessor] Found yt-dlp in packaged Mac/Linux path: ${unpackedMacLinux}`
        );
        try {
          await execa('chmod', ['+x', unpackedMacLinux]);
        } catch {
          // If chmod fails, might still be executable
          log.warn(
            `[URLProcessor] Failed chmod on packaged Mac/Linux path: ${unpackedMacLinux}, proceeding anyway.`
          );
        }
        return unpackedMacLinux;
      }
    }

    // 4️⃣ Packaged App: Generic unpacked path (Windows/Other or fallback)
    if (isPackaged) {
      const unpackedGeneric = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        binaryName // Use binaryName here
      );
      if (fs.existsSync(unpackedGeneric)) {
        log.info(
          `[URLProcessor] Found yt-dlp in generic packaged path: ${unpackedGeneric}`
        );
        if (process.platform !== 'win32') {
          try {
            await execa('chmod', ['+x', unpackedGeneric]);
          } catch (e) {
            log.warn(
              `[URLProcessor] Failed chmod on generic packaged path: ${unpackedGeneric}, proceeding anyway.`,
              e
            );
          }
        }
        return unpackedGeneric;
      }

      // Fallback check for older structure (app.asar path replace) - Less likely needed now
      const unpackedAppPath = join(
        app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
        'node_modules',
        'youtube-dl-exec',
        'bin',
        binaryName
      );
      if (fs.existsSync(unpackedAppPath)) {
        log.info(
          `[URLProcessor] Found yt-dlp in app.asar replaced path: ${unpackedAppPath}`
        );
        if (process.platform !== 'win32') {
          try {
            await execa('chmod', ['+x', unpackedAppPath]);
          } catch (e) {
            log.warn(
              `[URLProcessor] Failed chmod on app.asar replaced path: ${unpackedAppPath}, proceeding anyway.`,
              e
            );
          }
        }
        return unpackedAppPath;
      }
    }

    // --- End: Original Packaged App Checks ---

    // 5️⃣ Relative path from module (Original fallback for dev/non-packaged)
    const relativePath = join(
      moduleDir, // Use dirname result
      '..',
      '..',
      'node_modules',
      'youtube-dl-exec',
      'bin',
      binaryName // Use binaryName here
    );
    if (fs.existsSync(relativePath)) {
      log.info(
        `[URLProcessor] Found yt-dlp via relative path: ${relativePath}`
      );
      if (process.platform !== 'win32') {
        try {
          fs.accessSync(relativePath, fs.constants.X_OK);
        } catch {
          try {
            await execa('chmod', ['+x', relativePath]);
          } catch {
            log.warn(
              `[URLProcessor] Failed chmod on relative path: ${relativePath}`
            );
            // Continue, might still work
          }
        }
      }
      return relativePath;
    }

    // If none found after all checks
    log.error(
      '[URLProcessor] yt-dlp binary could not be located via CWD .bin, PATH, packaged paths, or relative path.'
    );
    return null;
  } catch (error) {
    log.error(
      '[URLProcessor] Unexpected error during yt-dlp binary search:',
      error
    );
    return null;
  }
}

// Optionally update to the latest yt-dlp
