import { execa } from 'execa';
import log from 'electron-log';
import fsp from 'node:fs/promises';
import { ProgressCallback, VideoQuality } from './types.js';
import type { DownloadProcess as DownloadProcessType } from '../../active-processes.js';
import { findYtDlpBinary } from './binary-locator.js';
import { downloadVideoFromPlatform } from './download.js';
import { qualityFormatMap, PROGRESS } from './constants.js';
import { FFmpegService } from '../ffmpeg-service.js';
import { FileManager } from '../file-manager.js';
import path from 'node:path';

export async function updateYtDlp(): Promise<boolean> {
  try {
    const binPath = await findYtDlpBinary();
    if (!binPath) return false;
    const { stdout } = await execa(binPath, ['--update']);
    return stdout.includes('up to date') || stdout.includes('updated');
  } catch (error) {
    log.error('[URLProcessor] Failed to update yt-dlp:', error);
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
    ffmpegService: FFmpegService;
  }
): Promise<{
  videoPath: string;
  filename: string;
  size: number;
  fileUrl: string;
  originalVideoPath: string;
  proc: DownloadProcessType;
}> {
  log.info(`[URLProcessor] processVideoUrl CALLED (Op ID: ${operationId})`);

  if (!services?.fileManager) {
    throw new Error('FileManager instance is required for processVideoUrl');
  }
  const tempDir = services.fileManager.getTempDir();
  log.info(
    `[URLProcessor] processVideoUrl using tempDir from FileManager: ${tempDir}`
  );

  if (!services?.ffmpegService) {
    throw new Error('FFmpegService instance is required for processVideoUrl');
  }
  const { ffmpegService } = services;

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL provided.');
  }

  const downloadResult = await downloadVideoFromPlatform(
    url,
    tempDir,
    quality,
    progressCallback,
    operationId,
    { ffmpegService }
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
}

export { VideoQuality, qualityFormatMap };
