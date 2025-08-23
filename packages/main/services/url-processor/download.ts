import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import log from 'electron-log';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import {
  registerDownloadProcess,
  finish as removeDownloadProcess,
} from '../../active-processes.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { CancelledError } from '../../../shared/cancelled-error.js';
import { ensureYtDlpBinary } from './binary-installer.js';
import { ProgressCallback, VideoQuality } from './types.js';
import { PROGRESS, qualityFormatMap } from './constants.js';
import { mapErrorToUserFriendly } from './error-map.js';
import { findFfmpeg } from '../ffmpeg-runner.js';
import { app } from 'electron';

export async function downloadVideoFromPlatform(
  url: string,
  outputDir: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    ffmpeg: FFmpegContext;
  },
  extraArgs: string[] = []
): Promise<{ filepath: string; info: any; proc: DownloadProcessType }> {
  log.info(`[URLprocessor] Starting download: ${url} (Op ID: ${operationId})`);

  if (!services?.ffmpeg) {
    throw new Error('FFmpegContext is required for downloadVideoFromPlatform');
  }

  progressCallback?.({
    percent: PROGRESS.WARMUP_START,
    stage: 'Warming up...',
  });

  const firstRunFlag = join(
    app.getPath('userData'),
    'bin',
    '.yt-dlp-initialized'
  );

  const ytDlpPath = await ensureYtDlpBinary({ skipUpdate: true });

  if (!ytDlpPath) {
    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: 'yt-dlp binary could not be set up.',
    });
    throw new Error('yt-dlp binary could not be set up.');
  }

  log.info(`[URLprocessor] yt-dlp ready at: ${ytDlpPath}`);

  progressCallback?.({
    percent: PROGRESS.WARMUP_START + 3,
    stage: 'Making binary executable…',
  });

  try {
    fs.accessSync(ytDlpPath, fs.constants.X_OK);
    log.info(`[URLprocessor] yt-dlp is executable.`);
  } catch {
    log.warn(`[URLprocessor] yt-dlp not executable, attempting chmod +x`);
    try {
      await execa('chmod', ['+x', ytDlpPath], { windowsHide: true });
      log.info(`[URLprocessor] chmod +x successful.`);
    } catch (e) {
      log.warn('[URLprocessor] Could not make yt-dlp executable:', e);
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
    log.info(`[URLprocessor] Output directory verified: ${outputDir}`);
  } catch (dirError) {
    log.error(`[URLprocessor] Output directory check failed:`, dirError);
    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: `Failed to write to output directory: ${outputDir}`,
    });
    throw new Error(`Output directory check failed: ${dirError}`);
  }

  const isYouTube = /youtube\.com|youtu\.be/.test(url);
  const isYouTubeShorts = /youtube\.com\/shorts\//.test(url);
  let effectiveQuality = quality;

  if (isYouTubeShorts && quality === 'low') {
    effectiveQuality = 'mid';
    log.info(
      `[URLprocessor] YouTube Shorts detected with 'low' quality, upgrading to 'mid'.`
    );
  }

  let formatString: string;
  if (isYouTube) {
    formatString = qualityFormatMap[effectiveQuality] || qualityFormatMap.mid;
    log.info(
      `[URLprocessor] Using YouTube format for effective quality '${effectiveQuality}': ${formatString}`
    );
  } else {
    formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    log.info(
      `[URLprocessor] Using generic MP4 format for non-YouTube URL: ${formatString}`
    );
  }

  const safeTimestamp = Date.now();
  const tempFilenamePattern = join(
    outputDir,
    `download_${safeTimestamp}_%(id)s.%(ext)s`
  );
  log.info(
    `[URLprocessor] Using simplified temp pattern: ${tempFilenamePattern}`
  );

  const ffmpegPath = await findFfmpeg();

  const args = [
    url,
    '--no-playlist',
    '--output',
    tempFilenamePattern,
    '--format',
    formatString,
    // Prefer MP4 output when possible; yt-dlp will fall back to MKV if needed
    '--merge-output-format',
    'mp4',
    // Network reliability guards to reduce initial stalls
    '--socket-timeout',
    '10',
    '--retries',
    '2',
    '--retry-sleep',
    '1',
    '--force-ipv4',
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
    `[URLprocessor] Executing yt-dlp: ${ytDlpPath} ${args.join(' ')} (Op ID: ${operationId})`
  );
  log.info(`[URLprocessor] yt-dlp intended output directory: ${outputDir}`);

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

  // Wrap download attempt flow
  try {
    let attempt = 1;
    const maxAttempts = 2;
    let lastError: any = null;

    while (attempt <= maxAttempts) {
      let startupTimeoutFired = false;
      try {
        subprocess = execa(ytDlpPath, args, {
          windowsHide: true,
          encoding: 'utf8',
          all: true,
        });

        if (subprocess) {
          registerDownloadProcess(operationId, subprocess);
          log.info(
            `[URLprocessor] Added download process ${operationId} to map.`
          );

          subprocess.on('error', (err: any) => {
            log.error(
              `[URLprocessor] Subprocess ${operationId} emitted error:`,
              err
            );
            if (removeDownloadProcess(operationId)) {
              log.info(
                `[URLprocessor] Removed download process ${operationId} from map due to subprocess error event.`
              );
            }
          });
          subprocess.on('exit', (code: number, signal: string) => {
            log.info(
              `[URLprocessor] Subprocess ${operationId} exited with code ${code}, signal ${signal}.`
            );
            if (removeDownloadProcess(operationId)) {
              log.info(
                `[URLprocessor] Removed download process ${operationId} from map due to subprocess exit event.`
              );
            }
          });
        } else {
          log.error(
            `[URLprocessor] Failed to create subprocess (Op ID: ${operationId}).`
          );
          throw new Error('Could not start yt-dlp process.');
        }

        // --- Stream Processing ---
        if (subprocess.all) {
          let firstOutputSeen = false;
          // Startup watchdog: if no output within 30s of launch, kill once and retry
          const startupTimer = setTimeout(() => {
            if (!firstOutputSeen) {
              startupTimeoutFired = true;
              try {
                subprocess?.kill('SIGTERM');
              } catch {
                // fall through
              }
              log.error(
                '[URLprocessor] Startup stall: no output from yt-dlp for 30s, will retry once'
              );
            }
          }, 30_000);

          subprocess.all.on('data', (chunk: Buffer) => {
            const chunkString = chunk.toString();
            if (!firstOutputSeen) {
              firstOutputSeen = true;
              clearTimeout(startupTimer);
            }
            // Normalize carriage returns to newlines to handle progress lines that use \r
            stdoutBuffer += chunkString.replace(/\r/g, '\n');

            // Process lines
            let newlineIndex;
            while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
              const rawLine = stdoutBuffer.substring(0, newlineIndex);
              const line = rawLine.trim();
              stdoutBuffer = stdoutBuffer.substring(newlineIndex + 1);

              if (line.startsWith('{') && line.endsWith('}')) {
                // Assume this is the final JSON output
                finalJsonOutput = line;
                log.info('[URLprocessor] Received potential JSON output.');
                // Try parsing immediately to validate
                try {
                  downloadInfo = JSON.parse(finalJsonOutput);
                  finalFilepath = downloadInfo?._filename;
                  log.info(
                    `[URLprocessor] Parsed final filename from JSON: ${finalFilepath}`
                  );
                } catch (jsonError) {
                  log.warn(
                    `[URLprocessor] Failed to parse line as JSON immediately: ${line}`,
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
                  if (
                    pct < 1 &&
                    phase === 'dl1' &&
                    lastPct > 90 &&
                    !didAutoLift
                  ) {
                    // Detect reset near 0 after potentially hitting 100
                    phase = 'dl2';
                    didAutoLift = true;
                    log.info(
                      `[URLprocessor] Phase transition detected: dl1 -> dl2 (Op ID: ${operationId})`
                    );
                  }

                  const overall =
                    phase === 'dl1'
                      ? PROGRESS.DL1_START +
                        (pct * (PROGRESS.DL1_END - PROGRESS.DL1_START)) / 100
                      : PROGRESS.FINAL_START +
                        (pct * (PROGRESS.FINAL_END - PROGRESS.FINAL_START)) /
                          100;

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
                /Downloading webpage|Extracting|Downloading player|Downloading m3u8|Downloading MPD/i.test(
                  line
                )
              ) {
                // Early warmup feedback before numeric progress appears
                const prepPercent = Math.max(
                  PROGRESS.WARMUP_END,
                  PROGRESS.WARMUP_END + 1
                );
                progressCallback?.({
                  percent: prepPercent,
                  stage: 'Fetching video info…',
                });
              } else if (
                /Merging formats/i.test(line) ||
                /merging/i.test(line)
              ) {
                // When yt-dlp is merging formats, downloading is complete
                const mergePercent = Math.min(
                  PROGRESS.FINAL_END - 2,
                  Math.max(PROGRESS.FINAL_START, PROGRESS.FINAL_START + 5)
                );
                progressCallback?.({
                  percent: mergePercent,
                  stage: 'Merging formats…',
                });
              } else if (
                /Post-?processing/i.test(line) ||
                /Fixing/i.test(line)
              ) {
                // Post-processing stage near the end
                const ppPercent = Math.min(
                  PROGRESS.FINAL_END - 1,
                  PROGRESS.FINAL_START + 8
                );
                progressCallback?.({
                  percent: ppPercent,
                  stage: 'Post-processing…',
                });
              } else if (/Destination:/i.test(line)) {
                // Early indication that output file path is determined
                const destPercent = Math.max(
                  PROGRESS.WARMUP_END + 2,
                  PROGRESS.WARMUP_END
                );
                progressCallback?.({
                  percent: destPercent,
                  stage: 'Preparing download…',
                });
              } else if (
                line.startsWith(outputDir) &&
                line.match(/\.(mp4|mkv|webm|m4a)$/i)
              ) {
                finalFilepath = line.trim();
                log.info(
                  `[URLprocessor] Got final filepath from --print: ${finalFilepath}`
                );
              }
            }
          });
        } else {
          log.error(
            `[URLprocessor] Failed to access subprocess output stream (Op ID: ${operationId}).`
          );
          throw new Error('Could not access yt-dlp output stream.');
        }

        // Wait for the process to finish, but guard against long stalls with a heartbeat
        const result: any = await Promise.race([
          subprocess,
          new Promise((_, reject) => {
            // If no progress lines for a long time, fail fast so UI can retry
            const stallMs = 30_000; // 30s without any output considered stalled
            let lastTick: number | null = null; // start monitoring only after first output
            const interval = setInterval(() => {
              if (lastTick !== null && Date.now() - lastTick > stallMs) {
                clearInterval(interval);
                try {
                  subprocess?.kill('SIGTERM');
                } catch {
                  // fall through
                }
                reject(
                  new Error('Download appears stalled (no progress for 30s)')
                );
              }
            }, 5_000);
            // Update heartbeat whenever data arrives
            subprocess?.all?.on('data', () => (lastTick = Date.now()));
            // Cleanup when finished
            subprocess
              ?.then?.(() => clearInterval(interval))
              .catch(() => clearInterval(interval));
          }),
        ]);

        log.info(
          `[URLprocessor] yt-dlp process finished with code ${result.exitCode}`
        );
        // Process any remaining data in the buffer
        if (
          stdoutBuffer.trim().startsWith('{') &&
          stdoutBuffer.trim().endsWith('}')
        ) {
          finalJsonOutput = stdoutBuffer.trim();
          log.info('[URLprocessor] Processing remaining buffer as JSON.');
          try {
            downloadInfo = JSON.parse(finalJsonOutput);
            finalFilepath = downloadInfo?._filename;
            log.info(
              `[URLprocessor] Parsed filename from final buffer: ${finalFilepath}`
            );
          } catch (jsonError) {
            log.error(
              '[URLprocessor] Error parsing final JSON from buffer:',
              jsonError
            );
            log.error(`[URLprocessor] Final buffer content: ${stdoutBuffer}`);
            throw new Error('Failed to parse final JSON output from yt-dlp.');
          }
        } else if (!finalFilepath && stdoutBuffer.trim()) {
          // Log remaining buffer if it wasn't JSON and we don't have a path yet
          log.warn(
            `[URLprocessor] yt-dlp finished with non-JSON remaining buffer: ${stdoutBuffer.trim().substring(0, 500)}...`
          );
        }

        if (!finalFilepath) {
          log.error(
            '[URLprocessor] Final filename not found in yt-dlp output.'
          );
          log.error(`[URLprocessor] Final JSON attempted: ${finalJsonOutput}`);
          throw new Error('yt-dlp did not provide a final filename in JSON.');
        }

        log.info(`[URLprocessor] Final file path determined: ${finalFilepath}`);

        progressCallback?.({
          percent: PROGRESS.FINAL_END - 5, // Use constant
          stage: 'Download complete, verifying...',
        });

        // --- File Verification ---
        if (!fs.existsSync(finalFilepath)) {
          log.error(
            `[URLprocessor] Downloaded file not found at path: ${finalFilepath}`
          );
          throw new Error(`Downloaded file not found: ${finalFilepath}`);
        }
        const stats = await fsp.stat(finalFilepath);
        if (!stats.size) {
          log.error(
            `[URLprocessor] Downloaded file is empty: ${finalFilepath}`
          );
          await fsp.unlink(finalFilepath); // Clean up empty file
          throw new Error(`Downloaded file is empty: ${finalFilepath}`);
        }
        log.info(
          `[URLprocessor] File verified: ${finalFilepath}, Size: ${stats.size}`
        );
        log.info(
          `[URLprocessor] Download successful, returning filepath: ${finalFilepath}`
        );

        // After successful download, mark initialized and trigger background self-update for future runs
        try {
          await fsp.mkdir(join(app.getPath('userData'), 'bin'), {
            recursive: true,
          });
          await fsp.writeFile(firstRunFlag, new Date().toISOString(), 'utf8');
        } catch {
          // fall through
        }
        try {
          // Fire-and-forget update; do not block user flow
          execa(ytDlpPath, ['-U', '--quiet'], {
            windowsHide: true,
            timeout: 120_000,
          }).catch(() => {});
        } catch {
          // fall through
        }

        return {
          filepath: finalFilepath,
          info: downloadInfo,
          proc: subprocess!,
        };
      } catch (error: any) {
        lastError = error;
        const wasStartupStall =
          (error?.message || '').includes('no progress for 30s') ||
          startupTimeoutFired;
        if (wasStartupStall && attempt < maxAttempts) {
          log.warn(
            `[URLprocessor] Retrying download due to startup stall (attempt ${attempt + 1}/${maxAttempts})`
          );
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error('Download failed after retries');
  } catch (error: any) {
    const rawErrorMessage = error.message || String(error);
    let userFriendlyErrorMessage = rawErrorMessage;

    // Check if this was a cancellation
    if (
      error.signal === 'SIGTERM' ||
      error.signal === 'SIGINT' ||
      error.killed ||
      // Windows taskkill generates exit code 1 with specific error messages
      (process.platform === 'win32' &&
        error.exitCode === 1 &&
        (error.message?.includes('was terminated') ||
          error.message?.includes('Command failed') ||
          rawErrorMessage.includes('taskkill'))) ||
      // Also check for common Windows termination patterns
      (process.platform === 'win32' &&
        (rawErrorMessage.includes('The process was terminated') ||
          rawErrorMessage.includes('The operation was terminated') ||
          rawErrorMessage.includes('process terminated') ||
          rawErrorMessage.includes('Terminated by user') ||
          // yt-dlp specific termination messages
          rawErrorMessage.includes('KeyboardInterrupt') ||
          rawErrorMessage.includes('Interrupted by user')))
    ) {
      log.info(
        `[URLprocessor] Download cancelled by user (Op ID: ${operationId}) - Signal: ${error.signal}, ExitCode: ${error.exitCode}`
      );
      progressCallback?.({
        percent: 0,
        stage: 'Download cancelled',
      });
      throw new CancelledError();
    }

    // If it wasn't killed, it's a real error. NOW log details and send failure progress.
    log.error(
      `[URLprocessor] Handling non-cancellation error for Op ID ${operationId}`
    );
    if (error.stderr) {
      log.error('[URLprocessor] yt-dlp STDERR:', error.stderr);
    }
    if (error.stdout) {
      log.error('[URLprocessor] yt-dlp STDOUT on error:', error.stdout);
    }
    if (error.all) {
      log.error('[URLprocessor] yt-dlp ALL on error:', error.all);
    }

    // Handle ALL OTHER (non-cancellation) errors
    log.error(
      `[URLprocessor] Handling non-termination error for Op ID ${operationId}`
    );

    // Use mapErrorToUserFriendly for error mapping
    userFriendlyErrorMessage = mapErrorToUserFriendly({
      rawErrorMessage,
      stderrContent: error.stderr || '',
    });

    log.info(
      `[URLprocessor] Determined user-friendly error: "${userFriendlyErrorMessage}"`
    );
    // --- End User-Friendly Error Mapping ---

    // Enhanced error logging (Keep this if you want detailed logs)
    log.error(`[URLprocessor] Error type: ${typeof error}`);
    log.error(`[URLprocessor] Raw error message: ${rawErrorMessage}`);
    if (error.stderr) log.error(`[URLprocessor] Error stderr: ${error.stderr}`);
    if (error.stack) log.error(`[URLprocessor] Error stack: ${error.stack}`);
    progressCallback?.({
      percent: 0,
      stage: 'Error',
      error: userFriendlyErrorMessage,
    });

    throw new Error(
      `Download failed: ${rawErrorMessage}. Check logs or contact support at mikey@stage5.tools`
    );
  } finally {
    if (removeDownloadProcess(operationId)) {
      log.info(
        `[URLprocessor] Removed download process ${operationId} from map in finally block.`
      );
    } else {
      log.warn(
        `[URLprocessor] Process ${operationId} not found in map during finally block (already removed or never added).`
      );
    }
  }
}
