import path from 'path';
import fs from 'fs/promises';
import { ChildProcess } from 'child_process';
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';
import { pathToFileURL } from 'url';

import { RenderSubtitlesOptions } from '@shared-types/app';
import { FFmpegService } from '../../services/ffmpeg-service.js';
import { getAssetsPath } from '../../shared/helpers/paths.js';

import {
  createOperationTempDir,
  cleanupTempDir,
} from './render-helpers/temp-utils.js';
import { initPuppeteer } from './render-helpers/puppeteer-setup.js';
import { generateSubtitleEvents } from './render-helpers/srt-parser.js';
import { generateStatePngs } from './render-helpers/state-generator.js';
import { directMerge } from './render-helpers/ffmpeg-direct-merge.js';
import { probeFps } from './render-helpers/ffprobe-utils.js';

const activeRenderJobs = new Map<
  string,
  { browser?: import('puppeteer').Browser; processes: ChildProcess[] }
>();
export const getActiveRenderJob = (id: string) => activeRenderJobs.get(id);

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

const RENDER_CHANNELS = {
  REQUEST: 'render-subtitles-request',
  RESULT: 'render-subtitles-result',
} as const;

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

/* ────────────────────────────────────────────────────────────────────────── */
/* IPC bootstrap                                                             */
/* ────────────────────────────────────────────────────────────────────────── */
export function initializeRenderWindowHandlers(): void {
  log.info('[RenderWindowHandlers] Initialising …');

  ipcMain.on(
    RENDER_CHANNELS.REQUEST,
    async (event, options: RenderSubtitlesOptions) => {
      const { operationId } = options;
      log.info(
        `[RenderWindowHandlers ${operationId}] ${RENDER_CHANNELS.REQUEST} received`
      );

      /* register job immediately so that cancellation UI can see it */
      activeRenderJobs.set(operationId, { processes: [] });

      /* ╔═   locals that need cleanup in finally ─────────────────────────── */
      let tempDirPath: string | null = null;
      let browser: import('puppeteer').Browser | null = null;
      /* ╚═══════════════════════════════════════════════════════════════════ */

      /* quick helper for progress relay */
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
      };

      try {
        /* ─── 1. Temp workspace ───────────────────────────────────────── */
        tempDirPath = await createOperationTempDir({ operationId });

        /* ─── 2. Spin-up Puppeteer page (+ preload CSS / preset) ──────── */
        const { browser: br, page } = await initPuppeteer({
          operationId,
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          fontRegular,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
        });
        browser = br;
        activeRenderJobs.get(operationId)!.browser = browser; // track

        /* ─── 3. Parse SRT ➜ timeline events (ms) ─────────────────────── */
        if (!options.originalVideoPath) {
          throw new Error(
            'Original video path is required but was not provided.'
          );
        }

        // [ADDED] Get accurate frame rate before generating states
        log.info(
          `[RenderWindowHandlers ${operationId}] Probing FPS for ${options.originalVideoPath}...`
        );
        const realFps = await probeFps(options.originalVideoPath);
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

        /* ─── 4. Render each subtitle "state" to PNG ──────────────────── */
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
        });
        await page.close(); // page no longer needed

        sendProgress({
          percent: 10,
          stage: 'Assembling subtitle overlay video...',
        }); // Assuming 10% for Puppeteer/PNG stage

        const concatListPath = path.join(
          tempDirPath,
          `pngs_${operationId}.txt`
        );
        await writeConcat({ frames: statePngs, listPath: concatListPath });
        sendProgress({ percent: 40, stage: 'Overlay concat ready' }); // Update progress stage

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

        /* ─── 7. [REPLACED] Burn overlay directly onto base video ──────── */
        const tempMerged = path.join(tempDirPath, `merged_${operationId}.mp4`);
        await directMerge({
          concatListPath, // Path to the PNG concat list
          baseVideoPath: videoForMerge, // Base video (original or black)
          outputSavePath: tempMerged, // Temp output path
          videoWidth: options.videoWidth,
          videoHeight: options.videoHeight,
          videoDuration: options.videoDuration,
          operationId,
          progressCallback: sendProgress, // Reuse the progress callback
          registerProcess, // Reuse the process registration callback
        });

        /* ─── 8. Ask user where to save result ────────────────────────── */
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
          event.reply(RENDER_CHANNELS.RESULT, {
            operationId,
            success: false,
            error: 'Save cancelled by user.',
          });
          return;
        }

        await fs.rename(tempMerged, userPath);
        sendProgress({ percent: 100, stage: 'Merge complete!' });
        event.reply(RENDER_CHANNELS.RESULT, {
          operationId,
          success: true,
          outputPath: userPath,
        });
      } catch (err: any) {
        log.error(`[RenderWindowHandlers ${operationId}]`, err);
        if (!event.sender.isDestroyed()) {
          event.reply(RENDER_CHANNELS.RESULT, {
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
      }
    }
  );

  log.info('[RenderWindowHandlers] IPC handlers ready');
}
