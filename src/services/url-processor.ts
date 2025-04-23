import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execa } from 'execa';
import log from 'electron-log';
import { app } from 'electron';
import { fileURLToPath } from 'url';
import { FFmpegService } from './ffmpeg-service.js';
import { FileManager } from './file-manager.js';
import {
  addDownloadProcess,
  removeDownloadProcess,
  hasDownloadProcess,
  type DownloadProcessType,
} from '../main/active-processes.js';

export type VideoQuality = 'low' | 'mid' | 'high';
const qualityFormatMap: Record<VideoQuality, string> = {
  high: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
  mid: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]',
  low: 'best[height<=480]',
};

type ProgressCallback = (info: {
  percent: number;
  stage: string;
  error?: string | null;
}) => void;

// --- Progress Constants ---
const PROGRESS = {
  WARMUP_START: 0,
  WARMUP_END: 10,

  DL1_START: 10,
  DL1_END: 40,

  FINAL_START: 40,
  FINAL_END: 100,
} as const;
// --- End Progress Constants ---

log.info('[URLProcessor] MODULE LOADED');

// Locate the yt-dlp binary in dev/production modes
async function findYtDlpBinary(): Promise<string | null> {
  try {
    const exeExt = process.platform === 'win32' ? '.exe' : '';
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const isPackaged = app.isPackaged;

    // Mac/Linux direct path in packaged mode
    if (
      (process.platform === 'darwin' || process.platform === 'linux') &&
      isPackaged
    ) {
      const unpacked = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        `yt-dlp${exeExt}`
      );
      if (fs.existsSync(unpacked)) {
        try {
          await execa('chmod', ['+x', unpacked]);
        } catch {
          // If chmod fails, might still be executable
        }
        return unpacked;
      }
    }

    // Additional fallback paths
    const possiblePaths: string[] = [
      path.join(
        moduleDir,
        '..',
        '..',
        'node_modules',
        'youtube-dl-exec',
        'bin',
        `yt-dlp${exeExt}`
      ),
      isPackaged
        ? path.join(
            app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
            'node_modules',
            'youtube-dl-exec',
            'bin',
            `yt-dlp${exeExt}`
          )
        : '',
      isPackaged
        ? path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'node_modules',
            'youtube-dl-exec',
            'bin',
            `yt-dlp${exeExt}`
          )
        : '',
      `yt-dlp${exeExt}`,
    ].filter(Boolean);

    for (const binPath of possiblePaths) {
      if (fs.existsSync(binPath)) {
        if (process.platform !== 'win32') {
          try {
            fs.accessSync(binPath, fs.constants.X_OK);
          } catch {
            try {
              await execa('chmod', ['+x', binPath]);
            } catch {
              continue; // Not executable, move on
            }
          }
        }
        return binPath;
      }
    }
    return null;
  } catch (error) {
    log.error('[URLProcessor] Error finding yt-dlp binary:', error);
    return null;
  }
}

// Optionally update to the latest yt-dlp
export async function updateYtDlp(): Promise<boolean> {
  try {
    const binPath = await findYtDlpBinary();
    if (!binPath) return false;
    const { stdout } = await execa(binPath, ['--update']);
    return stdout.includes('up to date') || stdout.includes('updated');
  } catch (error) {
    log.error('[URLProcessor] Failed to update yt-dlp:', error);
    return false;
  }
}

// Download video from a URL using yt-dlp
async function downloadVideoFromPlatform(
  url: string,
  outputDir: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    ffmpegService: FFmpegService;
  }
): Promise<{ filepath: string; info: any }> {
  log.info(`[URLProcessor] Starting download: ${url} (Op ID: ${operationId})`);

  if (!services?.ffmpegService) {
    throw new Error('FFmpegService is required for downloadVideoFromPlatform');
  }
  const { ffmpegService } = services;

  progressCallback?.({
    percent: PROGRESS.WARMUP_START,
    stage: 'Locating yt-dlp...',
  });

  const ytDlpPath = await findYtDlpBinary();
  if (!ytDlpPath) {
    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: 'yt-dlp binary not found.',
    });
    throw new Error('yt-dlp binary not found.');
  }
  log.info(`[URLProcessor] Found yt-dlp at: ${ytDlpPath}`);

  progressCallback?.({
    percent: PROGRESS.WARMUP_START + 3,
    stage: 'Making binary executable…',
  });

  try {
    fs.accessSync(ytDlpPath, fs.constants.X_OK);
    log.info(`[URLProcessor] yt-dlp is executable.`);
  } catch {
    log.warn(`[URLProcessor] yt-dlp not executable, attempting chmod +x`);
    try {
      await execa('chmod', ['+x', ytDlpPath]);
      log.info(`[URLProcessor] chmod +x successful.`);
    } catch (e) {
      log.warn('[URLProcessor] Could not make yt-dlp executable:', e);
      // Proceed anyway, it might work depending on system config
    }
  }

  progressCallback?.({
    percent: PROGRESS.WARMUP_START + 7,
    stage: 'Preparing output directory…',
  });

  try {
    await fsp.mkdir(outputDir, { recursive: true });
    const testFile = path.join(outputDir, `test_${Date.now()}.tmp`);
    await fsp.writeFile(testFile, 'test');
    await fsp.unlink(testFile);
    log.info(`[URLProcessor] Output directory verified: ${outputDir}`);
  } catch (dirError) {
    log.error(`[URLProcessor] Output directory check failed:`, dirError);
    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: `Failed to write to output directory: ${outputDir}`,
    });
    throw new Error(`Output directory check failed: ${dirError}`);
  }

  // --- Determine Format String --- START ---
  const isYouTube = /youtube\.com|youtu\.be/.test(url);
  const isYouTubeShorts = /youtube\.com\/shorts\//.test(url); // Added check for Shorts
  let effectiveQuality = quality; // Use a mutable variable for quality

  // Upgrade quality for Shorts if 'low' is selected
  if (isYouTubeShorts && quality === 'low') {
    effectiveQuality = 'mid';
    log.info(
      `[URLProcessor] YouTube Shorts detected with 'low' quality, upgrading to 'mid'.`
    );
  }

  let formatString: string;
  if (isYouTube) {
    // Use effectiveQuality for format lookup
    formatString = qualityFormatMap[effectiveQuality] || qualityFormatMap.high;
    log.info(
      `[URLProcessor] Using YouTube format for effective quality '${effectiveQuality}': ${formatString}`
    );
  } else {
    // For non-YouTube, use a more robust generic MP4 preference with fallbacks
    formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    log.info(
      `[URLProcessor] Using generic MP4 format for non-YouTube URL: ${formatString}`
    );
  }
  // --- Determine Format String --- END ---

  // Use a simplified, ASCII-safe temporary name pattern
  const safeTimestamp = Date.now();
  const tempFilenamePattern = path.join(
    outputDir,
    `download_${safeTimestamp}_%(id)s.%(ext)s` // Simple pattern using timestamp and ID
  );
  log.info(
    `[URLProcessor] Using simplified temp pattern: ${tempFilenamePattern}`
  );

  const ffmpegPath = ffmpegService.getFFmpegPath();

  const args = [
    url,
    '--no-playlist',
    '--output',
    tempFilenamePattern,
    '--format',
    formatString,
    '--progress',
    '--newline',
    '--no-check-certificates',
    '--no-warnings',
    '--print',
    'after_move:%(filepath)s',
    '--ffmpeg-location',
    ffmpegPath,
  ];

  log.info(
    `[URLProcessor] Executing yt-dlp: ${ytDlpPath} ${args.join(' ')} (Op ID: ${operationId})`
  );
  log.info(`[URLProcessor] yt-dlp intended output directory: ${outputDir}`);

  progressCallback?.({
    percent: PROGRESS.WARMUP_END,
    stage: 'Starting download...',
  });

  let finalJsonOutput = '';
  let stdoutBuffer = '';
  let finalFilepath: string | null = null;
  let downloadInfo: any = null;
  let didAutoLift = false;

  let subprocess: DownloadProcessType | null = null;
  let phase: 'dl1' | 'dl2' = 'dl1'; // Track download phase
  let lastPct = 0; // Track last reported percentage outside subprocess

  try {
    subprocess = execa(ytDlpPath, args, {
      windowsHide: true,
      encoding: 'utf8',
      all: true,
    });

    if (subprocess) {
      addDownloadProcess(operationId, subprocess);
      log.info(`[URLProcessor] Added download process ${operationId} to map.`);

      subprocess.on('error', (err: any) => {
        log.error(
          `[URLProcessor] Subprocess ${operationId} emitted error:`,
          err
        );
        if (hasDownloadProcess(operationId)) {
          removeDownloadProcess(operationId);
          log.info(
            `[URLProcessor] Removed download process ${operationId} from map due to subprocess error event.`
          );
        }
      });
      subprocess.on('exit', (code: number, signal: string) => {
        log.info(
          `[URLProcessor] Subprocess ${operationId} exited with code ${code}, signal ${signal}.`
        );
        if (hasDownloadProcess(operationId)) {
          removeDownloadProcess(operationId);
          log.info(
            `[URLProcessor] Removed download process ${operationId} from map due to subprocess exit event.`
          );
        }
      });
    } else {
      throw new Error('Failed to start download subprocess.');
    }

    // --- Stream Processing ---
    if (subprocess.all) {
      subprocess.all.on('data', (chunk: Buffer) => {
        const chunkString = chunk.toString();
        stdoutBuffer += chunkString;

        // Process lines
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
          const line = stdoutBuffer.substring(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);

          if (line.startsWith('{') && line.endsWith('}')) {
            // Assume this is the final JSON output
            finalJsonOutput = line;
            log.info('[URLProcessor] Received potential JSON output.');
            // Try parsing immediately to validate
            try {
              downloadInfo = JSON.parse(finalJsonOutput);
              finalFilepath = downloadInfo?._filename;
              log.info(
                `[URLProcessor] Parsed final filename from JSON: ${finalFilepath}`
              );
            } catch (jsonError) {
              log.warn(
                `[URLProcessor] Failed to parse line as JSON immediately: ${line}`,
                jsonError
              );
              finalJsonOutput = ''; // Reset if parsing failed
              downloadInfo = null;
              finalFilepath = null;
            }
          } else if (line.startsWith('[download]')) {
            const progressMatch = line.match(/([\d.]+)%/);
            if (progressMatch && progressMatch[1]) {
              const pct = parseFloat(progressMatch[1]);

              // Phase detection using external lastPct
              if (pct < 1 && phase === 'dl1' && lastPct > 90 && !didAutoLift) {
                // Detect reset near 0 after potentially hitting 100
                phase = 'dl2';
                didAutoLift = true;
                log.info(
                  `[URLProcessor] Phase transition detected: dl1 -> dl2 (Op ID: ${operationId})`
                );
              }

              const overall =
                phase === 'dl1'
                  ? PROGRESS.DL1_START +
                    (pct * (PROGRESS.DL1_END - PROGRESS.DL1_START)) / 100
                  : PROGRESS.FINAL_START +
                    (pct * (PROGRESS.FINAL_END - PROGRESS.FINAL_START)) / 100;

              const displayPercent = Math.min(
                PROGRESS.FINAL_END - 1,
                Math.max(PROGRESS.WARMUP_END, overall)
              );

              progressCallback?.({
                percent: displayPercent,
                stage: 'Downloading...',
              });
              lastPct = pct;
            }
          } else if (
            line.startsWith(outputDir) &&
            line.match(/\.(mp4|mkv|webm|m4a)$/i)
          ) {
            finalFilepath = line.trim();
            log.info(
              `[URLProcessor] Got final filepath from --print: ${finalFilepath}`
            );
          }
        }
      });
    } else {
      log.error(
        `[URLProcessor] Failed to access subprocess output stream (Op ID: ${operationId}).`
      );
      throw new Error('Could not access yt-dlp output stream.');
    }

    // Wait for the process to finish
    const result = await subprocess;

    log.info(
      `[URLProcessor] yt-dlp process finished with code ${result.exitCode}`
    );
    // Process any remaining data in the buffer
    if (
      stdoutBuffer.trim().startsWith('{') &&
      stdoutBuffer.trim().endsWith('}')
    ) {
      finalJsonOutput = stdoutBuffer.trim();
      log.info('[URLProcessor] Processing remaining buffer as JSON.');
      try {
        downloadInfo = JSON.parse(finalJsonOutput);
        finalFilepath = downloadInfo?._filename;
        log.info(
          `[URLProcessor] Parsed filename from final buffer: ${finalFilepath}`
        );
      } catch (jsonError) {
        log.error(
          '[URLProcessor] Error parsing final JSON from buffer:',
          jsonError
        );
        log.error(`[URLProcessor] Final buffer content: ${stdoutBuffer}`);
        throw new Error('Failed to parse final JSON output from yt-dlp.');
      }
    } else if (!finalFilepath && stdoutBuffer.trim()) {
      // Log remaining buffer if it wasn't JSON and we don't have a path yet
      log.warn(
        `[URLProcessor] yt-dlp finished with non-JSON remaining buffer: ${stdoutBuffer.trim().substring(0, 500)}...`
      );
    }

    if (!finalFilepath) {
      log.error('[URLProcessor] Final filename not found in yt-dlp output.');
      log.error(`[URLProcessor] Final JSON attempted: ${finalJsonOutput}`);
      throw new Error('yt-dlp did not provide a final filename in JSON.');
    }

    log.info(`[URLProcessor] Final file path determined: ${finalFilepath}`);

    progressCallback?.({
      percent: PROGRESS.FINAL_END - 5, // Use constant
      stage: 'Download complete, verifying...',
    });

    // --- File Verification ---
    if (!fs.existsSync(finalFilepath)) {
      log.error(
        `[URLProcessor] Downloaded file not found at path: ${finalFilepath}`
      );
      throw new Error(`Downloaded file not found: ${finalFilepath}`);
    }
    const stats = await fsp.stat(finalFilepath);
    if (!stats.size) {
      log.error(`[URLProcessor] Downloaded file is empty: ${finalFilepath}`);
      await fsp.unlink(finalFilepath); // Clean up empty file
      throw new Error(`Downloaded file is empty: ${finalFilepath}`);
    }
    log.info(
      `[URLProcessor] File verified: ${finalFilepath}, Size: ${stats.size}`
    );
    log.info(
      `[URLProcessor] Download successful, returning filepath: ${finalFilepath}`
    );

    return { filepath: finalFilepath, info: downloadInfo };
  } catch (error: any) {
    log.error(
      `[URLProcessor] Download execution error (Op ID: ${operationId}):`,
      error
    );

    // *** CHECK FOR CANCELLATION FIRST ***
    if (error.killed || error.signal === 'SIGTERM') {
      log.info(
        `[URLProcessor] Download process ${operationId} was killed/terminated (likely cancelled).`
      );
      // Throw a clean error for cancellations, preventing large stdout propagation
      throw new Error('Download cancelled by user');
    }
    // *** END CANCELLATION CHECK ***

    // If it wasn't killed, it's a real error. NOW log details and send failure progress.
    log.error(
      `[URLProcessor] Handling non-cancellation error for Op ID ${operationId}`
    );
    if (error.stderr) {
      log.error('[URLProcessor] yt-dlp STDERR:', error.stderr);
    }
    if (error.stdout) {
      log.error('[URLProcessor] yt-dlp STDOUT on error:', error.stdout);
    }
    if (error.all) {
      log.error('[URLProcessor] yt-dlp ALL on error:', error.all);
    }

    // Handle ALL OTHER (non-cancellation) errors
    log.error(
      `[URLProcessor] Handling non-termination error for Op ID ${operationId}`
    );

    // --- Start User-Friendly Error Mapping ---
    let userFriendlyErrorMessage =
      'Download failed. Please check the URL/connection or contact support at mikey@stage5society.com'; // <-- UPDATED fallback
    const rawErrorMessage =
      error.message || (typeof error === 'string' ? error : 'Unknown error');
    const stderrContent = error.stderr || '';

    const combinedErrorText =
      `${rawErrorMessage}\n${stderrContent}`.toLowerCase();

    // Check for common patterns (keep existing checks)
    if (combinedErrorText.includes('unsupported url')) {
      userFriendlyErrorMessage = 'This website or URL is not supported.';
    } else if (combinedErrorText.includes('video unavailable')) {
      userFriendlyErrorMessage = 'This video is unavailable.';
    } else if (combinedErrorText.includes('this video is private')) {
      userFriendlyErrorMessage = 'This video is private.';
    } else if (combinedErrorText.includes('http error 404')) {
      userFriendlyErrorMessage = 'Video not found at this URL (404 Error).';
    } else if (combinedErrorText.includes('invalid url')) {
      userFriendlyErrorMessage = 'The URL format appears invalid.';
    } else if (
      combinedErrorText.includes('name or service not known') ||
      combinedErrorText.includes('temporary failure in name resolution') ||
      combinedErrorText.includes('network is unreachable')
    ) {
      userFriendlyErrorMessage =
        'Network error. Please check your internet connection.';
    } else if (combinedErrorText.includes('unable to download video data')) {
      userFriendlyErrorMessage =
        'Failed to download video data. The video might be region-locked or require login.';
    }
    // You can add more 'else if' conditions here for other specific errors

    log.info(
      `[URLProcessor] Determined user-friendly error: "${userFriendlyErrorMessage}"`
    );
    // --- End User-Friendly Error Mapping ---

    // Enhanced error logging (Keep this if you want detailed logs)
    log.error(`[URLProcessor] Error type: ${typeof error}`);
    log.error(`[URLProcessor] Raw error message: ${rawErrorMessage}`);
    if (error.stderr)
      log.error(`[URLProcessor] Error stderr: ${stderrContent}`);
    if (error.stack) log.error(`[URLProcessor] Error stack: ${error.stack}`);
    progressCallback?.({
      percent: 0, // Indicate failure
      stage: 'Error',
      error: userFriendlyErrorMessage, // Use the mapped message (now with email fallback)
    });

    // Return the standard error object for the main promise result
    // (Keep the detailed message here for potential debugging/logging later)
    throw new Error(
      `Download failed: ${rawErrorMessage}. Check logs or contact support at mikey@stage5society.com`
    );
  } finally {
    if (hasDownloadProcess(operationId)) {
      removeDownloadProcess(operationId);
      log.info(
        `[URLProcessor] Removed download process ${operationId} from map in finally block.`
      );
    } else {
      log.warn(
        `[URLProcessor] Process ${operationId} not found in map during finally block (already removed or never added?).`
      );
    }
  }
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    fileManager: FileManager;
    ffmpegService: FFmpegService;
  }
): Promise<{
  videoPath: string;
  filename: string;
  size: number;
  fileUrl: string;
  originalVideoPath: string;
}> {
  log.info(`[URLProcessor] processVideoUrl CALLED (Op ID: ${operationId})`);

  // Use provided FileManager to get tempDir
  if (!services?.fileManager) {
    throw new Error('FileManager instance is required for processVideoUrl');
  }
  const tempDir = services.fileManager.getTempDir();
  log.info(
    `[URLProcessor] processVideoUrl using tempDir from FileManager: ${tempDir}`
  );

  // Use provided FFmpegService
  if (!services?.ffmpegService) {
    throw new Error('FFmpegService instance is required for processVideoUrl');
  }
  const { ffmpegService } = services; // Get ffmpegService

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  const { filepath } = await downloadVideoFromPlatform(
    url,
    tempDir,
    quality,
    progressCallback,
    operationId,
    { ffmpegService }
  );
  const stats = await fsp.stat(filepath);
  const filename = path.basename(filepath);
  progressCallback?.({
    percent: PROGRESS.FINAL_END,
    stage: 'Download complete',
  }); // Use constant

  return {
    videoPath: filepath,
    filename,
    size: stats.size,
    fileUrl: `file://${filepath}`,
    originalVideoPath: filepath,
  };
}
