import path from 'path';
import fs from 'fs/promises';
import { ChildProcess } from 'child_process';
import { ipcMain, dialog, app } from 'electron';
import log from 'electron-log';
import { pathToFileURL } from 'url';

import { RenderSubtitlesOptions } from '@shared-types/app';
import type { FFmpegContext } from '../../services/ffmpeg-runner.js';
import { getAssetsPath } from '../../../shared/helpers/paths.js';
import {
  registerAutoCancel,
  registerRenderJob,
  cancel as registryCancel,
} from '../../active-processes.js';

import { createOperationTempDir, cleanupTempDir } from './temp-utils.js';
import { initPuppeteer } from './puppeteer-setup.js';
import { generateSubtitleEvents } from './srt-parser.js';
import { parseSrt, buildSrt } from '../../../shared/helpers/index.js';
import { normalizeSubtitleSegments } from '../../services/subtitle-processing/pipeline/finalize-pass.js';
import { generateStatePngs } from './state-generator.js';
import { directMerge } from './ffmpeg-direct-merge.js';
import { probeFps } from './ffprobe-utils.js';
import { getFocusedOrMainWindow } from '../../utils/window.js';
import { getMainT } from '../../utils/i18n.js';
import { HEARTBEAT_INTERVAL_MS } from '../../../shared/constants/runtime-config.js';
import { ERROR_CODES } from '../../../shared/constants/index.js';
import { settingsStore } from '../../store/settings-store.js';

const activeRenderJobs = new Map<
  string,
  { browser?: import('puppeteer').Browser; processes: ChildProcess[] }
>();
export const getActiveRenderJob = (id: string) => activeRenderJobs.get(id);

const jobControllers = new Map<string, AbortController>();

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

function getLanguagePreference(): string {
  // 1) Respect saved preference
  if (settingsStore.has('app_language_preference')) {
    return String(settingsStore.get('app_language_preference', 'en'));
  }

  // 2) Detect system locale (keep region)
  const raw = (
    app.getPreferredSystemLanguages?.()[0] ||
    app.getLocale() ||
    'en'
  )
    .replace('_', '-')
    .trim();
  const ln = raw.toLowerCase();

  // 3) Special handling for Chinese so we don't lose the script/region
  if (ln.startsWith('zh')) {
    // Map traditional locales to zh-TW; default to zh-CN otherwise
    if (
      ln.includes('tw') ||
      ln.includes('hk') ||
      ln.includes('mo') ||
      ln.includes('hant')
    ) {
      return 'zh-TW';
    }
    return 'zh-CN';
  }

  // 4) Fall back to base language (en, es, fr, etc.)
  const base = ln.split('-')[0];
  return base || 'en';
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = unitIndex <= 1 ? 0 : value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function formatTimestampForFilename(d = new Date()): string {
  // Avoid ":" and other chars that are illegal on Windows.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}` +
    `${pad2(d.getMonth() + 1)}` +
    `${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function renameExistingFileToBackup(
  existingPath: string,
  operationId: string
): Promise<string | null> {
  try {
    const st = await fs.stat(existingPath);
    if (!st.isFile()) return null;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }

  const dir = path.dirname(existingPath);
  const ext = path.extname(existingPath);
  const base = path.basename(existingPath, ext);
  const stamp = formatTimestampForFilename();

  let backupPath = path.join(dir, `${base}.backup-${stamp}${ext}`);
  let attempt = 1;
  while (await fileExists(backupPath)) {
    backupPath = path.join(dir, `${base}.backup-${stamp}-${attempt}${ext}`);
    attempt += 1;
  }

  await fs.rename(existingPath, backupPath);
  log.warn(
    `[${operationId}] Destination already existed; moved previous file to: ${backupPath}`
  );
  return backupPath;
}

function normalizeRenderFailure(
  err: unknown,
  signal?: AbortSignal
): { error: string; cancelled?: boolean } {
  // Signal cancellation always wins.
  if (signal?.aborted) {
    return { error: 'Cancelled', cancelled: true };
  }

  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'error' in err
          ? String((err as any).error)
          : String(err);

  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as any).code)
      : '';

  const isDiskFull =
    message === ERROR_CODES.INSUFFICIENT_DISK_SPACE ||
    code === 'ENOSPC' ||
    /\bENOSPC\b/i.test(message) ||
    /no space left on device/i.test(message) ||
    /disk quota exceeded/i.test(message);

  if (isDiskFull) return { error: ERROR_CODES.INSUFFICIENT_DISK_SPACE };

  const cancelled = /cancel/i.test(message);
  return {
    error: message || 'Unknown error',
    cancelled: cancelled || undefined,
  };
}

export function initializeRenderWindowHandlers({
  ffmpeg,
}: {
  ffmpeg: FFmpegContext;
}): void {
  log.info('[RenderWindowHandlers] Initialising …');

  async function makeBlackVideo({
    out,
    w,
    h,
    fps,
    dur,
  }: {
    out: string;
    w: number;
    h: number;
    fps: number;
    dur: number;
  }) {
    await ffmpeg.run(
      [
        '-f',
        'lavfi',
        '-i',
        `color=c=black:s=${w}x${h}:r=${fps}`,
        '-t',
        String(dur),
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-an',
        out,
      ],
      { operationId: 'makeBlackVideo' }
    );
  }

  ipcMain.on(
    'render-subtitles-request',
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] render-subtitles-request received`
      );

      const controller = new AbortController();
      jobControllers.set(operationId, controller);

      activeRenderJobs.set(operationId, { processes: [] });

      const renderHandle = {
        processes: [] as ChildProcess[],
        browser: undefined as any,
      };
      registerRenderJob(operationId, renderHandle);

      registerAutoCancel(operationId, event.sender, () =>
        cancelRenderJob(operationId)
      );

      let tempDirPath: string | null = null;
      let browser: import('puppeteer').Browser | null = null;

      const sendProgress = ({
        percent,
        stage,
        error,
      }: {
        percent: number;
        stage: string;
        error?: string;
      }) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('merge-subtitles-progress', {
            operationId,
            percent,
            stage,
            error,
          });
        }
      };

      const registerProcess = (p: ChildProcess) => {
        activeRenderJobs.get(operationId)?.processes.push(p);
        renderHandle.processes.push(p);
      };

      try {
        tempDirPath = await createOperationTempDir({ operationId });

        // Guard width/height to ensure they are not zero for audio-only files
        if (!options.videoWidth || options.videoWidth <= 0)
          options.videoWidth = 1280;
        if (!options.videoHeight || options.videoHeight <= 0)
          options.videoHeight = 720;

        const { browser: br, page } = await initPuppeteer({
          operationId,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          fontRegular,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
        });
        browser = br;
        activeRenderJobs.get(operationId)!.browser = browser;
        renderHandle.browser = browser;

        if (!options.originalVideoPath) {
          throw new Error(
            'Original video path is required but was not provided.'
          );
        }

        log.info(
          `[RenderWindowHandlers ${operationId}] Probing FPS for ${options.originalVideoPath}...`
        );
        let realFps = options.frameRate || 30;
        try {
          if (await ffmpeg.hasVideoTrack(options.originalVideoPath)) {
            realFps = await probeFps(
              options.originalVideoPath,
              ffmpeg.ffprobePath
            );
          }
        } catch (err) {
          log.warn(
            `[${operationId}] Could not probe FPS, falling back to ${realFps}`,
            err
          );
        }
        log.info(
          `[RenderWindowHandlers ${operationId}] Detected real FPS: ${realFps}`
        );
        options.frameRate = realFps;

        // Finalize subtitles just before render: join <5s gaps and enforce >=3s per cue
        sendProgress({ percent: 5, stage: 'Finalizing subtitles…' });
        const parsedForFinalize = parseSrt(options.srtContent);
        const normalizedSegs = normalizeSubtitleSegments(parsedForFinalize);
        const finalizedSrt = buildSrt({
          segments: normalizedSegs,
          mode: 'dual',
        });

        const uniqueEventsMs = generateSubtitleEvents({
          srtContent: finalizedSrt,
          outputMode: (options.outputMode ?? 'dual') as 'dual' | 'single',
          videoDuration: options.videoDuration,
          operationId,
        });

        const statePngs = await generateStatePngs({
          page,
          events: uniqueEventsMs,
          operationId,
          tempDirPath,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          displayWidth: options.displayWidth ?? options.videoWidth,
          displayHeight: options.displayHeight ?? options.videoHeight,
          fps: realFps,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
          progress: sendProgress,
          signal: controller.signal,
        });
        try {
          await page.close();
        } catch {
          /* already closed */
        }

        sendProgress({
          percent: 10,
          stage: 'Assembling subtitle overlay video...',
        });

        const concatListPath = path.join(
          tempDirPath,
          `pngs_${operationId}.txt`
        );
        await writeConcat({ frames: statePngs, listPath: concatListPath });
        sendProgress({ percent: 40, stage: 'Overlay concat ready' });

        let videoForMerge = options.originalVideoPath;
        if (options.overlayMode === 'blackVideo') {
          videoForMerge = path.join(tempDirPath, `black_${operationId}.mp4`);
          await makeBlackVideo({
            out: videoForMerge,
            w: options.videoWidth,
            h: options.videoHeight,
            fps: realFps,
            dur: options.videoDuration,
          });
        }

        const tempMerged = path.join(tempDirPath, `merged_${operationId}.mp4`);
        await directMerge({
          concatListPath,
          baseVideoPath: videoForMerge,
          audioPath:
            options.overlayMode === 'blackVideo'
              ? options.originalVideoPath
              : undefined,
          outputSavePath: tempMerged,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          videoDuration: options.videoDuration,
          operationId,
          ffmpegPath: ffmpeg.ffmpegPath,
          progressCallback: sendProgress,
          registerProcess,
          signal: controller.signal,
        });

        const win = getFocusedOrMainWindow();
        if (!win) {
          throw new Error(
            'Cannot show save dialog: No application window found.'
          );
        }
        try {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        } catch {
          /* noop */
        }
        const baseName = path.basename(
          options.originalVideoPath,
          path.extname(options.originalVideoPath)
        );
        const suggestedName = `${baseName}-merged-${formatTimestampForFilename()}.mp4`;

        let heartbeatPercent = 96;
        let heartbeatStage = 'Waiting for save location…';
        const saveHeartbeat = setInterval(() => {
          sendProgress({ percent: heartbeatPercent, stage: heartbeatStage });
        }, HEARTBEAT_INTERVAL_MS);

        let canceled = false;
        let userPath: string | undefined;
        try {
          const srcStat = await fs.stat(tempMerged);
          const mergedSizeBytes = srcStat.size;
          const srcDev = srcStat.dev;

          sendProgress({
            percent: 96,
            stage: 'Choose where to save the video…',
          });

          // eslint-disable-next-line no-constant-condition
          while (true) {
            ({ canceled, filePath: userPath } = await dialog.showSaveDialog(
              win,
              {
                title: 'Save Merged Video As',
                defaultPath: suggestedName,
                filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
              }
            ));

            if (canceled || !userPath) {
              log.warn(`[${operationId}] User cancelled "save" dialog`);
              await fs.unlink(tempMerged).catch(() => void 0);
              event.reply('render-subtitles-result', {
                operationId,
                success: false,
                error: 'Cancelled',
                cancelled: true,
              });
              return;
            }

            sendProgress({ percent: 98, stage: 'Saving…' });
            heartbeatPercent = 98;
            heartbeatStage = 'Saving…';
            const destDir = path.dirname(userPath);
            let sameDevice = false;
            try {
              sameDevice = (await fs.stat(destDir)).dev === srcDev;
            } catch {
              // If we can't stat, assume cross-device and fall back to copy.
              sameDevice = false;
            }

            if (sameDevice) {
              let backupPath: string | null = null;
              try {
                // Avoid overwriting existing files (which can create `.fuse_hidden*` on FUSE mounts).
                backupPath = await renameExistingFileToBackup(
                  userPath,
                  operationId
                );
                await fs.rename(tempMerged, userPath);
                break;
              } catch (saveErr: any) {
                if (backupPath) {
                  try {
                    const [destExists, backupExists] = await Promise.all([
                      fileExists(userPath),
                      fileExists(backupPath),
                    ]);
                    if (!destExists && backupExists) {
                      await fs.rename(backupPath, userPath);
                    }
                  } catch (restoreErr) {
                    log.warn(
                      `[${operationId}] Failed to restore existing destination after save error`,
                      restoreErr
                    );
                  }
                }
                log.warn(
                  `[${operationId}] Failed to save merged video to ${userPath}`,
                  saveErr
                );
                heartbeatPercent = 96;
                heartbeatStage = 'Waiting for save location…';
                sendProgress({
                  percent: heartbeatPercent,
                  stage: heartbeatStage,
                });
                continue;
              }
            }

            // Cross-device save (e.g. temp dir → external drive / iCloud): copy+rename.
            // Destination disk space preflight: only relevant when we must copy bytes.
            try {
              const stat = await fs.statfs(destDir);
              const destFreeBytes = Number(stat.bavail) * Number(stat.bsize);

              const SAFETY_MULTIPLIER = 1.1; // "around" the need
              const warnBelowBytes = mergedSizeBytes * SAFETY_MULTIPLIER;

              if (
                mergedSizeBytes > 0 &&
                destFreeBytes > 0 &&
                destFreeBytes <= warnBelowBytes
              ) {
                const lang = getLanguagePreference();
                const t = await getMainT(lang);

                const message = t(
                  'dialogs.mergeLowDiskSpaceConfirm',
                  {
                    need: formatBytes(mergedSizeBytes),
                    free: formatBytes(destFreeBytes),
                  },
                  'Low disk space detected. This merge may need ~{{need}} free space, but only ~{{free}} is available. Continue anyway?'
                );

                const { response } = await dialog.showMessageBox(win, {
                  type: 'warning',
                  title: app.getName(),
                  message,
                  buttons: [
                    t(
                      'common.chooseAnotherLocation',
                      undefined,
                      'Choose another location'
                    ),
                    t('common.continue', undefined, 'Continue'),
                    t('common.cancel', undefined, 'Cancel'),
                  ],
                  defaultId: 1,
                  cancelId: 2,
                  noLink: true,
                });

                if (response === 0) {
                  // Choose another location
                  heartbeatPercent = 96;
                  heartbeatStage = 'Waiting for save location…';
                  sendProgress({
                    percent: heartbeatPercent,
                    stage: heartbeatStage,
                  });
                  continue;
                }
                if (response === 2) {
                  // Cancel (abort save)
                  log.warn(
                    `[${operationId}] User cancelled due to low disk space warning`
                  );
                  await fs.unlink(tempMerged).catch(() => void 0);
                  event.reply('render-subtitles-result', {
                    operationId,
                    success: false,
                    error: 'Cancelled',
                    cancelled: true,
                  });
                  return;
                }
                // Continue (copy)
              }
            } catch {
              // Best-effort only: never block saving if the check fails.
            }

            const tempDest = path.join(
              destDir,
              `translator_tmp_${operationId}_${Date.now()}.mp4`
            );
            let backupPath: string | null = null;
            try {
              // Same rationale as above: avoid truncating/replacing an existing file in-place.
              backupPath = await renameExistingFileToBackup(
                userPath,
                operationId
              );

              heartbeatStage = 'Copying to destination…';
              sendProgress({ percent: 98, stage: heartbeatStage });
              await fs.copyFile(tempMerged, tempDest);
              await fs.rename(tempDest, userPath);
              await fs.unlink(tempMerged).catch(() => void 0);
              break;
            } catch (copyErr: any) {
              await fs.unlink(tempDest).catch(() => void 0);

              if (backupPath) {
                try {
                  const [destExists, backupExists] = await Promise.all([
                    fileExists(userPath),
                    fileExists(backupPath),
                  ]);
                  if (!destExists && backupExists) {
                    await fs.rename(backupPath, userPath);
                  }
                } catch (restoreErr) {
                  log.warn(
                    `[${operationId}] Failed to restore existing destination after copy error`,
                    restoreErr
                  );
                }
              }

              log.warn(
                `[${operationId}] Failed to copy merged video to ${userPath}`,
                copyErr
              );
              heartbeatPercent = 96;
              heartbeatStage = 'Waiting for save location…';
              sendProgress({
                percent: heartbeatPercent,
                stage: heartbeatStage,
              });
              continue;
            }
          }
        } finally {
          clearInterval(saveHeartbeat);
        }
        sendProgress({ percent: 100, stage: 'Merge complete!' });
        event.reply('render-subtitles-result', {
          operationId,
          success: true,
          outputPath: userPath,
        });
      } catch (err: any) {
        log.error(`[RenderWindowHandlers ${operationId}]`, err);
        if (!event.sender.isDestroyed()) {
          const normalized = normalizeRenderFailure(err, controller.signal);
          event.reply('render-subtitles-result', {
            operationId,
            success: false,
            error: normalized.error,
            cancelled: normalized.cancelled,
          });
        }
      } finally {
        try {
          await browser?.close();
        } catch {
          /* noop */
        }
        await cleanupTempDir({ tempDirPath, operationId });
        activeRenderJobs.delete(operationId);
        jobControllers.delete(operationId);
      }
    }
  );

  ipcMain.on('render-subtitles-cancel', (_event, { operationId }) => {
    cancelRenderJob(operationId);
  });

  log.info('[RenderWindowHandlers] IPC handlers ready');
}

function cancelRenderJob(operationId: string) {
  log.warn(`[render-cancel] cancelling ${operationId}`);
  jobControllers.get(operationId)?.abort();
  jobControllers.delete(operationId);
  registryCancel(operationId).catch(err =>
    log.error(`[render-cancel] failed:`, err)
  );
}

async function writeConcat({
  frames,
  listPath,
}: {
  frames: Array<{ path: string; duration: number }>;
  listPath: string;
}) {
  let out = 'ffconcat version 1.0\n\n';
  for (const f of frames) {
    const relativePath = path
      .relative(path.dirname(listPath), f.path)
      .replace(/\\/g, '/');
    out += `file '${relativePath}'\n`;
    out += `duration ${f.duration.toFixed(6)}\n\n`;
  }

  if (frames.length > 0) {
    const lastRelativePath = path
      .relative(path.dirname(listPath), frames.at(-1)!.path)
      .replace(/\\/g, '/');
    out += `file '${lastRelativePath}'\n`;
  }
  await fs.writeFile(listPath, out, 'utf8');
  log.info(`[writeConcat] Wrote PNG concat list to ${listPath}`);
}
