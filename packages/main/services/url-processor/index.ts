import { execa } from 'execa';
import log from 'electron-log';
import fsp from 'node:fs/promises';
import { ProgressCallback, VideoQuality } from './types.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { findYtDlpBinary } from './binary-locator.js';
import { downloadVideoFromPlatform } from './download.js';
import { PROGRESS } from './constants.js';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import { FileManager } from '../file-manager.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mapErrorToUserFriendly } from './error-map.js';
import { defaultBrowserHint } from './utils.js';

export async function updateYtDlp(): Promise<boolean> {
  try {
    const binPath = await findYtDlpBinary();
    if (!binPath) return false;
    const { stdout } = await execa(binPath, ['--update']);
    return stdout.includes('up to date') || stdout.includes('updated');
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
  useCookies: boolean = false
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
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  const extra = useCookies
    ? ['--cookies-from-browser', defaultBrowserHint()]
    : [];

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
      fileUrl: pathToFileURL(downloadResult.filepath).href,
      originalVideoPath: downloadResult.filepath,
      proc: downloadResult.proc,
    };
  } catch (err: any) {
    const friendly = mapErrorToUserFriendly({
      rawErrorMessage: err.message ?? String(err),
      stderrContent: err.stderr ?? '',
    });

    // Detect 429 / suspicious block
    if (
      /429|too\s+many\s+requests|rate[- ]?limiting|looks\s+suspicious|verify\s+you\s+are\s+human/i.test(
        friendly
      ) &&
      !useCookies
    ) {
      progressCallback?.({
        percent: PROGRESS.WARMUP_END,
        stage: 'Retrying with browser cookies...',
      });

      try {
        // Recursive retry with cookies
        progressCallback?.({
          percent: 10,
          stage: 'Using cookies',
        });
        const result = await processVideoUrl(
          url,
          quality,
          progressCallback,
          operationId,
          services,
          true
        );
        return result;
      } catch (err2: any) {
        const friendly2 = mapErrorToUserFriendly({
          rawErrorMessage: err2.message ?? String(err2),
          stderrContent: err2.stderr ?? '',
        });
        if (
          /429|too\s+many\s+requests|rate[- ]?limiting|looks\s+suspicious|verify\s+you\s+are\s+human/i.test(
            friendly2
          )
        ) {
          progressCallback?.({
            percent: 0,
            stage: 'NeedCookies',
          });
          throw err2; // Prevent infinite recursion on repeated 429
        }
        throw err2;
      }
    }

    throw err; // not a 429 or already using cookies ⇒ let normal error flow handle it
  }
}

export { VideoQuality };
