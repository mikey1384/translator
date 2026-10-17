import { spawn, ChildProcess } from 'child_process';
import os from 'os';
import log from 'electron-log';
import { forceKillWindows } from '../../utils/process-killer.js';
import { ERROR_CODES } from '../../../shared/constants/index.js';

interface DirectMergeOptions {
  concatListPath: string;
  baseVideoPath: string;
  audioPath?: string;
  outputSavePath: string;
  videoWidth: number;
  videoHeight: number;
  videoDuration: number;
  operationId: string;
  ffmpegPath: string;
  progressCallback: (p: {
    percent: number;
    stage: string;
    error?: string;
  }) => void;
  registerProcess?: (c: ChildProcess) => void;
  signal?: AbortSignal;
  /** Codec of the audio that ends up in the output (null: none/unknown). */
  sourceAudioCodec?: string | null;
  /** Source video bit rate in bits/s, used to size hardware encodes. */
  sourceVideoBitRate?: number | null;
  frameRate?: number;
}

/** Audio codecs Apple devices and social uploaders play inside .mp4. */
const MP4_SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac']);

export function mergeAudioCodecArgs(codec?: string | null): string[] {
  if (codec && MP4_SAFE_AUDIO_CODECS.has(codec.toLowerCase())) {
    return ['-c:a', 'copy'];
  }
  // Vorbis, Opus, DTS, PCM… (or unknown): transcode so every player can
  // decode the export.
  return ['-c:a', 'aac', '-b:a', '192k'];
}

const MIN_HW_BITRATE = 1_000_000;
const MAX_HW_BITRATE = 40_000_000;

/**
 * VideoToolbox ignores -crf/-preset and picks a bitrate 3–5× the source's,
 * so size it from the source (a little headroom for the subtitle edges), or
 * from the frame size when the source doesn't say.
 */
export function hardwareTargetBitRate({
  width,
  height,
  frameRate,
  sourceVideoBitRate,
}: {
  width: number;
  height: number;
  frameRate?: number;
  sourceVideoBitRate?: number | null;
}): number {
  const fps = frameRate && frameRate > 0 ? Math.min(frameRate, 120) : 30;
  const estimate = width * height * fps * 0.1;
  const target =
    sourceVideoBitRate && sourceVideoBitRate > 0
      ? sourceVideoBitRate * 1.15
      : estimate;
  return Math.round(Math.min(MAX_HW_BITRATE, Math.max(MIN_HW_BITRATE, target)));
}

export function mergeVideoCodecArgs({
  platform,
  width,
  height,
  frameRate,
  sourceVideoBitRate,
}: {
  platform: NodeJS.Platform;
  width: number;
  height: number;
  frameRate?: number;
  sourceVideoBitRate?: number | null;
}): string[] {
  if (platform === 'darwin') {
    const bitRate = hardwareTargetBitRate({
      width,
      height,
      frameRate,
      sourceVideoBitRate,
    });
    return [
      '-c:v',
      'h264_videotoolbox',
      '-b:v',
      String(bitRate),
      '-maxrate',
      String(Math.round(bitRate * 1.5)),
    ];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22'];
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
    ffmpegPath,
    sourceAudioCodec,
    sourceVideoBitRate,
    frameRate,
  } = opts;

  log.info(`[ffmpeg-direct-merge ${operationId}] Starting direct merge...`);

  const VIDEO_START = 12;
  const FINAL_START = 90;
  // Keep below 100 so the renderer stays "in progress" until the user picks
  // a save location and the main process replies with the final result.
  const FINAL_END = 95;
  const VIDEO_RANGE = FINAL_START - VIDEO_START;

  const videoCodecArgs = mergeVideoCodecArgs({
    platform: os.platform(),
    width: videoWidth,
    height: videoHeight,
    frameRate,
    sourceVideoBitRate,
  });
  const audioCodecArgs = mergeAudioCodecArgs(sourceAudioCodec);
  log.info(
    `[ffmpeg-direct-merge ${operationId}] Video: ${videoCodecArgs.join(' ')}; audio (${sourceAudioCodec ?? 'unknown'}): ${audioCodecArgs.join(' ')}`
  );

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
    ...audioCodecArgs,
    ...videoCodecArgs,
    '-pix_fmt',
    'yuv420p',
    '-progress',
    'pipe:1',
    '-y',
    outputSavePath,
  ].filter(Boolean);

  log.info(
    `[ffmpeg-direct-merge ${operationId}] Spawning ffmpeg with args: ${ffArgs.join(' ')}`
  );

  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    registerProcess?.(ff);

    const stderrTail: string[] = [];
    const MAX_STDERR_LINES = 30;
    let sawDiskFull = false;

    ff.stderr.setEncoding('utf8');
    ff.stderr.on('data', (data: string) => {
      const text = data.toString();
      const trimmed = text.trim();
      if (trimmed) {
        for (const line of trimmed.split(/\r?\n/)) {
          const l = line.trim();
          if (!l) continue;
          stderrTail.push(l);
          if (stderrTail.length > MAX_STDERR_LINES) stderrTail.shift();
          if (
            /no space left on device/i.test(l) ||
            /disk quota exceeded/i.test(l) ||
            /\bENOSPC\b/i.test(l)
          ) {
            sawDiskFull = true;
          }
        }
      }
      log.debug(`[ffmpeg-direct-merge ${operationId} stderr] ${trimmed}`);
    });

    ff.stdout.setEncoding('utf8');
    ff.stdout.on('data', (data: string) => {
      const txt = data.toString();
      const m = /out_time_ms=(\d+)/.exec(txt);
      if (m) {
        const frac = Math.min(parseInt(m[1], 10) / (videoDuration * 1e6), 1); // 0 → 1
        const pct = VIDEO_START + frac * VIDEO_RANGE;
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
            if (process.platform === 'win32' && ff.pid) {
              // On Windows, use taskkill for reliable FFmpeg termination
              log.info(
                `[ffmpeg-direct-merge ${operationId}] Force-killing Windows FFmpeg process tree PID: ${ff.pid}`
              );
              forceKillWindows({
                pid: ff.pid,
                logPrefix: `ffmpeg-direct-merge ${operationId}`,
              })
                .then(killed => {
                  if (!killed) {
                    // Fallback to signal if taskkill fails
                    log.warn(
                      `[ffmpeg-direct-merge ${operationId}] taskkill failed, trying SIGTERM fallback`
                    );
                    try {
                      ff.kill('SIGTERM');
                    } catch {
                      // Ignore errors since process might already be dead
                    }
                  }
                })
                .catch(() => {
                  // Fallback to signal if taskkill throws
                  try {
                    ff.kill('SIGTERM');
                  } catch {
                    // Ignore errors since process might already be dead
                  }
                });
            } else {
              // Non-Windows: use regular SIGINT
              ff.kill('SIGINT');
            }
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
        progressCallback?.({ percent: FINAL_END, stage: 'Encoding complete!' });
        resolve({ success: true, finalOutputPath: outputSavePath });
      } else {
        const aborted = !!signal?.aborted;
        if (aborted) {
          const e = new Error('Cancelled');
          reject(e);
          return;
        }

        const msg = sawDiskFull
          ? ERROR_CODES.INSUFFICIENT_DISK_SPACE
          : `ffmpeg direct merge exited with ${code}`;
        const details = stderrTail.join('\n');

        if (details) {
          log.error(
            `[ffmpeg-direct-merge ${operationId}] stderr tail:\n${details}`
          );
        }
        log.error(`[ffmpeg-direct-merge ${operationId}] ${msg}`);
        progressCallback?.({
          percent: VIDEO_START,
          stage: 'Merge failed',
          error: msg,
        });
        reject(new Error(msg));
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
      reject(new Error(`Failed to start ffmpeg: ${err.message}`));
    });
  });
}
