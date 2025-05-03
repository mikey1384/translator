import os from 'os';
import { spawn, ChildProcess } from 'child_process';
import log from 'electron-log';

/* [ADDED] Progress-bar bands for the merge stage */
const VIDEO_START = 40; // bar begins here when merge starts
const FINAL_START = 90; // leave the last 10 % for trailer/audio work
const FINAL_END = 100; // completion
const VIDEO_RANGE = FINAL_START - VIDEO_START; // 50 points

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

    // [ADDED] Log stderr for diagnostics, ensuring the pipe is drained
    ff.stderr.setEncoding('utf8');
    ff.stderr.on('data', (data: string) => {
      log.debug(`[ffmpeg-merge ${opts.operationId} stderr] ${data.trim()}`);
    });

    ff.stdout.setEncoding('utf8'); // Ensure stdout encoding is set
    ff.stdout.on('data', (buf: Buffer) => {
      const txt = buf.toString();

      // ── 1) update bar while video frames are still encoding ─────────────
      const m = /out_time_ms=(\d+)/.exec(txt);
      if (m) {
        const frac = Math.min(parseInt(m[1], 10) / (videoDuration * 1e6), 1); // 0 → 1
        const pct = VIDEO_START + frac * VIDEO_RANGE; // 40 → 90
        progressCallback?.({
          percent: Math.round(pct),
          stage: 'Encoding video…',
        });
      }

      // ── 2) update stage when ffmpeg signals progress=end ───────────────
      //    We don't jump to 100% here, only on 'close' event
      if (/progress=end/.test(txt)) {
        progressCallback?.({
          percent: FINAL_START, // Stay at 90% (or VIDEO_START + VIDEO_RANGE)
          stage: 'Finalising container…',
        });
      }
    });

    ff.once('close', code => {
      if (code === 0) {
        // Force final 100% update ONLY on successful close
        progressCallback?.({ percent: FINAL_END, stage: 'Merge complete!' });
        resolve({ success: true, finalOutputPath: targetSavePath });
      } else {
        const err = `ffmpeg merge exited with ${code}`;
        log.error(`[ffmpeg-merge ${opts.operationId}] ${err}`); // Log error
        progressCallback?.({
          percent: VIDEO_START, // Revert progress on error
          stage: 'Merge failed',
          error: err,
        });
        reject({ success: false, finalOutputPath: '', error: err });
      }
    });
  });
}
