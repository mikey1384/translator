import path from 'path';
import fs from 'fs/promises';
import { spawn, ChildProcess } from 'child_process';
import { app, ipcMain, BrowserWindow, dialog } from 'electron';
import log from 'electron-log';
import { pathToFileURL } from 'url';

import { RenderSubtitlesOptions } from '@shared-types/app';
import { FFmpegService } from '../../services/ffmpeg-service.js';
import { getAssetsPath } from '../../shared/helpers/paths.js';

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

/* ────────────────────────────────────────────────────────────────────────── */
/* Helper imports (new files)                                                */
/* ────────────────────────────────────────────────────────────────────────── */
import {
  createOperationTempDir,
  cleanupTempDir,
} from './render-helpers/temp-utils.js';
import { initPuppeteer } from './render-helpers/puppeteer-setup.js';
import { generateSubtitleEvents } from './render-helpers/srt-parser.js';
import { generateStatePngs } from './render-helpers/state-generator.js';
import { assembleClipsFromStates } from './render-helpers/ffmpeg-assembly.js';
import { mergeVideoAndOverlay } from './render-helpers/ffmpeg-merge.js';

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

      // Helper to add processes to the active job
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
          frameRate: options.frameRate,
          fontSizePx: options.fontSizePx,
          stylePreset: options.stylePreset,
          progress: sendProgress,
        });
        await page.close(); // page no longer needed

        // [ADDED] Send progress update after PNG generation
        sendProgress({
          percent: 10,
          stage: 'Assembling subtitle overlay video...',
        }); // Assuming 10% for Puppeteer/PNG stage

        /* ─── 5. Assemble PNGs ➜ alpha-MOV overlay ───────────────────── */
        const overlayMovPath = path.join(
          tempDirPath,
          `overlay_${operationId}.mov`
        );
        await assembleClipsFromStates({
          statePngs,
          outputPath: overlayMovPath,
          frameRate: options.frameRate,
          operationId,
          progressCallback: sendProgress,
          registerProcess,
        });

        // [ADDED] Send progress update after assembly
        sendProgress({ percent: 40, stage: 'Merging video and overlay...' }); // Assuming assembly took up to 40%

        /* ─── 6. Optional black-video stub for "overlay only" mode ────── */
        let videoForMerge = options.originalVideoPath;
        if (options.overlayMode === 'blackVideo') {
          const ffmpegSvc = new FFmpegService(app.getPath('temp'));
          videoForMerge = path.join(tempDirPath, `black_${operationId}.mp4`);
          await ffmpegSvc.makeBlackVideo({
            out: videoForMerge,
            w: options.videoWidth,
            h: options.videoHeight,
            fps: options.frameRate,
            dur: options.videoDuration,
          });
        }

        /* ─── 7. Burn overlay onto base video ─────────────────────────── */
        const tempMerged = path.join(tempDirPath, `merged_${operationId}.mp4`);
        await mergeVideoAndOverlay({
          baseVideoPath: videoForMerge,
          originalMediaPath: options.originalVideoPath,
          overlayVideoPath: overlayMovPath,
          targetSavePath: tempMerged,
          overlayMode: options.overlayMode ?? 'overlayOnVideo',
          operationId,
          videoDuration: options.videoDuration,
          progressCallback: sendProgress,
          registerProcess,
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
