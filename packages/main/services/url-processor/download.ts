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
import {
  ensureYtDlpBinary,
  YtDlpSetupError,
  type BinarySetupProgress,
} from './binary-installer.js';
import { ProgressCallback, VideoQuality } from './types.js';
import { PROGRESS, qualityFormatMap } from './constants.js';
import { mapErrorToUserFriendly } from './error-map.js';
import { findFfmpeg } from '../ffmpeg-runner.js';
import { app } from 'electron';

/**
 * Clean up partial/incomplete download files matching a timestamp pattern.
 * Called when downloads fail or are cancelled to prevent disk cruft.
 */
async function cleanupPartialDownloads(
  outputDir: string,
  timestamp: number,
  operationId: string
): Promise<void> {
  const prefix = `download_${timestamp}_`;
  try {
    const files = await fsp.readdir(outputDir);
    const matchingFiles = files.filter(f => f.startsWith(prefix));
    if (matchingFiles.length === 0) {
      log.debug(
        `[URLprocessor ${operationId}] No partial download files to clean up for timestamp ${timestamp}`
      );
      return;
    }
    log.info(
      `[URLprocessor ${operationId}] Cleaning up ${matchingFiles.length} partial download file(s) for timestamp ${timestamp}`
    );
    await Promise.all(
      matchingFiles.map(async file => {
        const filePath = join(outputDir, file);
        try {
          await fsp.unlink(filePath);
          log.info(
            `[URLprocessor ${operationId}] Deleted partial file: ${file}`
          );
        } catch (unlinkError: any) {
          log.warn(
            `[URLprocessor ${operationId}] Failed to delete partial file ${file}: ${unlinkError.message}`
          );
        }
      })
    );
  } catch (readError: any) {
    log.warn(
      `[URLprocessor ${operationId}] Failed to read output dir for cleanup: ${readError.message}`
    );
  }
}

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
    await execa(ytDlpPath, ['--version'], {
      windowsHide: true,
      timeout: 120_000,
    });
    log.info('[URLprocessor] yt-dlp warmup complete');
  } catch (e: any) {
    log.warn(
      '[URLprocessor] yt-dlp warmup failed (continuing):',
      e?.message || e
    );
  }
}

async function warmupFfmpeg(ffmpegPath: string): Promise<void> {
  try {
    await unblockIfMarked(ffmpegPath);
    await execa(ffmpegPath, ['-version'], {
      windowsHide: true,
      timeout: 60_000,
    });
    log.info('[URLprocessor] ffmpeg warmup complete');
  } catch (e: any) {
    log.warn(
      '[URLprocessor] ffmpeg warmup failed (continuing):',
      e?.message || e
    );
  }
}

function hardKill(proc: any): void {
  try {
    proc?.kill('SIGTERM');
  } catch {
    // ignore
  }
  if (process.platform === 'win32' && proc?.pid) {
    execa('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
      windowsHide: true,
    }).catch(() => {});
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
  for (const key of [
    'NODE_OPTIONS',
    'NPM_CONFIG_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
  ]) {
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

  const firstRunFlag = join(
    app.getPath('userData'),
    'bin',
    '.yt-dlp-initialized'
  );

  // Progress callback for binary setup (maps to warmup range 0-8%)
  const binarySetupProgress: BinarySetupProgress = info => {
    // Map binary setup progress to warmup range
    const basePercent = PROGRESS.WARMUP_START + 1;
    const maxPercent = PROGRESS.WARMUP_START + 8;
    let percent = basePercent;
    if (info.percent !== undefined) {
      // Scale binary download progress (0-100) to warmup range (1-8)
      percent = basePercent + (info.percent / 100) * (maxPercent - basePercent);
    }
    progressCallback?.({
      percent: Math.min(maxPercent, percent),
      stage: info.stage,
    });
  };

  const skipUpdateEnv =
    process.env.TRANSLATOR_YTDLP_SKIP_UPDATE === '1' ||
    process.env.YTDLP_SKIP_UPDATE === '1';
  let ytDlpPath: string;
  try {
    ytDlpPath = await ensureYtDlpBinary({
      skipUpdate: skipUpdateEnv,
      onProgress: binarySetupProgress,
    });
  } catch (error: any) {
    const baseMessage = error?.message || 'yt-dlp binary could not be set up.';
    const attemptedUrl =
      error instanceof YtDlpSetupError
        ? error.attemptedUrl
        : (error?.attemptedUrl as string | undefined);
    const detailedMessage =
      attemptedUrl && attemptedUrl.length > 0
        ? `${baseMessage} (tried: ${attemptedUrl})`
        : baseMessage;

    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: detailedMessage,
    });
    throw new Error(detailedMessage);
  }

  if (!ytDlpPath) {
    const fallbackMessage =
      'yt-dlp binary could not be set up. Please check the application logs for details.';
    progressCallback?.({
      percent: 0,
      stage: 'Failed',
      error: fallbackMessage,
    });
    throw new Error(fallbackMessage);
  }

  log.info(`[URLprocessor] yt-dlp ready at: ${ytDlpPath}`);

  // Continue warmup flow
  progressCallback?.({
    percent: PROGRESS.WARMUP_START + 8,
    stage: 'yt-dlp ready…',
  });

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
      percent: PROGRESS.WARMUP_START + 8.5,
      stage: 'Preparing video engine…',
    });
    try {
      await warmupYtDlp(ytDlpPath);
      const ffmpegPathWarm = await findFfmpeg();
      await warmupFfmpeg(ffmpegPathWarm);
      // Mark initialized right after successful warmup so later timeouts are normal
      await fsp.mkdir(join(app.getPath('userData'), 'bin'), {
        recursive: true,
      });
      await fsp.writeFile(firstRunFlag, new Date().toISOString(), 'utf8');
      isFirstRun = false; // ensure subsequent logic in this session uses normal timeouts
    } catch {
      // continue; we'll still use relaxed timeouts this run
    }
  }

  if (!isWindows) {
    progressCallback?.({
      percent: PROGRESS.WARMUP_START + 8.5,
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
    percent: PROGRESS.WARMUP_START + 9,
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

  let currentFormat = formatString;
  const mp4FallbackFormat = 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best';
  let forcedMp4Fallback = false;

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
  try {
    await unblockIfMarked(ytDlpPath);
  } catch {
    // ignore
  }
  try {
    await unblockIfMarked(ffmpegPath);
  } catch {
    // ignore
  }
  log.info(
    `[URLprocessor] ffmpeg at ${ffmpegPath} exists=${fs.existsSync(ffmpegPath)}`
  );

  // Re-warm binaries when their mtime changes (e.g., after app update)
  try {
    const stampPath = join(
      app.getPath('userData'),
      'bin',
      '.binary-stamp.json'
    );
    const [ytStat, ffStat] = await Promise.all([
      fsp.stat(ytDlpPath).catch(() => null),
      fsp.stat(ffmpegPath).catch(() => null),
    ]);
    const currentStamp = {
      ytDlpMtimeMs: ytStat?.mtimeMs ?? 0,
      ffmpegMtimeMs: ffStat?.mtimeMs ?? 0,
    };
    let prevStamp: { ytDlpMtimeMs: number; ffmpegMtimeMs: number } | null =
      null;
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
      } catch {
        // ignore
      }
      try {
        await warmupFfmpeg(ffmpegPath);
      } catch {
        // ignore
      }
      await fsp.mkdir(join(app.getPath('userData'), 'bin'), {
        recursive: true,
      });
      await fsp.writeFile(stampPath, JSON.stringify(currentStamp), 'utf8');
    }
  } catch {
    // ignore
  }

  // Decide container behavior: for high quality, avoid forcing MP4 so we can fetch
  // the truly highest formats (often VP9/AV1 in WebM/MKV). For mid/low, prefer MP4.
  let containerArgs =
    effectiveQuality === 'high' ? [] : ['--merge-output-format', 'mp4'];
  const defaultContainerArgs = [...containerArgs];

  // Prefer highest resolution/codec/fps explicitly for high quality
  let sortArgs =
    effectiveQuality === 'high' ? ['-S', 'res,codec:av1:vp9:avc,fps'] : [];
  let extractorArgs: string[] = [];
  let extractorMode: 'web' | 'ios' | 'android' = 'web';

  // Respect user-supplied --force-ipv4/--force-ipv6 if present in extraArgs.
  // Otherwise, start with no forcing (let OS decide).
  let ipMode: 'auto' | 'v4' | 'v6' = extraArgs.some(a => a === '--force-ipv4')
    ? 'v4'
    : extraArgs.some(a => a === '--force-ipv6')
      ? 'v6'
      : 'auto';

  function buildBaseArgs(): string[] {
    return [
      url,
      '--ignore-config',
      '--no-playlist',
      '--output',
      tempFilenamePattern,
      '--format',
      currentFormat,
      // Container preference (omit for high to avoid restricting format selection)
      ...containerArgs,
      // Sorting preference for absolute best (may be cleared on fallback)
      ...sortArgs,
      // Fallback extractor tweaks (e.g., forcing iOS client)
      ...extractorArgs,
      // Network reliability guards to reduce initial stalls
      '--socket-timeout',
      '10',
      '--retries',
      '3',
      '--retry-sleep',
      '1',
      '--color',
      'never',
      '--progress',
      '--newline',
      '--no-warnings',
      '--print',
      'after_move:%(filepath)s',
      '--ffmpeg-location',
      ffmpegPath,
      '--no-cache-dir',
      ...extraArgs,
    ];
  }

  function stripIpOverrides(args: string[]): string[] {
    return args.filter(arg => arg !== '--force-ipv4' && arg !== '--force-ipv6');
  }

  function withIpArgs(mode: typeof ipMode) {
    const ipArgs =
      mode === 'v4' ? ['--force-ipv4'] : mode === 'v6' ? ['--force-ipv6'] : [];
    const base = stripIpOverrides(buildBaseArgs());
    return [...base, ...ipArgs];
  }

  log.info(`[URLprocessor] yt-dlp intended output directory: ${outputDir}`);

  progressCallback?.({
    percent: PROGRESS.WARMUP_END,
    stage: 'Starting download...',
  });

  let finalJsonOutput = '';
  let stdoutBuffer = '';
  let diagnosticLog = '';
  let finalFilepath: string | null = null;
  let downloadInfo: any = null;

  let subprocess: DownloadProcessType | null = null;
  let lastPct = 0; // Track last reported percentage outside subprocess
  let addNoCheckCertificates = false; // enable on final retry only if TLS errors suspected

  // Wrap download attempt flow
  try {
    let attempt = 1;
    const maxAttempts = 5; // Baseline + ios + android + sort removal + format downgrade
    let lastError: any = null;

    while (attempt <= maxAttempts) {
      let startupTimeoutFired = false;
      const firstAttemptExtra = attempt === 1 ? ['--verbose'] : [];
      const lastResortExtra =
        attempt === maxAttempts
          ? [
              '--concurrent-fragments',
              '1',
              '--http-chunk-size',
              '1M',
              ...(addNoCheckCertificates ? ['--no-check-certificates'] : []),
            ]
          : [];
      const args = [
        ...withIpArgs(ipMode),
        ...firstAttemptExtra,
        ...lastResortExtra,
      ];
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
            const normalized = chunkString.replace(/\r/g, '\n');
            stdoutBuffer += normalized;
            diagnosticLog += normalized;

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
                  // Single-phase mapping: 10 → 95 (monotonic)
                  const mapped =
                    PROGRESS.DL1_START +
                    (pct * (PROGRESS.DL1_END - PROGRESS.DL1_START)) / 100;
                  const displayPercent = Math.min(
                    PROGRESS.DL1_END,
                    Math.max(PROGRESS.WARMUP_END, mapped)
                  );

                  // Monotonic guard
                  if (displayPercent > lastPct) {
                    lastPct = displayPercent;
                    progressCallback?.({
                      percent: displayPercent,
                      stage: 'Downloading...',
                    });
                  }
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
                if (prepPercent > lastPct) {
                  lastPct = prepPercent;
                  progressCallback?.({
                    percent: prepPercent,
                    stage: 'Fetching video info…',
                  });
                }
              } else if (
                /Merging formats/i.test(line) ||
                /merging/i.test(line)
              ) {
                // When yt-dlp is merging formats, downloading is complete
                const mergePercent = Math.min(
                  PROGRESS.FINAL_START + 2,
                  PROGRESS.FINAL_END - 2
                );
                if (mergePercent > lastPct) {
                  lastPct = mergePercent;
                  progressCallback?.({
                    percent: mergePercent,
                    stage: 'Merging formats…',
                  });
                }
              } else if (
                /Post-?processing/i.test(line) ||
                /Fixing/i.test(line)
              ) {
                // Post-processing stage near the end
                const ppPercent = Math.min(
                  PROGRESS.FINAL_START + 4,
                  PROGRESS.FINAL_END - 1
                );
                if (ppPercent > lastPct) {
                  lastPct = ppPercent;
                  progressCallback?.({
                    percent: ppPercent,
                    stage: 'Post-processing…',
                  });
                }
              } else if (/Destination:/i.test(line)) {
                // Early indication that output file path is determined
                const destPercent = PROGRESS.WARMUP_END + 2;
                if (destPercent > lastPct) {
                  lastPct = destPercent;
                  progressCallback?.({
                    percent: destPercent,
                    stage: 'Preparing download…',
                  });
                }
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
                  new Error(
                    `Download appears stalled (no progress for ${Math.round(stallMs / 1000)}s)`
                  )
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
          percent: PROGRESS.FINAL_START + 3,
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
        if (!skipUpdateEnv) {
          try {
            // Fire-and-forget update; do not block user flow
            // Delay the update by a few seconds to ensure file handles are released
            setTimeout(() => {
              execa(ytDlpPath, ['-U', '--quiet'], {
                windowsHide: true,
                timeout: 120_000,
                stdio: 'ignore',
                shell: false,
              }).catch(error => {
                log.debug(
                  '[URLprocessor] Background update failed:',
                  error.message
                );
              });
            }, 3000);
          } catch {
            // fall through
          }
        }

        // Final 100% tick
        progressCallback?.({ percent: 100, stage: 'Completed' });

        return {
          filepath: finalFilepath,
          info: downloadInfo,
          proc: subprocess!,
        };
      } catch (error: any) {
        lastError = error;
        try {
          (error as any).all = diagnosticLog;
          (error as any).stdout = diagnosticLog;
        } catch {
          // ignore
        }
        const wasStartupStall =
          (error?.message || '').includes(
            'Download appears stalled (no progress for'
          ) || startupTimeoutFired;
        // If we suspect TLS/certificate issues, enable no-check-certificates for the final retry
        const errorBlob = `${error?.message || ''}\n${error?.stderr || ''}\n${error?.stdout || ''}`;
        const looksLikeTLSError = /SSL|CERTIFICATE|TLS|handshake/i.test(
          errorBlob
        );
        if (looksLikeTLSError) {
          addNoCheckCertificates = true;
        }
        const looksLikeFormatMissing =
          /Requested format is not available/i.test(errorBlob);
        const looksLikeNsigFailure =
          /nsig/i.test(errorBlob) ||
          /Initial JS player n function/i.test(errorBlob);
        if (
          looksLikeFormatMissing &&
          forcedMp4Fallback &&
          attempt < maxAttempts
        ) {
          log.warn(
            '[URLprocessor] MP4 fallback still missing requested format; allowing non-MP4 variants again.'
          );
          currentFormat = formatString;
          containerArgs = [...defaultContainerArgs];
          forcedMp4Fallback = false;
          attempt += 1;
          continue;
        }
        const treatAsExtractorIssue =
          looksLikeNsigFailure ||
          (looksLikeFormatMissing && !forcedMp4Fallback);
        if (treatAsExtractorIssue && attempt < maxAttempts) {
          if (extractorMode === 'web') {
            extractorMode = 'ios';
            extractorArgs = ['--extractor-args', 'youtube:player_client=ios'];
            log.warn(
              '[URLprocessor] Retrying with youtube:player_client=ios extractor fallback.'
            );
            attempt += 1;
            continue;
          }
          if (extractorMode === 'ios') {
            extractorMode = 'android';
            extractorArgs = [
              '--extractor-args',
              'youtube:player_client=android,player_skip=1',
            ];
            log.warn(
              '[URLprocessor] Retrying with youtube:player_client=android extractor fallback.'
            );
            attempt += 1;
            continue;
          }
          if (sortArgs.length) {
            sortArgs = [];
            log.warn(
              '[URLprocessor] Retrying without custom sort preference due to extractor failure.'
            );
            attempt += 1;
            continue;
          }
          if (
            currentFormat === formatString &&
            formatString !== mp4FallbackFormat
          ) {
            currentFormat = mp4FallbackFormat;
            containerArgs = ['--merge-output-format', 'mp4'];
            forcedMp4Fallback = true;
            log.warn(
              '[URLprocessor] Retrying with simplified format selection (best MP4 fallback).'
            );
            attempt += 1;
            continue;
          }
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
      // Clean up partial download files before throwing
      await cleanupPartialDownloads(outputDir, safeTimestamp, operationId);
      throw new CancelledError();
    }

    // If it wasn't killed, it's a real error. NOW log details.
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

    // Use mapErrorToUserFriendly for error mapping (prefer combined stream)
    userFriendlyErrorMessage = mapErrorToUserFriendly({
      rawErrorMessage,
      stderrContent:
        (error.all as string) || error.stderr || diagnosticLog || '',
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
    if ((error as any).all || diagnosticLog)
      log.error(
        `[URLprocessor] Error ALL: ${(error as any).all || diagnosticLog}`
      );
    // Re-throw original ExecaError so upstream can inspect combined output
    error.userFriendly = userFriendlyErrorMessage;
    try {
      (error as any).all = (error as any).all || diagnosticLog;
    } catch {
      // ignore
    }
    // Clean up partial download files before throwing
    await cleanupPartialDownloads(outputDir, safeTimestamp, operationId);
    throw error;
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
