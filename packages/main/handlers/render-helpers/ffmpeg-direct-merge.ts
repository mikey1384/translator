import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import log from 'electron-log';

interface DirectMergeOptions {
  concatListPath: string;
  baseVideoPath: string;
  audioPath?: string;
  outputSavePath: string;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  operationId: string;
  progressCallback: (p: {
    percent: number;
    stage: string;
    error?: string;
  }) => void;
  registerProcess?: (c: ChildProcess) => void;
  signal?: AbortSignal;
}

export async function directMerge(
  opts: DirectMergeOptions
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  const {
    concatListPath,
    baseVideoPath,
    audioPath,
    outputSavePath,
    videoWidth,
    videoHeight,
    videoDuration,
    progressCallback,
    registerProcess,
    operationId,
    signal,
  } = opts;

  log.info(`[ffmpeg-direct-merge ${operationId}] Starting direct merge...`);

  const VIDEO_START = 40;
  const FINAL_START = 90;
  const FINAL_END = 100;
  const VIDEO_RANGE = FINAL_START - VIDEO_START;

  const platform = os.platform();
  let vcodec = 'libx264';
  if (platform === 'darwin') {
    vcodec = 'h264_videotoolbox';
  }
  log.info(`[ffmpeg-direct-merge ${operationId}] Using video codec: ${vcodec}`);

  const overlayInput = audioPath ? 2 : 1;
  const audioMap = audioPath ? ['-map', '1:a:0'] : ['-map', '0:a?'];
  const ffArgs = [
    '-i',
    baseVideoPath,
    ...(audioPath ? ['-i', audioPath] : []),
    '-f',
    'concat',
    '-safe',
    '0',
    '-vsync',
    'vfr',
    '-i',
    concatListPath,
    '-filter_complex',
    `[${overlayInput}:v]format=rgba,scale=${videoWidth}:${videoHeight},setpts=PTS-STARTPTS[ov];` +
      `[0:v][ov]overlay=format=auto:shortest=1[out]`,
    '-map',
    '[out]',
    ...audioMap,
    '-c:a',
    'copy',
    '-c:v',
    vcodec,
    '-preset',
    'veryfast',
    '-crf',
    '22',
    vcodec === 'libx264' || vcodec === 'h264_videotoolbox' ? '-pix_fmt' : '',
    vcodec === 'libx264' || vcodec === 'h264_videotoolbox' ? 'yuv420p' : '',
    '-progress',
    'pipe:1',
    '-y',
    outputSavePath,
  ].filter(Boolean);

  log.info(
    `[ffmpeg-direct-merge ${operationId}] Spawning ffmpeg with args: ${ffArgs.join(' ')}`
  );

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess?.(ff);

    ff.stderr.setEncoding('utf8');
    ff.stderr.on('data', (data: string) => {
      log.debug(`[ffmpeg-direct-merge ${operationId} stderr] ${data.trim()}`);
    });

    ff.stdout.setEncoding('utf8');
    ff.stdout.on('data', (data: string) => {
      const txt = data.toString();
      const m = /out_time_ms=(\d+)/.exec(txt);
      if (m) {
        const frac = Math.min(parseInt(m[1], 10) / (videoDuration * 1e6), 1); // 0 → 1
        const pct = VIDEO_START + frac * VIDEO_RANGE; // 40 → 90
        progressCallback({
          percent: Math.round(pct),
          stage: 'Encoding video…',
        });
      }

      if (/progress=end/.test(txt)) {
        progressCallback({
          percent: FINAL_START,
          stage: 'Finalising container…',
        });
      }
    });

    if (signal) {
      const onAbort = () => {
        if (!ff.killed) {
          try {
            const sig = process.platform === 'win32' ? 'SIGTERM' : 'SIGINT';
            ff.kill(sig);
          } catch {
            /* already exited */
          }
          progressCallback?.({
            percent: VIDEO_START,
            stage: 'Cancelled',
            error: 'Operation cancelled by user',
          });
        }
      };

      void (signal.aborted
        ? onAbort()
        : signal.addEventListener('abort', onAbort, { once: true }));

      const cleanupAbort = () => signal.removeEventListener('abort', onAbort);
      ff.once('close', cleanupAbort);
      ff.once('error', cleanupAbort);
    }

    ff.once('close', code => {
      if (code === 0) {
        log.info(
          `[ffmpeg-direct-merge ${operationId}] Direct merge successful.`
        );
        progressCallback?.({ percent: FINAL_END, stage: 'Merge complete!' });
        resolve({ success: true, finalOutputPath: outputSavePath });
      } else {
        const err = `ffmpeg direct merge exited with ${code}`;
        log.error(`[ffmpeg-direct-merge ${operationId}] ${err}`);
        progressCallback?.({
          percent: VIDEO_START,
          stage: 'Merge failed',
          error: err,
        });
        reject({ success: false, finalOutputPath: '', error: err });
      }
    });

    ff.once('error', err => {
      log.error(
        `[ffmpeg-direct-merge ${operationId}] Failed to spawn ffmpeg:`,
        err
      );
      progressCallback?.({
        percent: VIDEO_START,
        stage: 'Merge failed',
        error: `Failed to start ffmpeg: ${err.message}`,
      });
      reject({
        success: false,
        finalOutputPath: '',
        error: `Failed to start ffmpeg: ${err.message}`,
      });
    });
  });
}
