import log from 'electron-log';
import fsp from 'node:fs/promises';
import { ProgressCallback, VideoQuality } from './types.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { ensureYtDlpBinary } from './binary-installer.js';
import { downloadVideoFromPlatform } from './download.js';
import { PROGRESS } from './constants.js';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import { FileManager } from '../file-manager.js';
import path from 'node:path';
import { defaultBrowserHint } from './utils.js';

export async function updateYtDlp(): Promise<boolean> {
  try {
    // Force update by not skipping it (skipUpdate: false is the default)
    const binPath = await ensureYtDlpBinary();
    return binPath !== null;
  } catch (error) {
    log.error('[URLprocessor] Failed to update yt-dlp:', error);
    return false;
  }
}

export async function processVideoUrl(
  url: string,
  quality: VideoQuality,
  progressCallback: ProgressCallback | undefined,
  operationId: string,
  services?: {
    fileManager: FileManager;
    ffmpeg: FFmpegContext;
  },
  useCookies: boolean = false,
  cookiesBrowser?: string
): Promise<{
  videoPath: string;
  filename: string;
  size: number;
  fileUrl: string;
  originalVideoPath: string;
  proc: DownloadProcessType;
}> {
  log.info(`[URLprocessor] processVideoUrl CALLED (Op ID: ${operationId})`);

  if (!services?.fileManager) {
    throw new Error('FileManager instance is required for processVideoUrl');
  }
  const tempDir = services.fileManager.getTempDir();
  log.info(
    `[URLprocessor] processVideoUrl using tempDir from FileManager: ${tempDir}`
  );

  if (!services?.ffmpeg) {
    throw new Error('FFmpegContext is required for processVideoUrl');
  }
  const { ffmpeg } = services;

  try {
    // Normalize YouTube Shorts to watch URL to improve extractor stability
    try {
      const u = new URL(url);
      if (
        /(^|\.)youtube\.com$/.test(u.hostname) &&
        /^\/shorts\//.test(u.pathname)
      ) {
        const id = u.pathname.split('/')[2];
        if (id) {
          url = `https://www.youtube.com/watch?v=${id}`;
          log.info(`[URLprocessor] Rewrote Shorts URL to watch: ${url}`);
        }
      }
    } catch {
      // ignore
    }
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  let extra: string[] = [];
  if (useCookies) {
    extra = [
      '--cookies-from-browser',
      cookiesBrowser && cookiesBrowser !== 'auto'
        ? cookiesBrowser
        : defaultBrowserHint(),
    ];
    // When using cookies, prefer the web client so cookies apply correctly
  } else {
    // For non-cookie attempts, a more permissive client can help for Shorts or rate-limited IPs
    if (/youtube\.com/.test(url)) {
      extra = ['--extractor-args', 'youtube:player_client=android'];
    }
  }

  // --- 1st attempt: use cookies if specified ---
  try {
    const downloadResult = await downloadVideoFromPlatform(
      url,
      tempDir,
      quality,
      progressCallback,
      operationId,
      { ffmpeg },
      extra
    );
    const stats = await fsp.stat(downloadResult.filepath);
    const filename = path.basename(downloadResult.filepath);
    progressCallback?.({
      percent: PROGRESS.FINAL_END,
      stage: 'Download complete',
    });

    return {
      videoPath: downloadResult.filepath,
      filename,
      size: stats.size,
      fileUrl: `file://${downloadResult.filepath}`,
      originalVideoPath: downloadResult.filepath,
      proc: downloadResult.proc,
    };
  } catch (err: any) {
    const combined = `${err?.message ?? ''}\n${err?.stderr ?? ''}\n${
      err?.stdout ?? ''
    }\n${err?.all ?? ''}`;
    const combinedLC = combined.toLowerCase();

    // Detect 429 / captcha / login-required bot checks
    const looksSuspicious = /429|too\s*many\s*requests|rate[- ]?limit/.test(
      combinedLC
    );
    const needsLoginBotCheck =
      /login_required|sign\s*in\s*to\s*confirm|not\s*a\s*bot|verify\s*(you|you'?re)\s*not\s*(a\s*)?bot|consent/.test(
        combinedLC
      );

    const isYouTube = /(^|\.)youtube\.com/.test(new URL(url).hostname);
    if ((looksSuspicious || needsLoginBotCheck || isYouTube) && !useCookies) {
      progressCallback?.({
        percent: PROGRESS.WARMUP_END,
        stage: 'NeedCookies',
      });
      // Surface to UI; do not auto-retry with cookies here to avoid friction
      throw new Error('NeedCookies');
    }

    throw err; // not a 429 or already using cookies ⇒ let normal error flow handle it
  }
}

export { VideoQuality };
