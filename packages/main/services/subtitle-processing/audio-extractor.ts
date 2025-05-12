import fs from 'fs';
import path from 'path';
import fsp from 'fs/promises';
import log from 'electron-log';
import { FFmpegError, FFmpegContext } from '../ffmpeg-runner.js';

declare module '../ffmpeg-runner.js' {
  interface FFmpegContext {
    extractAudio?: (opts: {
      videoPath: string;
      operationId?: string;
      signal?: AbortSignal;
      progress?: (p: { percent: number; stage?: string }) => void;
    }) => Promise<string>;
  }
}

export async function extractAudio(
  ctx: FFmpegContext,
  opts: {
    videoPath: string;
    operationId?: string;
    signal?: AbortSignal;
    progress?: (p: { percent: number; stage?: string }) => void;
  }
): Promise<string> {
  const { videoPath, progress, operationId, signal } = opts;

  if (!fs.existsSync(videoPath)) {
    throw new FFmpegError(`Input video file not found: ${videoPath}`);
  }

  const outputPath = path.join(
    ctx.tempDir,
    `${path.basename(videoPath, path.extname(videoPath))}_audio.flac`
  );

  try {
    progress?.({
      percent: 1,
      stage: 'Analyzing video file...',
    });

    const stats = fs.statSync(videoPath);
    const fileSizeMB = Math.round(stats.size / (1024 * 1024));
    const duration = await ctx.getMediaDuration(videoPath, signal);
    const durationMin = Math.round(duration / 60);
    let estimatedTimeSeconds = Math.round(duration * 0.1);
    if (fileSizeMB > 1000) estimatedTimeSeconds *= 1.5;
    const ANALYSIS_END = 3;
    const PREP_END = 5;
    const EXTRACTION_START = 5;
    const EXTRACTION_END = 10;
    progress?.({
      percent: ANALYSIS_END,
      stage: `Preparing audio extraction for ${fileSizeMB} MB video (${durationMin} min)...`,
    });
    progress?.({
      percent: PREP_END,
      stage: `Starting audio extraction (est. ${Math.round(estimatedTimeSeconds / 60)} min)...`,
    });
    const audioRate = '16000';
    const startTime = Date.now();
    let lastProgressPercent = EXTRACTION_START;

    const ffmpegArgs = [
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'flac',
      '-ar',
      audioRate,
      '-ac',
      '1',
      '-progress',
      'pipe:1',
      '-y',
      outputPath,
    ];

    await ctx.run(ffmpegArgs, {
      operationId,
      totalDuration: duration,
      progress: ffmpegProgress => {
        const scaledPercent =
          EXTRACTION_START +
          (ffmpegProgress * (EXTRACTION_END - EXTRACTION_START)) / 100;
        if (scaledPercent - lastProgressPercent >= 0.5) {
          lastProgressPercent = scaledPercent;
          const elapsedMs = Date.now() - startTime;
          const elapsedSec = Math.round(elapsedMs / 1000);
          let timeMessage = '';
          if (ffmpegProgress > 0) {
            const totalEstimatedSec = Math.round(
              elapsedSec / (ffmpegProgress / 100)
            );
            const remainingSec = Math.max(0, totalEstimatedSec - elapsedSec);
            if (remainingSec > 60) {
              timeMessage = ` (~ ${Math.round(remainingSec / 60)} min remaining)`;
            } else {
              timeMessage = ` (~ ${remainingSec} sec remaining)`;
            }
          }
          progress?.({
            percent: Math.min(EXTRACTION_END, scaledPercent),
            stage: `Extracting audio: ${Math.round(ffmpegProgress)}%${timeMessage}`,
          });
        }
      },
      cwd: path.dirname(videoPath),
      signal,
    });

    progress?.({
      percent: EXTRACTION_END,
      stage: 'Audio extraction complete...',
    });
    return outputPath;
  } catch (error) {
    log.error(`[extractAudio${operationId ? `/${operationId}` : ''}]`, error);
    if (error instanceof Error && error.message === 'Operation cancelled') {
      log.info(`[extractAudio/${operationId}] Caught cancellation error.`);
      throw error;
    }
    try {
      await fsp.unlink(outputPath);
    } catch (cleanupError: any) {
      log.warn(
        `Failed to delete invalid file ${outputPath} during cleanup: ${cleanupError.message}`
      );
    }
    throw error;
  }
}

// Helper to attach to context
export function attachExtractAudio(ctx: FFmpegContext): void {
  if (ctx.extractAudio) return; // avoid re-binding
  (ctx as any).extractAudio = (opts: {
    videoPath: string;
    operationId?: string;
    signal?: AbortSignal;
    progress?: (p: { percent: number; stage?: string }) => void;
  }) => extractAudio(ctx, opts);
}
