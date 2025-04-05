import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { youtubeDl } from 'youtube-dl-exec';
import log from 'electron-log';
import { FFmpegService } from './ffmpeg-service.js';
import { fileURLToPath } from 'url';
import { app } from 'electron';
import { execa } from 'execa';

// IMPORTANT: Add test logs to verify module loading
log.info('[URLProcessor] MODULE LOADED');
log.warn('[URLProcessor] THIS IS A TEST LOG');
log.error('[URLProcessor] VERIFICATION LOG');

try {
  log.info(
    `[URLProcessor] App.getPath('userData'): ${app.getPath('userData')}`
  );
  log.info(
    `[URLProcessor] Path resolution test: ${path.join(process.resourcesPath, 'app.asar.unpacked')}`
  );
} catch (e) {
  log.error('[URLProcessor] Error accessing paths:', e);
}

// Promisify execFile for async/await usage
// REMOVED: const execFileAsync = promisify(execFile);

// Define quality type and mapping
export type VideoQuality = 'low' | 'mid' | 'high';
const qualityFormatMap: Record<VideoQuality, string> = {
  high: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  mid: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]',
  low: 'best[height<=480]',
};

interface ProgressCallback {
  (progress: { percent: number; stage: string; error?: string | null }): void;
}

// Function to find the yt-dlp binary path
async function findYtDlpBinary(): Promise<string | null> {
  try {
    log.info(
      `[URLProcessor] Finding yt-dlp binary. App is packaged: ${app.isPackaged}`
    );

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    log.info(`[URLProcessor] Module directory: ${moduleDir}`);

    // Get platform-specific extension
    const exeExt = process.platform === 'win32' ? '.exe' : '';

    // DIRECT APPROACH FOR MACOS & LINUX PACKAGED: Check unpacked path first
    if (
      (process.platform === 'darwin' || process.platform === 'linux') &&
      app.isPackaged
    ) {
      const unpackedPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        `yt-dlp${exeExt}`
      );
      log.info(
        `[URLProcessor] Checking primary unpacked path: ${unpackedPath}`
      );

      if (fs.existsSync(unpackedPath)) {
        try {
          // Try to make it executable asynchronously
          log.info(`[URLProcessor] Making binary executable: ${unpackedPath}`);
          await execa('chmod', ['+x', unpackedPath]);
          log.info(
            `[URLProcessor] Successfully made binary executable: ${unpackedPath}`
          );
          // If unpacked exists and is executable (or made executable), return it immediately
          return unpackedPath;
        } catch (e) {
          log.error(`[URLProcessor] Error making binary executable: ${e}`);
          // If chmod fails, maybe it was already executable? Still return it.
          // Check access again just in case
          try {
            fs.accessSync(unpackedPath, fs.constants.X_OK);
            log.warn(
              '[URLProcessor] chmod failed, but binary seems executable anyway.'
            );
            return unpackedPath;
          } catch (accessErr) {
            log.error(
              '[URLProcessor] chmod failed AND binary not executable.',
              accessErr
            );
            // Don't return this path if it's not usable
          }
        }
      } else {
        log.error(
          `[URLProcessor] Primary unpacked path doesn't exist: ${unpackedPath}`
        );
      }
    }

    // If direct/unpacked approach failed or not applicable, try the standard paths
    // Define possible paths for the yt-dlp binary
    const possibleBinPaths = [
      // Development paths
      path.join(
        moduleDir,
        '..',
        '..',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        `yt-dlp${exeExt}`
      ),

      // Production paths - app.asar.unpacked
      app.isPackaged
        ? path.join(
            app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
            'node_modules',
            'youtube-dl-exec',
            'bin',
            `yt-dlp${exeExt}`
          )
        : null,

      // Resources path
      app.isPackaged
        ? path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'youtube-dl-exec',
            'bin',
            `yt-dlp${exeExt}`
          )
        : null,

      // Direct call (rely on PATH)
      `yt-dlp${exeExt}`,

      // Windows specific paths
      process.platform === 'win32' && app.isPackaged
        ? path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'youtube-dl-exec',
            'bin',
            'yt-dlp.exe'
          )
        : null,
    ].filter(Boolean) as string[]; // Remove null entries

    // Check each path
    for (const binPath of possibleBinPaths) {
      try {
        const exists = fs.existsSync(binPath);
        log.info(
          `[URLProcessor] yt-dlp path check: ${binPath}, exists: ${exists}`
        );

        if (exists) {
          try {
            // Check if file is executable - for Windows we assume .exe files are executable
            if (process.platform !== 'win32') {
              try {
                fs.accessSync(binPath, fs.constants.X_OK);
                log.info(
                  `[URLProcessor] Found usable (already executable) yt-dlp binary: ${binPath}`
                );
                return binPath; // Found usable one
              } catch (accessErr) {
                log.warn(
                  `[URLProcessor] yt-dlp binary exists but is not executable: ${binPath}`
                );

                // Try to make it executable asynchronously
                if (
                  process.platform === 'darwin' ||
                  process.platform === 'linux'
                ) {
                  try {
                    log.info(
                      `[URLProcessor] Attempting to make binary executable: ${binPath}`
                    );
                    await execa('chmod', ['+x', binPath]);
                    log.info(
                      `[URLProcessor] Successfully made binary executable: ${binPath}`
                    );
                    return binPath; // Made it executable, return it
                  } catch (chmodError) {
                    log.error(
                      `[URLProcessor] Failed to make binary executable: ${chmodError}`
                    );
                    // If chmod failed, continue checking other paths
                  }
                } else {
                  log.warn(
                    '[URLProcessor] Cannot automatically make executable on this platform.'
                  );
                }
              }
            } else {
              // On Windows, if it exists, assume usable
              log.info(
                `[URLProcessor] Found usable Windows yt-dlp binary: ${binPath}`
              );
              return binPath;
            }
          } catch (e) {
            log.warn(
              `[URLProcessor] yt-dlp binary exists but is not executable: ${binPath}`
            );

            // On MacOS, we can try to make it executable
            if (process.platform === 'darwin') {
              try {
                log.info(
                  `[URLProcessor] Attempting to make binary executable: ${binPath}`
                );
                await execa('chmod', ['+x', binPath]);
                log.info(
                  `[URLProcessor] Successfully made binary executable: ${binPath}`
                );
                return binPath;
              } catch (chmodError) {
                log.error(
                  `[URLProcessor] Failed to make binary executable: ${chmodError}`
                );
              }
            }
          }
        } else {
          // Check adjacent directories as fallback
          const parentDir = path.dirname(binPath);
          try {
            const dirContents = fs.readdirSync(parentDir);
            log.info(
              `[URLProcessor] Directory contents of ${parentDir}: ${dirContents.join(', ')}`
            );
          } catch (dirError) {
            log.warn(
              `[URLProcessor] Cannot read directory ${parentDir}: ${dirError}`
            );
          }
        }
      } catch (pathError) {
        log.warn(`[URLProcessor] Error checking path ${binPath}: ${pathError}`);
      }
    }

    log.error(
      '[URLProcessor] Could not find executable yt-dlp binary in any expected location'
    );

    // As a last resort, print out the directory structure to see what we have
    try {
      const unpacked = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked')
        : null;
      if (unpacked && fs.existsSync(unpacked)) {
        log.info(`[URLProcessor] Unpacked directory exists: ${unpacked}`);
        // List top-level directories to see what's available
        const unpachedContents = fs.readdirSync(unpacked);
        log.info(
          `[URLProcessor] Unpacked directory contents: ${unpachedContents.join(', ')}`
        );

        // Check if node_modules exists
        const nodeModules = path.join(unpacked, 'node_modules');
        if (fs.existsSync(nodeModules)) {
          const nodeModulesContents = fs.readdirSync(nodeModules);
          log.info(
            `[URLProcessor] node_modules contents: ${nodeModulesContents.join(', ')}`
          );

          // Check if youtube-dl-exec exists
          const ytDlpDir = path.join(nodeModules, 'youtube-dl-exec');
          if (fs.existsSync(ytDlpDir)) {
            const ytDlpDirContents = fs.readdirSync(ytDlpDir);
            log.info(
              `[URLProcessor] youtube-dl-exec contents: ${ytDlpDirContents.join(', ')}`
            );

            // Check bin directory
            const binDir = path.join(ytDlpDir, 'bin');
            if (fs.existsSync(binDir)) {
              const binDirContents = fs.readdirSync(binDir);
              log.info(
                `[URLProcessor] bin contents: ${binDirContents.join(', ')}`
              );
            }
          }
        }
      }
    } catch (e) {
      log.error('[URLProcessor] Error when inspecting directory structure:', e);
    }

    return null;
  } catch (error) {
    log.error('[URLProcessor] Error finding yt-dlp binary:', error);
    return null;
  }
}

// Function to update yt-dlp binary to the latest version
export async function updateYtDlp(): Promise<boolean> {
  try {
    log.info('[URLProcessor] Attempting to update yt-dlp to latest version...');

    const binPath = await findYtDlpBinary();

    if (!binPath) {
      log.error('[URLProcessor] Cannot update yt-dlp - binary not found');
      return false;
    }

    // Run the self-update command using execa
    const { stdout, stderr } = await execa(binPath, ['--update']);

    log.info('[URLProcessor] yt-dlp update stdout:', stdout);

    if (stderr) {
      log.warn('[URLProcessor] yt-dlp update stderr:', stderr);
    }

    if (stdout.includes('up to date') || stdout.includes('updated')) {
      log.info('[URLProcessor] yt-dlp update successful');
      return true;
    } else {
      log.warn('[URLProcessor] yt-dlp update did not report success:', stdout);
      return false;
    }
  } catch (error) {
    log.error('[URLProcessor] Failed to update yt-dlp:', error);
    return false;
  }
}

// Enhanced download function with fallback mechanisms and better error handling
async function downloadVideoFromPlatform(
  url: string,
  outputDir: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<{ filepath: string; info: any }> {
  // Initial logging
  log.info(`[URLProcessor] Starting download for URL: ${url}`);
  log.info(`[URLProcessor] Output directory: ${outputDir}`);
  log.info(`[URLProcessor] Requested quality: ${quality}`);
  log.info(`[URLProcessor] App is packaged: ${app.isPackaged}`);

  // DEVELOPMENT MODE - Use simpler approach for development environment
  if (!app.isPackaged) {
    log.info('[URLProcessor] Using DEVELOPMENT MODE approach');
    progressCallback?.({
      percent: 25,
      stage: 'Preparing video download (dev mode)...',
    });

    try {
      // Ensure the output directory exists
      await fsp.mkdir(outputDir, { recursive: true });

      // Use a simpler filename pattern for development
      const tempFilenamePattern = path.join(
        outputDir,
        `dev_download_${Date.now()}_%(id)s.%(ext)s`
      );

      // Set up progress updates
      let currentProgress = 30;
      const progressInterval = setInterval(() => {
        currentProgress += 5;
        if (currentProgress < 90) {
          progressCallback?.({
            percent: currentProgress,
            stage: 'Downloading video (dev mode)...',
          });
        }
      }, 1000);

      // Simple direct call in development mode
      const options = {
        output: tempFilenamePattern,
        format: qualityFormatMap[quality] || qualityFormatMap.high,
        noCheckCertificates: true,
        noWarnings: true,
        printJson: true,
      };

      log.info(
        '[URLProcessor] Calling youtube-dl-exec with DEV options:',
        options
      );
      const result = await youtubeDl(url, options);

      // Clear interval
      clearInterval(progressInterval);

      // Process the result
      const downloadInfo =
        typeof result === 'string' ? JSON.parse(result) : result;
      const finalFilepath = downloadInfo._filename;

      if (!finalFilepath) {
        throw new Error('Downloaded video information incomplete (dev mode)');
      }

      log.info(`[URLProcessor] Dev download successful: ${finalFilepath}`);
      progressCallback?.({
        percent: 90,
        stage: 'Download complete (dev mode), verifying...',
      });

      return { filepath: finalFilepath, info: downloadInfo };
    } catch (devError: any) {
      log.error('[URLProcessor] Dev mode download error:', devError);
      progressCallback?.({
        percent: 0,
        stage: 'Download failed (dev mode)',
        error: devError.message || String(devError),
      });
      throw devError;
    }
  }

  // PRODUCTION MODE - Continue with existing robust implementation for packaged app
  // Log OS information and environment
  log.info(
    `[URLProcessor] Platform: ${process.platform}, Arch: ${process.arch}`
  );
  log.info(`[URLProcessor] App path: ${app.getAppPath()}`);
  log.info(`[URLProcessor] Resources path: ${process.resourcesPath}`);

  // Check if the URL is valid before proceeding
  try {
    new URL(url);
  } catch (e) {
    log.error(`[URLProcessor] Invalid URL: ${url}`);
    throw new Error(`Invalid URL: ${url}`);
  }

  // Try to locate yt-dlp
  const ytDlpPath = await findYtDlpBinary();
  log.info(`[URLProcessor] Using yt-dlp binary: ${ytDlpPath || 'Not found'}`);

  if (!ytDlpPath) {
    log.error('[URLProcessor] CRITICAL ERROR: Cannot find yt-dlp binary');

    // Log all possible binary locations for debugging
    const locations = [
      path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        'yt-dlp'
      ),
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp',
      '/opt/homebrew/bin/yt-dlp',
    ];

    for (const loc of locations) {
      try {
        const exists = fs.existsSync(loc);
        log.info(
          `[URLProcessor] Checked location ${loc}: ${exists ? 'EXISTS' : 'NOT FOUND'}`
        );

        if (exists) {
          try {
            // Check if it's executable
            fs.accessSync(loc, fs.constants.X_OK);
            log.info(`[URLProcessor] ${loc} is executable`);

            // Try to run it directly using execa
            try {
              const { stdout: versionResult } = await execa(loc, ['--version']);
              log.info(
                `[URLProcessor] Successfully ran ${loc}, version: ${versionResult.trim()}`
              );
            } catch (execError) {
              log.error(`[URLProcessor] Failed to execute ${loc}:`, execError);
            }
          } catch (permError) {
            log.error(`[URLProcessor] ${loc} exists but is not executable`);
          }
        }
      } catch (err) {
        log.error(`[URLProcessor] Error checking ${loc}:`, err);
      }
    }

    throw new Error(
      'Cannot find yt-dlp binary. Video download is not possible.'
    );
  }

  // Verify the binary is executable before proceeding
  try {
    log.info(`[URLProcessor] Checking if yt-dlp is executable: ${ytDlpPath}`);
    fs.accessSync(ytDlpPath, fs.constants.X_OK);
    log.info(`[URLProcessor] yt-dlp is executable`);

    // Try running yt-dlp --version directly to validate it works
    try {
      const { stdout: versionInfo } = await execa(ytDlpPath, ['--version']);
      log.info(
        `[URLProcessor] yt-dlp version check successful: ${versionInfo.trim()}`
      );
    } catch (versionError) {
      log.error('[URLProcessor] Failed to get yt-dlp version:', versionError);
      // Continue anyway, the main call might still work
    }
  } catch (accessError) {
    log.error('[URLProcessor] yt-dlp is not executable:', accessError);

    // Try to make it executable asynchronously
    try {
      await execa('chmod', ['+x', ytDlpPath]);
      log.info(
        `[URLProcessor] Successfully made yt-dlp executable: ${ytDlpPath}`
      );
    } catch (chmodError) {
      log.error('[URLProcessor] Failed to make yt-dlp executable:', chmodError);
      // Continue anyway, the main call might still work despite this error
    }
  }

  progressCallback?.({
    percent: 25,
    stage: 'Preparing video download...',
  });

  // Ensure output directory exists
  try {
    await fsp.mkdir(outputDir, { recursive: true });
    log.info(`[URLProcessor] Ensured output directory exists: ${outputDir}`);

    // Verify directory was created
    const stat = await fsp.stat(outputDir);
    if (!stat.isDirectory()) {
      throw new Error(`Created path is not a directory: ${outputDir}`);
    }
  } catch (error) {
    log.error(
      `[URLProcessor] Failed to create output directory: ${outputDir}`,
      error
    );
    throw new Error(
      `Failed to create output directory: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Check if directory is writable
  try {
    const testFile = path.join(outputDir, `test_${Date.now()}.tmp`);
    await fsp.writeFile(testFile, 'test');
    await fsp.unlink(testFile);
    log.info(
      `[URLProcessor] Verified output directory is writable: ${outputDir}`
    );
  } catch (error) {
    log.error(
      `[URLProcessor] Output directory is not writable: ${outputDir}`,
      error
    );
    throw new Error(
      `Output directory is not writable: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const formatString = qualityFormatMap[quality] || qualityFormatMap.high;

  // Use a temporary unique filename pattern for yt-dlp
  // Ensure it doesn't contain any spaces, especially for Windows
  const timestamp = Date.now();
  const tempFilenamePattern = path.join(
    outputDir,
    `download_${timestamp}_%(id)s.%(ext)s`
  );
  log.info(
    `[URLProcessor] Using temporary filename pattern: ${tempFilenamePattern}`
  );

  // Check what files exist in output directory before downloading
  try {
    const filesBefore = await fsp.readdir(outputDir);
    log.info(`[URLProcessor] Files before download: ${filesBefore.join(', ')}`);
  } catch (e) {
    log.warn(`[URLProcessor] Couldn't list files before download: ${e}`);
  }

  try {
    // Define interval handle outside try/finally
    let progressInterval: NodeJS.Timeout | undefined;

    try {
      // Main try for download attempts
      progressCallback?.({ percent: 30, stage: 'Initiating download...' });

      // Start the progress interval - Define currentProgress here too
      let currentProgress = 30;
      progressInterval = setInterval(() => {
        // Ensure interval logic doesn't run indefinitely if download is very fast/slow
        currentProgress = Math.min(currentProgress + 5, 89); // Cap at 89%
        progressCallback?.({
          percent: currentProgress,
          stage: 'Downloading video...',
        });
      }, 1000);

      // --- Standard Download Attempt ---
      // --- Use Direct Execa Call in Packaged App (Bypass youtubeDl wrapper) ---
      // We know execa works from the version check, so use it directly
      log.info('[URLProcessor] Using direct execa call (packaged app)');

      // Build args manually
      const ffmpegService = new FFmpegService(); // Get ffmpeg path
      const ffmpegPath = ffmpegService.getFFmpegPath(); // Correct method name and casing
      const standardArgs = [
        url,
        '--output',
        tempFilenamePattern,
        '--format',
        formatString,
        '--no-check-certificates',
        '--no-warnings',
        '--add-header',
        'referer:youtube.com',
        '--add-header',
        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        '--print-json',
        '--ffmpeg-location',
        ffmpegPath,
      ];

      let outputJson;
      try {
        const { stdout: output } = await execa(ytDlpPath, standardArgs, {
          windowsHide: true,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
        outputJson = JSON.parse(output);
      } catch (e: any) {
        log.error(
          '[URLProcessor] Error calling yt-dlp directly via execa (standard):',
          e
        );
        if (e.stdout) log.info('[URLProcessor] yt-dlp stdout:', e.stdout);
        if (e.stderr) log.error('[URLProcessor] yt-dlp stderr:', e.stderr);
        throw e; // Re-throw to trigger fallback or error handling
      }
      // --- End Direct Execa Call ---

      log.info(
        '[URLProcessor] youtube-dl-exec direct call finished successfully.'
      );

      if (!outputJson) {
        throw new Error('youtube-dl-exec did not return any output.');
      }

      // Process the successful result
      const downloadInfo =
        typeof outputJson === 'string' ? JSON.parse(outputJson) : outputJson;

      if (!downloadInfo || typeof downloadInfo !== 'object') {
        throw new Error('Failed to parse JSON output from youtube-dl-exec');
      }

      const finalFilepath = downloadInfo._filename;

      if (!finalFilepath || typeof finalFilepath !== 'string') {
        log.error(
          '[URLProcessor] Critical: JSON output missing _filename property.',
          downloadInfo
        );
        throw new Error(
          'Downloaded video information is incomplete (missing _filename in JSON).'
        );
      }

      // Verify the file exists at the path specified in JSON
      log.info(
        `[URLProcessor] Verifying existence of final file: ${finalFilepath}`
      );

      // List files in the output directory to see what was created
      try {
        const filesAfter = await fsp.readdir(outputDir);
        log.info(
          `[URLProcessor] Files after download: ${filesAfter.join(', ')}`
        );

        // Look for files that match our timestamp pattern
        const newFiles = filesAfter.filter(f =>
          f.includes(timestamp.toString())
        );
        log.info(
          `[URLProcessor] Potential newly created files: ${newFiles.join(', ')}`
        );
      } catch (dirErr) {
        log.error(`[URLProcessor] Could not list output directory: ${dirErr}`);
      }

      if (!fs.existsSync(finalFilepath)) {
        log.error(
          `[URLProcessor] Critical: File specified in JSON does not exist: ${finalFilepath}`
        );

        // Try to find the file another way if the JSON path is wrong
        try {
          const dir = path.dirname(finalFilepath);
          const files = await fsp.readdir(dir);

          // Look for files with the timestamp in the same directory
          const matchingFiles = files.filter(f =>
            f.includes(timestamp.toString())
          );
          if (matchingFiles.length > 0) {
            const alternativeFile = path.join(dir, matchingFiles[0]);
            log.info(
              `[URLProcessor] Found alternative file: ${alternativeFile}`
            );

            // Check if it exists and return that instead
            if (fs.existsSync(alternativeFile)) {
              log.info(
                `[URLProcessor] Using alternative file path: ${alternativeFile}`
              );

              // Override the finalFilepath with our found file
              const altFilepath = alternativeFile;
              downloadInfo._filename = altFilepath;

              // Check file size
              const stats = await fsp.stat(altFilepath);
              if (stats.size === 0) {
                log.error(
                  `[URLProcessor] Alternative file is empty: ${altFilepath}`
                );
                throw new Error(`Alternative file is empty: ${altFilepath}`);
              }

              log.info(
                `[URLProcessor] Alternative download successful. File path: ${altFilepath}`
              );
              progressCallback?.({
                percent: 90,
                stage: 'Download complete, verifying...',
              });

              return { filepath: altFilepath, info: downloadInfo };
            }
          }
        } catch (findErr) {
          log.error(
            `[URLProcessor] Error finding alternative file: ${findErr}`
          );
        }

        // If we couldn't find an alternative, throw the original error
        throw new Error(
          `Downloaded video file not found at expected path: ${finalFilepath}`
        );
      }

      const stats = await fsp.stat(finalFilepath);
      if (stats.size === 0) {
        log.error(
          `[URLProcessor] Critical: Downloaded file is empty: ${finalFilepath}`
        );
        throw new Error(`Downloaded video file is empty: ${finalFilepath}`);
      }

      log.info(
        `[URLProcessor] Download successful. File path: ${finalFilepath}`
      );
      progressCallback?.({
        percent: 90,
        stage: 'Download complete, verifying...',
      });

      return { filepath: finalFilepath, info: downloadInfo };
    } catch (standardError: any) {
      // Log the standard approach error
      log.warn(
        '[URLProcessor] Standard download approach failed:',
        standardError
      );

      log.info('[URLProcessor] Trying fallback download approach...');

      progressCallback?.({
        percent: 40,
        stage: 'First download attempt failed, trying alternative method...',
      });

      // --- Use Direct Execa Call for Fallback (Packaged App) ---
      log.info(
        '[URLProcessor] Using direct execa call for fallback (packaged app)'
      );
      const fallbackArgs = [
        url,
        '--output',
        tempFilenamePattern,
        '--format',
        'best', // Simplified format
        '--no-check-certificates',
        '--no-warnings',
        '--print-json',
      ];

      let fallbackOutputJson;
      try {
        const { stdout: fallbackOutput } = await execa(
          ytDlpPath,
          fallbackArgs,
          {
            windowsHide: true,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          }
        );
        fallbackOutputJson = JSON.parse(fallbackOutput);
      } catch (e: any) {
        log.error(
          '[URLProcessor] Error calling yt-dlp directly via execa (fallback):',
          e
        );
        if (e.stdout)
          log.info('[URLProcessor] yt-dlp stdout (fallback):', e.stdout);
        if (e.stderr)
          log.error('[URLProcessor] yt-dlp stderr (fallback):', e.stderr);
        throw e; // Re-throw standardError to ensure original error context is kept
      }
      // --- End Direct Fallback Execa Call ---

      if (!fallbackOutputJson) {
        throw new Error('Fallback download attempt did not return any output.');
      }

      // Process the fallback result
      const fallbackDownloadInfo =
        typeof fallbackOutputJson === 'string'
          ? JSON.parse(fallbackOutputJson)
          : fallbackOutputJson;

      if (!fallbackDownloadInfo || typeof fallbackDownloadInfo !== 'object') {
        throw new Error(
          'Failed to parse JSON output from fallback download attempt'
        );
      }

      const fallbackFilepath = fallbackDownloadInfo._filename;

      if (!fallbackFilepath || typeof fallbackFilepath !== 'string') {
        log.error(
          '[URLProcessor] Critical: Fallback JSON output missing _filename property.',
          fallbackDownloadInfo
        );
        throw new Error(
          'Fallback download information is incomplete (missing _filename in JSON).'
        );
      }

      // Verify the fallback file exists
      log.info(
        `[URLProcessor] Verifying existence of fallback file: ${fallbackFilepath}`
      );
      if (!fs.existsSync(fallbackFilepath)) {
        log.error(
          `[URLProcessor] Critical: Fallback file specified in JSON does not exist: ${fallbackFilepath}`
        );
        throw new Error(
          `Fallback downloaded video file not found at expected path: ${fallbackFilepath}`
        );
      }

      const fallbackStats = await fsp.stat(fallbackFilepath);
      if (fallbackStats.size === 0) {
        log.error(
          `[URLProcessor] Critical: Fallback downloaded file is empty: ${fallbackFilepath}`
        );
        throw new Error(
          `Fallback downloaded video file is empty: ${fallbackFilepath}`
        );
      }

      log.info(
        `[URLProcessor] Fallback download successful. File path: ${fallbackFilepath}`
      );
      progressCallback?.({
        percent: 90,
        stage: 'Alternative download complete, verifying...',
      });

      return { filepath: fallbackFilepath, info: fallbackDownloadInfo };
    } finally {
      // --- Cleanup ---
      if (progressInterval) {
        clearInterval(progressInterval);
        log.info('[URLProcessor] Cleared progress interval.');
      }
    }
  } catch (error: any) {
    // Capture detailed error information
    log.error('[URLProcessor] Error during downloadVideoFromPlatform:', error);

    // Log additional details
    log.error(
      '[URLProcessor] Error details:',
      JSON.stringify(
        {
          message: error.message,
          name: error.name,
          stack: error.stack,
          stderr: error.stderr,
          stdout: error.stdout,
          command: error.command,
          code: error.code,
          signal: error.signal,
        },
        null,
        2
      )
    );

    progressCallback?.({
      percent: 0, // Reset progress on error
      stage: 'Download failed',
      error: error.message || String(error),
    });

    // Check for common error patterns and provide more helpful messages
    let errorMessage = error.message || String(error);

    if (
      errorMessage.includes('HTTP Error 403') ||
      errorMessage.includes('Forbidden')
    ) {
      errorMessage =
        'Access to this video is forbidden. It might be private or region-restricted.';
    } else if (
      errorMessage.includes('HTTP Error 404') ||
      errorMessage.includes('Not Found')
    ) {
      errorMessage =
        'Video not found. The URL might be incorrect or the video has been removed.';
    } else if (errorMessage.includes('Unable to download JSON metadata')) {
      errorMessage =
        'Unable to retrieve video metadata. The video might be private or the platform might be blocking access.';
    } else if (
      errorMessage.includes('ffmpeg') ||
      errorMessage.includes('postprocessor')
    ) {
      errorMessage =
        'Error processing video. This might be due to an unsupported format or corrupted download.';
    } else if (error.code === 'ENOENT') {
      errorMessage = 'The yt-dlp binary could not be found or executed.';
    } else if (error.code === 'EACCES') {
      errorMessage =
        'Permission denied when trying to execute the yt-dlp binary.';
    }

    // Rethrow the error to be caught by the caller
    throw new Error(`Video download failed: ${errorMessage}`);
  }
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality = 'high',
  progressCallback?: ProgressCallback
): Promise<{
  videoPath: string; // This will be the final, confirmed path
  filename: string; // Base filename
  size: number;
  fileUrl: string; // Original URL
  originalVideoPath: string; // Same as videoPath in this simplified version
}> {
  // Debug logs to ensure this function is being called
  log.info('[URLProcessor] processVideoUrl FUNCTION CALLED');
  log.warn('[URLProcessor] PROCESS URL VERIFICATION');

  try {
    // Debug the URL input
    log.info(`[URLProcessor] processVideoUrl input URL: "${url}"`);
    log.info(`[URLProcessor] processVideoUrl input quality: "${quality}"`);
  } catch (e) {
    log.error('[URLProcessor] Error logging inputs:', e);
  }

  // Ensure FFmpegService is available for temp dir (or use another way to get temp dir)
  const ffmpegService = new FFmpegService(); // Or get singleton instance
  const tempDir = ffmpegService.getTempDir(); // Use the consistent temp directory

  if (!url || typeof url !== 'string') {
    throw new Error('Invalid URL provided');
  }

  // Basic URL validation
  try {
    new URL(url); // Will throw if URL is invalid
  } catch (error) {
    throw new Error('Invalid URL format. Please provide a valid URL.');
  }

  log.info(`[processVideoUrl] Processing URL: ${url}`);
  progressCallback?.({ percent: 10, stage: 'Starting URL processing...' });

  try {
    // Call the enhanced download function
    const { filepath } = await downloadVideoFromPlatform(
      url,
      tempDir, // Pass the application's temp directory
      quality,
      progressCallback
    );

    // Get file stats
    const stats = await fsp.stat(filepath);
    const finalFilename = path.basename(filepath);

    log.info(`[processVideoUrl] Processing complete for: ${finalFilename}`);

    // Ensure we have a valid path and filename before returning
    if (!filepath || !finalFilename) {
      throw new Error(
        'Downloaded video information is incomplete (missing path or filename).'
      );
    }

    // Double-check file exists again
    if (!fs.existsSync(filepath)) {
      throw new Error(
        `Downloaded video file does not exist at path: ${filepath}`
      );
    }

    // Create a file:// URL for the file
    const fileUrl = `file://${filepath}`;

    progressCallback?.({ percent: 100, stage: 'URL processing complete' });

    return {
      videoPath: filepath, // The confirmed path from downloadInfo._filename
      filename: finalFilename,
      size: stats.size,
      fileUrl: fileUrl, // Use proper file:// URL instead of the original web URL
      originalVideoPath: filepath, // Path is determined by yt-dlp, no separate original path needed
    };
  } catch (error) {
    log.error('[processVideoUrl] Error:', error);
    // Ensure progress reflects failure
    progressCallback?.({
      percent: 0, // Or keep last known progress? Resetting seems clearer.
      stage: 'Error processing URL',
      error: error instanceof Error ? error.message : String(error),
    });
    // Rethrow the error
    throw error;
  }
}
