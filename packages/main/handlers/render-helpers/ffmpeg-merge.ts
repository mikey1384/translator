import os from 'os';
import { spawn } from 'child_process';
import { ChildProcess } from 'child_process';
import log from 'electron-log';

type Progress = (d: { percent: number; stage: string; error?: string }) => void;

export interface MergeVideoAndOverlayOptions {
  baseVideoPath: string;
  originalMediaPath: string;
  overlayVideoPath: string;
  targetSavePath: string;
  overlayMode: 'overlayOnVideo' | 'blackVideo';
  operationId: string;
  videoDuration: number;
  progressCallback?: Progress;
  registerProcess?: (p: ChildProcess) => void;
}

export async function mergeVideoAndOverlay(
  opts: MergeVideoAndOverlayOptions
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  log.info(`[ffmpeg-merge ${opts.operationId}] Starting merge...`);

  const {
    baseVideoPath,
    originalMediaPath,
    overlayVideoPath,
    targetSavePath,
    overlayMode,
    videoDuration,
    progressCallback,
    registerProcess,
  } = opts;

  const vcodec = os.platform() === 'darwin' ? 'h264_videotoolbox' : 'libx264';

  const ffArgs =
    overlayMode === 'overlayOnVideo'
      ? [
          '-i',
          baseVideoPath,
          '-i',
          overlayVideoPath,
          '-filter_complex',
          '[0:v][1:v]overlay=format=auto[out]',
          '-map',
          '[out]',
          '-map',
          '0:a?',
          '-c:a',
          'copy',
        ]
      : [
          '-i',
          baseVideoPath,
          '-i',
          overlayVideoPath,
          '-i',
          originalMediaPath,
          '-filter_complex',
          '[0:v][1:v]overlay=format=auto[out]',
          '-map',
          '[out]',
          '-map',
          '2:a',
          '-c:a',
          'copy',
        ];

  ffArgs.push(
    '-c:v',
    vcodec,
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-progress',
    'pipe:1',
    '-y',
    targetSavePath
  );

  if (vcodec === 'h264_videotoolbox') {
    ffArgs.push('-pix_fmt', 'yuv420p');
  }

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess?.(ff);

    const START = 40;
    const END = 100;
    const RANGE = END - START;

    ff.stdout.on('data', (buf: Buffer) => {
      const m = /out_time_ms=(\d+)/.exec(buf.toString());
      if (!m) return;
      const pct = Math.min(
        END - 1,
        START + (parseInt(m[1], 10) / (videoDuration * 1e6)) * RANGE
      );
      progressCallback?.({
        percent: Math.round(pct),
        stage: `Merging video…`,
      });
    });

    ff.once('close', code => {
      if (code === 0) {
        progressCallback?.({ percent: 99, stage: 'Muxing complete' });
        resolve({ success: true, finalOutputPath: targetSavePath });
      } else {
        const err = `ffmpeg merge exited with ${code}`;
        progressCallback?.({ percent: 99, stage: 'Merge failed', error: err });
        reject({ success: false, finalOutputPath: '', error: err });
      }
    });
  });
}
