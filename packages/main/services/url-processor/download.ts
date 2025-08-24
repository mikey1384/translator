import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { join, isAbsolute, normalize } from 'node:path';
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

// Warmup helpers for Windows first-run delays
async function unblockIfMarked(filePath: string): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    await execa(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `if (Get-Item -LiteralPath '${filePath.replace(/'/g, "''")}' -Stream Zone.Identifier -ErrorAction SilentlyContinue) { Unblock-File -LiteralPath '${filePath.replace(/'/g, "''")}'; }`,
      ],
      { windowsHide: true, timeout: 30_000 }
    ).catch(() => {});
  } catch {
    // ignore
  }
}

async function warmupYtDlp(ytDlpPath: string): Promise<void> {
  try {
    await unblockIfMarked(ytDlpPath);
    await execa(ytDlpPath, ['--version'], { windowsHide: true, timeout: 120_000 });
    log.info('[URLprocessor] yt-dlp warmup complete');
  } catch (e: any) {
    log.warn('[URLprocessor] yt-dlp warmup failed (continuing):', e?.message || e);
  }
}

async function warmupFfmpeg(ffmpegPath: string): Promise<void> {
  try {
    await unblockIfMarked(ffmpegPath);
    await execa(ffmpegPath, ['-version'], { windowsHide: true, timeout: 60_000 });
    log.info('[URLprocessor] ffmpeg warmup complete');
  } catch (e: any) {
    log.warn('[URLprocessor] ffmpeg warmup failed (continuing):', e?.message || e);
  }
}

function hardKill(proc: any): void {
  try {
    proc?.kill('SIGTERM');
  } catch {
    // ignore
  }
  if (process.platform === 'win32' && proc?.pid) {
    execa('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  }
}

// Sanitize child process environment for packaged runs to avoid proxy/CA/Python pollution
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete env[key];
  }
  for (const key of ['REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE']) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete env[key];
  }
  for (const key of ['PYTHONHOME', 'PYTHONPATH', 'PYTHONSTARTUP']) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete env[key];
  }
  // Node/npm flags that can affect child runtime/proxying in packaged builds
  for (const key of ['NODE_OPTIONS', 'NPM_CONFIG_PROXY', 'NPM_CONFIG_HTTPS_PROXY']) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete env[key];
  }
  return env;
}

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

  // Detect first run on Windows and pre-warm to avoid SmartScreen/Defender delay
  const isWindows = process.platform === 'win32';
  const wasFirstRun = isWindows
    ? !(await fsp
        .access(firstRunFlag)
        .then(() => true)
        .catch(() => false))
    : false;
  let isFirstRun = wasFirstRun;

  if (isWindows && wasFirstRun) {
    progressCallback?.({
      percent: PROGRESS.WARMUP_START + 2,
      stage: 'Preparing video engine…',
    });
    try {
      await warmupYtDlp(ytDlpPath);
      const ffmpegPathWarm = await findFfmpeg();
      await warmupFfmpeg(ffmpegPathWarm);
      // Mark initialized right after successful warmup so later timeouts are normal
      await fsp.mkdir(join(app.getPath('userData'), 'bin'), { recursive: true });
      await fsp.writeFile(firstRunFlag, new Date().toISOString(), 'utf8');
      isFirstRun = false; // ensure subsequent logic in this session uses normal timeouts
    } catch {
      // continue; we'll still use relaxed timeouts this run
    }
  }

  if (!isWindows) {
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
  // Ensure binaries are unblocked on Windows every run (cheap + idempotent)
  try { await unblockIfMarked(ytDlpPath); } catch {}
  try { await unblockIfMarked(ffmpegPath); } catch {}
  log.info(`[URLprocessor] ffmpeg at ${ffmpegPath} exists=${fs.existsSync(ffmpegPath)}`);

  // Re-warm binaries when their mtime changes (e.g., after app update)
  try {
    const stampPath = join(app.getPath('userData'), 'bin', '.binary-stamp.json');
    const [ytStat, ffStat] = await Promise.all([
      fsp.stat(ytDlpPath).catch(() => null),
      fsp.stat(ffmpegPath).catch(() => null),
    ]);
    const currentStamp = {
      ytDlpMtimeMs: ytStat?.mtimeMs ?? 0,
      ffmpegMtimeMs: ffStat?.mtimeMs ?? 0,
    };
    let prevStamp: { ytDlpMtimeMs: number; ffmpegMtimeMs: number } | null = null;
    try {
      const raw = await fsp.readFile(stampPath, 'utf8');
      prevStamp = JSON.parse(raw);
    } catch {
      prevStamp = null;
    }
    const changed =
      !prevStamp ||
      prevStamp.ytDlpMtimeMs !== currentStamp.ytDlpMtimeMs ||
      prevStamp.ffmpegMtimeMs !== currentStamp.ffmpegMtimeMs;
    if (changed) {
      try {
        await warmupYtDlp(ytDlpPath);
      } catch {}
      try {
        await warmupFfmpeg(ffmpegPath);
      } catch {}
      await fsp.mkdir(join(app.getPath('userData'), 'bin'), { recursive: true });
      await fsp.writeFile(stampPath, JSON.stringify(currentStamp), 'utf8');
    }
  } catch {}

  const baseArgs = [
    url,
    '--ignore-config',
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
    '3', // Reduced from 5 to surface issues faster than watchdog
    '--retries',
    '3',
    '--retry-sleep',
    '1',
    '--color',
    'never',
    '--progress',
    '--newline',
    // Allow TLS verification (safer). Only disable if you hit a specific edge case.
    '--no-warnings',
    '--print',
    'after_move:%(filepath)s',
    '--ffmpeg-location',
    ffmpegPath,
    '--no-cache-dir',
    ...extraArgs,
  ];

  // Respect user-supplied --force-ipv4/--force-ipv6 if present in extraArgs.
  // Otherwise, start with no forcing (let OS decide).
  let ipMode: 'auto' | 'v4' | 'v6' = extraArgs.some(a => a === '--force-ipv4') ? 'v4'
    : extraArgs.some(a => a === '--force-ipv6') ? 'v6'
    : 'auto';

  function withIpArgs(mode: typeof ipMode) {
    const ipArgs = mode === 'v4' ? ['--force-ipv4'] : mode === 'v6' ? ['--force-ipv6'] : [];
    return [...baseArgs.filter(a => a !== '--force-ipv4' && a !== '--force-ipv6'), ...ipArgs];
  }

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
  let addNoCheckCertificates = false; // enable on final retry only if TLS errors suspected

  // Wrap download attempt flow
  try {
    let attempt = 1;
    const maxAttempts = 3; // Give ourselves one extra try for IP fallback
    let lastError: any = null;

    while (attempt <= maxAttempts) {
      let startupTimeoutFired = false;
      const firstAttemptExtra = attempt === 1 ? ['--verbose'] : [];
      const lastResortExtra = attempt === maxAttempts
        ? [
            '--concurrent-fragments',
            '1',
            '--http-chunk-size',
            '1M',
            ...(addNoCheckCertificates ? ['--no-check-certificates'] : []),
          ]
        : [];
      const args = [...withIpArgs(ipMode), ...firstAttemptExtra, ...lastResortExtra];
      log.info(`[URLprocessor] Spawning yt-dlp with cwd=${outputDir}`);

      log.info(
        `[URLprocessor] Executing yt-dlp (attempt ${attempt}, IP mode: ${ipMode}): ${ytDlpPath} ${args.join(' ')} (Op ID: ${operationId})`
      );
      
      try {
        subprocess = execa(ytDlpPath, args, {
          windowsHide: true,
          encoding: 'utf8',
          all: true,
          buffer: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: outputDir,
          env: {
            ...childEnv(),
            PYTHONUNBUFFERED: '1',
            PYTHONIOENCODING: 'utf-8',
          },
        });

        if (subprocess?.pid) {
          log.info(`[URLprocessor] yt-dlp PID: ${subprocess.pid}`);
        }

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
          let debugLines = 0;
          // Startup watchdog: adapt timeout on first Windows run; allow more time in packaged env
          const STARTUP_TIMEOUT_MS = isWindows && isFirstRun ? 60_000 : 35_000;
          const startupTimer = setTimeout(() => {
            if (!firstOutputSeen) {
              startupTimeoutFired = true;
              hardKill(subprocess);
              log.error(
                `[URLprocessor] Startup stall: no output from yt-dlp for ${STARTUP_TIMEOUT_MS / 1000}s, will retry once`
              );
            }
          }, STARTUP_TIMEOUT_MS);

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

              if (attempt === 1 && debugLines < 3 && line) {
                log.debug(`[yt-dlp:first] ${line}`);
                debugLines++;
              }

              if (
                line.startsWith('{') &&
                line.endsWith('}') &&
                /"_filename"|"_type"|"_version"/.test(line)
              ) {
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
              } else if (/\.(mp4|mkv|webm|m4a)$/i.test(line)) {
                const maybePath = line.trim();
                if (isAbsolute(maybePath)) {
                  finalFilepath = normalize(maybePath);
                  log.info(
                    `[URLprocessor] Got final filepath from --print: ${finalFilepath}`
                  );
                }
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
        // Adapt stall heartbeat for first Windows run; keep ahead of startup timeout to avoid races
        const STALL_MS = isWindows && isFirstRun ? 90_000 : 40_000;
        const result: any = await Promise.race([
          subprocess,
          new Promise((_, reject) => {
            // If no progress lines for a long time, fail fast so UI can retry
            const stallMs = STALL_MS; // adaptive without any output considered stalled
            let lastTick: number | null = null; // start monitoring only after first output
            const interval = setInterval(() => {
              if (lastTick !== null && Date.now() - lastTick > stallMs) {
                clearInterval(interval);
                hardKill(subprocess);
                reject(
                  new Error(`Download appears stalled (no progress for ${Math.round(stallMs / 1000)}s)`) 
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
          // Delay the update by a few seconds to ensure file handles are released
          setTimeout(() => {
            execa(ytDlpPath, ['-U', '--quiet'], {
              windowsHide: true,
              timeout: 120_000,
              stdio: 'ignore',
              shell: false,
            }).catch((error) => {
              log.debug('[URLprocessor] Background update failed:', error.message);
            });
          }, 3000);
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
          (error?.message || '').includes('Download appears stalled (no progress for') ||
          startupTimeoutFired;
        // If we suspect TLS/certificate issues, enable no-check-certificates for the final retry
        const errorBlob = `${error?.message || ''}\n${error?.stderr || ''}\n${error?.stdout || ''}`;
        const looksLikeTLSError = /SSL|CERTIFICATE|TLS|handshake/i.test(errorBlob);
        if (looksLikeTLSError) {
          addNoCheckCertificates = true;
        }
        if (wasStartupStall && attempt < maxAttempts) {
          // Flip IP strategy: auto → v6 → v4
          ipMode = ipMode === 'auto' ? 'v6' : ipMode === 'v6' ? 'v4' : 'v4';
          log.warn(
            `[URLprocessor] Startup stall; retrying with IP mode: ${ipMode} (attempt ${attempt + 1}/${maxAttempts})`
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
