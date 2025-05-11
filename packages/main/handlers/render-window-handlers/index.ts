import path from 'path';
import fs from 'fs/promises';
import { ChildProcess } from 'child_process';
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';
import { pathToFileURL } from 'url';

import { RenderSubtitlesOptions } from '@shared-types/app';
import { FFmpegService } from '../../services/ffmpeg-service.js';
import { getAssetsPath } from '../../../shared/helpers/paths.js';
import {
  registerAutoCancel,
  registerRenderJob,
  cancel as registryCancel,
} from '../../active-processes.js';

import { createOperationTempDir, cleanupTempDir } from './temp-utils.js';
import { initPuppeteer } from './puppeteer-setup.js';
import { generateSubtitleEvents } from './srt-parser.js';
import { generateStatePngs } from './state-generator.js';
import { directMerge } from './ffmpeg-direct-merge.js';
import { probeFps } from './ffprobe-utils.js';

const activeRenderJobs = new Map<
  string,
  { browser?: import('puppeteer').Browser; processes: ChildProcess[] }
>();
export const getActiveRenderJob = (id: string) => activeRenderJobs.get(id);

const jobControllers = new Map<string, AbortController>();

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

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

export function initializeRenderWindowHandlers(): void {
  log.info('[RenderWindowHandlers] Initialising …');

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
          const ffmpegSvc = new FFmpegService(app.getPath('temp'));
          if (await ffmpegSvc.hasVideoTrack(options.originalVideoPath)) {
            realFps = await probeFps(options.originalVideoPath);
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

        const uniqueEventsMs = generateSubtitleEvents({
          srtContent: options.srtContent,
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
          const ffmpegSvc = new FFmpegService(app.getPath('temp'));
          videoForMerge = path.join(tempDirPath, `black_${operationId}.mp4`);
          await ffmpegSvc.makeBlackVideo({
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
          progressCallback: sendProgress,
          registerProcess,
          signal: controller.signal,
        });

        const win = BrowserWindow.getAllWindows()[0];
        if (!win) {
          throw new Error(
            'Cannot show save dialog: No application window found.'
          );
        }
        const suggestedName = `${path.basename(
          options.originalVideoPath,
          path.extname(options.originalVideoPath)
        )}-merged.mp4`;

        const { canceled, filePath: userPath } = await dialog.showSaveDialog(
          win,
          {
            title: 'Save Merged Video As',
            defaultPath: suggestedName,
            filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
          }
        );

        if (canceled || !userPath) {
          log.warn(`[${operationId}] User cancelled "save" dialog`);
          await fs.unlink(tempMerged).catch(() => void 0);
          event.reply('render-subtitles-result', {
            operationId,
            success: false,
            error: 'Save cancelled by user.',
          });
          return;
        }

        await fs.rename(tempMerged, userPath);
        sendProgress({ percent: 100, stage: 'Merge complete!' });
        event.reply('render-subtitles-result', {
          operationId,
          success: true,
          outputPath: userPath,
        });
      } catch (err: any) {
        log.error(`[RenderWindowHandlers ${operationId}]`, err);
        if (!event.sender.isDestroyed()) {
          event.reply('render-subtitles-result', {
            operationId,
            success: false,
            error: err.message ?? 'Unknown error',
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
