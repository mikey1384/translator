import fs from 'fs';
import path from 'path';
import fsp from 'fs/promises';
import log from 'electron-log';
import { spawn } from 'child_process';
import {
  FFmpegError,
  AudioSliceOpts,
  FFmpegContext,
} from '../ffmpeg-runner.js';
import {
  ASR_OUT_EXT,
  ASR_AUDIO_CODEC,
  ASR_OPUS_BITRATE,
  ASR_VBR,
  ASR_COMPR_LEVEL,
  ASR_SAMPLE_RATE,
  ASR_SAMPLE_FMT,
} from './constants.js';

export const mkTempAudioName = (stem: string): string =>
  `${stem}${ASR_OUT_EXT}`;

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

async function getFirstAudioIndex(
  file: string,
  ffprobePath: string
): Promise<string | null> {
  return new Promise<string | null>(res => {
    const p = spawn(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      file,
    ]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('close', () => res(out.trim().split('\n')[0] || null));
  });
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

  const outputPath = mkTempAudioName(
    path.join(
      ctx.tempDir,
      `${path.basename(videoPath, path.extname(videoPath))}_audio`
    )
  );

  try {
    progress?.({
      percent: 1,
      stage: 'Analyzing video file...',
    });

    fs.mkdirSync(ctx.tempDir, { recursive: true });

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
    const startTime = Date.now();
    let lastProgressPercent = EXTRACTION_START;

    const audioIdx = await getFirstAudioIndex(videoPath, ctx.ffprobePath);
    if (audioIdx === null) {
      throw new FFmpegError('No audio stream detected in input file');
    }

    const ffmpegArgs = [
      '-v',
      'error',
      '-discard:v',
      'all',
      '-i',
      videoPath,
      '-af',
      'silenceremove=start_periods=1:start_silence=0.5:start_threshold=-50dB',
      '-map',
      '0:a:0?',
      '-ar',
      String(ASR_SAMPLE_RATE),
      '-sample_fmt',
      ASR_SAMPLE_FMT,
      '-ac',
      '1',
      '-c:a',
      ASR_AUDIO_CODEC,
    ];

    if (ASR_AUDIO_CODEC === 'libopus') {
      ffmpegArgs.push('-b:a', ASR_OPUS_BITRATE);
      ffmpegArgs.push('-vbr', ASR_VBR);
      ffmpegArgs.push('-application', 'voip');
    } else {
      ffmpegArgs.push('-compression_level', String(ASR_COMPR_LEVEL));
    }

    ffmpegArgs.push('-progress', 'pipe:1', '-y', outputPath);

    log.info(`[ffmpeg extractAudio] Running command: ${ffmpegArgs.join(' ')}`);

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

export async function extractAudioSegment(
  ctx: FFmpegContext,
  opts: AudioSliceOpts
): Promise<string> {
  const { input, output, start, duration, operationId, signal } = opts;
  const audioIdx = await getFirstAudioIndex(input, ctx.ffprobePath);
  if (audioIdx === null) throw new FFmpegError('No audio stream in file');
  const args = [
    '-y',
    '-ss',
    String(start),
    '-t',
    String(duration),
    '-i',
    input,
    '-map',
    '0:a:0?',
    '-vn',
    '-ar',
    String(ASR_SAMPLE_RATE),
    '-sample_fmt',
    ASR_SAMPLE_FMT,
    '-ac',
    '1',
    '-c:a',
    ASR_AUDIO_CODEC,
  ];

  if (ASR_AUDIO_CODEC === 'libopus') {
    args.push('-b:a', ASR_OPUS_BITRATE);
    args.push('-vbr', ASR_VBR);
    args.push('-application', 'voip');
  } else {
    args.push('-compression_level', String(ASR_COMPR_LEVEL));
  }
  args.push(output);

  await ctx.run(args, { operationId, cwd: path.dirname(input), signal });
  if (!fs.existsSync(output) || fs.statSync(output).size === 0) {
    throw new FFmpegError('empty slice output');
  }
  return output;
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

export function attachExtractAudioSegment(ctx: FFmpegContext): void {
  if ('extractAudioSegment' in ctx) return; // already attached
  (ctx as any).extractAudioSegment = (opts: AudioSliceOpts) =>
    extractAudioSegment(ctx, opts);
}
