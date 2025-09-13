import path from 'path';
import fs from 'fs/promises';
import { ChildProcess } from 'child_process';
import { ipcMain, BrowserWindow, dialog } from 'electron';
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

const activeRenderJobs = new Map<
  string,
  { browser?: import('puppeteer').Browser; processes: ChildProcess[] }
>();
export const getActiveRenderJob = (id: string) => activeRenderJobs.get(id);

const jobControllers = new Map<string, AbortController>();

const fontRegular = pathToFileURL(getAssetsPath('NotoSans-Regular.ttf')).href;

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
