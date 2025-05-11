import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import { FFmpegService } from '../ffmpeg-service.js';
import {
  registerDownloadProcess,
  finish as removeDownloadProcess,
} from '../../active-processes.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { CancelledError } from '../../../shared/cancelled-error.js';
import { findYtDlpBinary } from './binary-locator.js';
import { ProgressCallback, VideoQuality } from './types.js';
import { PROGRESS, qualityFormatMap } from './constants.js';
import { mapErrorToUserFriendly } from './error-map.js';

export async function downloadVideoFromPlatform(
  url: string,
  outputDir: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    ffmpegService: FFmpegService;
  },
  extraArgs: string[] = []
): Promise<{ filepath: string; info: any; proc: DownloadProcessType }> {
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
    const testFile = join(outputDir, `test_${Date.now()}.tmp`);
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
  const tempFilenamePattern = join(
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
    ...extraArgs,
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
      registerDownloadProcess(operationId, subprocess);
      log.info(`[URLProcessor] Added download process ${operationId} to map.`);

      subprocess.on('error', (err: any) => {
        log.error(
          `[URLProcessor] Subprocess ${operationId} emitted error:`,
          err
        );
        if (removeDownloadProcess(operationId)) {
          log.info(
            `[URLProcessor] Removed download process ${operationId} from map due to subprocess error event.`
          );
        }
      });
      subprocess.on('exit', (code: number, signal: string) => {
        log.info(
          `[URLProcessor] Subprocess ${operationId} exited with code ${code}, signal ${signal}.`
        );
        if (removeDownloadProcess(operationId)) {
          log.info(
            `[URLProcessor] Removed download process ${operationId} from map due to subprocess exit event.`
          );
        }
      });
    } else {
      log.error(
        `[URLProcessor] Failed to create subprocess (Op ID: ${operationId}).`
      );
      throw new Error('Could not start yt-dlp process.');
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

    return { filepath: finalFilepath, info: downloadInfo, proc: subprocess! };
  } catch (error: any) {
    const rawErrorMessage = error.message || String(error);
    let userFriendlyErrorMessage = rawErrorMessage;

    // Check if this was a cancellation
    if (
      error.signal === 'SIGTERM' ||
      error.signal === 'SIGINT' ||
      error.killed
    ) {
      log.info(
        `[URLProcessor] Download cancelled by user (Op ID: ${operationId})`
      );
      progressCallback?.({
        percent: 0,
        stage: 'Download cancelled',
      });
      throw new CancelledError();
    }

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

    // Use mapErrorToUserFriendly for error mapping
    userFriendlyErrorMessage = mapErrorToUserFriendly({
      rawErrorMessage,
      stderrContent: error.stderr || '',
    });

    log.info(
      `[URLProcessor] Determined user-friendly error: "${userFriendlyErrorMessage}"`
    );
    // --- End User-Friendly Error Mapping ---

    // Enhanced error logging (Keep this if you want detailed logs)
    log.error(`[URLProcessor] Error type: ${typeof error}`);
    log.error(`[URLProcessor] Raw error message: ${rawErrorMessage}`);
    if (error.stderr) log.error(`[URLProcessor] Error stderr: ${error.stderr}`);
    if (error.stack) log.error(`[URLProcessor] Error stack: ${error.stack}`);
    progressCallback?.({
      percent: 0,
      stage: 'Error',
      error: userFriendlyErrorMessage,
    });

    throw new Error(
      `Download failed: ${rawErrorMessage}. Check logs or contact support at mikey@stage5society.com`
    );
  } finally {
    if (removeDownloadProcess(operationId)) {
      log.info(
        `[URLProcessor] Removed download process ${operationId} from map in finally block.`
      );
    } else {
      log.warn(
        `[URLProcessor] Process ${operationId} not found in map during finally block (already removed or never added).`
      );
    }
  }
}
