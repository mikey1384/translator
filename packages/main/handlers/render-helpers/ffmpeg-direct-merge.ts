import { spawn, ChildProcess } from 'child_process';
import os from 'os'; // Need os for platform check
import log from 'electron-log'; // Add log for debugging

interface DirectMergeOptions {
  concatListPath: string;
  baseVideoPath: string;
  outputSavePath: string;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  operationId: string;
  progressCallback: (p: {
    percent: number;
    stage: string;
    error?: string;
  }) => void; // Match Progress type
  registerProcess?: (c: ChildProcess) => void;
}

// Renamed opts fields to be more descriptive and match caller
export async function directMerge(
  opts: DirectMergeOptions
): Promise<{ success: boolean; finalOutputPath: string; error?: string }> {
  const {
    concatListPath,
    baseVideoPath,
    outputSavePath,
    videoWidth,
    videoHeight,
    videoDuration,
    progressCallback,
    registerProcess,
    operationId,
  } = opts;

  log.info(`[ffmpeg-direct-merge ${operationId}] Starting direct merge...`);

  // Define progress bands locally within this function
  const VIDEO_START = 40;
  const FINAL_START = 90;
  const FINAL_END = 100;
  const VIDEO_RANGE = FINAL_START - VIDEO_START;

  // Determine video codec (similar to old merge, slightly cleaned up)
  const platform = os.platform();
  let vcodec = 'libx264'; // Default
  if (platform === 'darwin') {
    vcodec = 'h264_videotoolbox';
  } else if (
    platform ===
    'win32' /* && check for NVIDIA GPU presence/driver? Could be complex */
  ) {
    // Basic check for windows, assuming NVENC might be available.
    // A more robust check would involve trying to run ffmpeg -encoders
    // vcodec = 'h264_nvenc'; // Keep commented unless NVIDIA check is robust
  }
  log.info(`[ffmpeg-direct-merge ${operationId}] Using video codec: ${vcodec}`);

  // Build FFmpeg arguments
  const ffArgs = [
    // Input 0: Base video (make sure paths are handled correctly)
    '-i',
    baseVideoPath,
    // Input 1: PNG sequence via concat demuxer
    '-f',
    'concat',
    '-safe',
    '0',
    '-vsync',
    'vfr',
    '-i',
    concatListPath,
    // Filter Complex
    '-filter_complex',
    // Prepare overlay: ensure RGBA, scale, reset timestamps
    `[1:v]format=rgba,scale=${videoWidth}:${videoHeight},setpts=PTS-STARTPTS[ov];` +
      // Overlay onto base video: use shortest duration to match base video
      `[0:v][ov]overlay=format=auto:shortest=1[out]`, // format=auto might be better than assuming formats
    // Mapping
    '-map',
    '[out]', // Map filtered video output
    '-map',
    '0:a?', // Map audio from base video (if it exists)
    '-c:a',
    'copy', // Copy audio stream
    // Video Codec + Options
    '-c:v',
    vcodec,
    '-preset',
    'veryfast', // Adjust as needed
    '-crf',
    '22', // Adjust quality vs size
    // Add pix_fmt for libx264/videotoolbox compatibility
    vcodec === 'libx264' || vcodec === 'h264_videotoolbox' ? '-pix_fmt' : '',
    vcodec === 'libx264' || vcodec === 'h264_videotoolbox' ? 'yuv420p' : '',
    // Progress reporting
    '-progress',
    'pipe:1',
    '-y', // Overwrite output
    outputSavePath,
  ].filter(Boolean); // Filter out empty strings from conditional args

  log.info(
    `[ffmpeg-direct-merge ${operationId}] Spawning ffmpeg with args: ${ffArgs.join(' ')}`
  );

  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess?.(ff);

    // Add stderr logging
    ff.stderr.setEncoding('utf8');
    ff.stderr.on('data', (data: string) => {
      log.debug(`[ffmpeg-direct-merge ${operationId} stderr] ${data.trim()}`);
    });

    // Handle stdout for progress
    ff.stdout.setEncoding('utf8');
    ff.stdout.on('data', (data: string) => {
      const txt = data.toString(); // Already string due to setEncoding
      // ── 1) update bar while video frames are still encoding ─────────────
      const m = /out_time_ms=(\d+)/.exec(txt);
      if (m) {
        const frac = Math.min(parseInt(m[1], 10) / (videoDuration * 1e6), 1); // 0 → 1
        const pct = VIDEO_START + frac * VIDEO_RANGE; // 40 → 90
        progressCallback({
          percent: Math.round(pct),
          stage: 'Encoding video…',
        });
      }

      // ── 2) update stage when ffmpeg signals progress=end ───────────────
      if (/progress=end/.test(txt)) {
        progressCallback({
          percent: FINAL_START, // Stay at 90%
          stage: 'Finalising container…',
        });
      }
    });

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
          percent: VIDEO_START, // Revert progress on error
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
