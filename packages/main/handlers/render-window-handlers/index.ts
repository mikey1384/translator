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
        const suggestedName = `${path.basename(
          options.originalVideoPath,
          path.extname(options.originalVideoPath)
        )}-merged.mp4`;

        let heartbeatPercent = 96;
        let heartbeatStage = 'Waiting for save location…';
        const saveHeartbeat = setInterval(() => {
          sendProgress({ percent: heartbeatPercent, stage: heartbeatStage });
        }, HEARTBEAT_INTERVAL_MS);

        let canceled = false;
        let userPath: string | undefined;
        try {
          const mergedSizeBytes = (await fs.stat(tempMerged)).size;

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

            // Destination disk space preflight: warn before a potentially long copy/rename.
            try {
              const destDir = path.dirname(userPath);
              const stat = await fs.statfs(destDir);
              const destFreeBytes = Number(stat.bavail) * Number(stat.bsize);

              const SAFETY_MULTIPLIER = 1.1; // "around" the need
              const warnBelowBytes = mergedSizeBytes * SAFETY_MULTIPLIER;

              if (
                mergedSizeBytes > 0 &&
                destFreeBytes > 0 &&
                destFreeBytes <= warnBelowBytes
              ) {
                const lang = getLanguagePreference().toLowerCase();
                const isKo = lang.startsWith('ko');

                const title = isKo ? '저장공간 부족' : 'Low Disk Space';
                const message = isKo
                  ? '선택한 저장 위치의 여유 공간이 부족할 수 있습니다.'
                  : 'The selected save location may not have enough free space.';
                const detail = isKo
                  ? `필요: 약 ${formatBytes(mergedSizeBytes)}\n남은 공간: 약 ${formatBytes(destFreeBytes)}\n\n계속 진행할까요?`
                  : `Need ~${formatBytes(mergedSizeBytes)} free\nAvailable ~${formatBytes(destFreeBytes)}\n\nContinue anyway?`;

                const { response } = await dialog.showMessageBox(win, {
                  type: 'warning',
                  title,
                  message,
                  detail,
                  buttons: isKo
                    ? ['다른 위치 선택', '계속', '취소']
                    : ['Choose another location', 'Continue', 'Cancel'],
                  defaultId: 1,
                  cancelId: 2,
                  noLink: true,
                });

                if (response === 1) {
                  // Continue
                  break;
                }
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
                // Cancel
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
            } catch {
              // Best-effort only: never block saving if the check fails.
            }

            break;
          }

          sendProgress({ percent: 98, stage: 'Saving…' });
          heartbeatPercent = 98;
          heartbeatStage = 'Saving…';
          try {
            await fs.rename(tempMerged, userPath);
          } catch (moveErr: any) {
            // Cross-device move (e.g. temp dir → external drive / iCloud) requires copy+unlink.
            if (moveErr?.code === 'EXDEV') {
              heartbeatStage = 'Copying to destination…';
              sendProgress({ percent: 98, stage: heartbeatStage });
              await fs.copyFile(tempMerged, userPath);
              await fs.unlink(tempMerged).catch(() => void 0);
            } else {
              throw moveErr;
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
