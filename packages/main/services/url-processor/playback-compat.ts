import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import { dirname, basename, extname, join } from 'node:path';
import log from 'electron-log';
import type { FFmpegContext } from '../ffmpeg-runner.js';
import { CancelledError } from '../../../shared/cancelled-error.js';

/**
 * Downloads must play in Translator's own player (Chromium). Chromium decodes
 * H.264 (8-bit 4:2:0), VP8, VP9 and AV1 everywhere; HEVC only on some
 * machines (it failed on an Apple Silicon Mac, 2026-10-31), and nothing else
 * reliably. Anything outside that set is re-encoded to H.264 once, right
 * after download, so what the user watches is what they translate and export.
 */
const ALWAYS_PLAYABLE_VIDEO_CODECS = new Set(['vp8', 'vp9', 'av1']);
const PLAYABLE_H264_PIXEL_FORMATS = new Set(['yuv420p', 'yuvj420p']);
const MP4_COPYABLE_AUDIO_CODECS = new Set(['aac', 'mp3']);

export type ProbedStreams = {
  videoCodec: string | null;
  pixelFormat: string | null;
  audioCodec: string | null;
  durationSec: number | null;
};

export function needsPlaybackTranscode(probe: ProbedStreams): boolean {
  const codec = String(probe.videoCodec || '').toLowerCase();
  // Audio-only downloads, and cover art posing as a video stream, are fine.
  if (!codec || codec === 'mjpeg' || codec === 'png') return false;
  if (ALWAYS_PLAYABLE_VIDEO_CODECS.has(codec)) return false;
  if (codec === 'h264') {
    // High 10 / 4:2:2 H.264 does not decode in Chromium.
    const pix = String(probe.pixelFormat || '').toLowerCase();
    return Boolean(pix) && !PLAYABLE_H264_PIXEL_FORMATS.has(pix);
  }
  return true;
}

export type H264Encoder = 'h264_videotoolbox' | 'libx264';

/**
 * Hardware encode on Apple Silicon (constant quality, software fallback
 * allowed inside VideoToolbox); libx264 elsewhere and as the retry when a
 * VideoToolbox session cannot be created (seen on CI runners).
 */
export function preferredH264Encoders(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): H264Encoder[] {
  return platform === 'darwin' && arch === 'arm64'
    ? ['h264_videotoolbox', 'libx264']
    : ['libx264'];
}

export function buildPlaybackTranscodeArgs({
  input,
  output,
  encoder,
  audioCodec,
}: {
  input: string;
  output: string;
  encoder: H264Encoder;
  audioCodec: string | null;
}): string[] {
  const videoArgs =
    encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'];
  const audioArgs = !audioCodec
    ? []
    : MP4_COPYABLE_AUDIO_CODECS.has(audioCodec.toLowerCase())
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k'];
  return [
    '-hide_banner',
    '-nostats',
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    ...videoArgs,
    '-pix_fmt',
    'yuv420p',
    '-profile:v',
    'high',
    '-tag:v',
    'avc1',
    ...audioArgs,
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    output,
  ];
}

export function probeStreams(
  ffprobePath: string,
  file: string
): Promise<ProbedStreams> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,pix_fmt:format=duration',
        '-of',
        'json',
        file,
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          const data = JSON.parse(String(stdout || '{}'));
          const streams: any[] = Array.isArray(data.streams)
            ? data.streams
            : [];
          const video = streams.find(s => s?.codec_type === 'video');
          const audio = streams.find(s => s?.codec_type === 'audio');
          const duration = Number(data.format?.duration);
          resolve({
            videoCodec: video?.codec_name ?? null,
            pixelFormat: video?.pix_fmt ?? null,
            audioCodec: audio?.codec_name ?? null,
            durationSec:
              Number.isFinite(duration) && duration > 0 ? duration : null,
          });
        } catch (parseError) {
          reject(parseError);
        }
      }
    );
  });
}

export type PlaybackCompatResult = {
  filepath: string;
  transcoded: boolean;
  fromCodec: string | null;
};

/**
 * Returns the path of a file Translator's player can play. The original is
 * replaced only after a complete re-encode; any failure keeps the original
 * (a file the player may not show is still better than no download).
 */
export async function ensurePlayableDownload({
  filepath,
  ffmpeg,
  operationId,
  signal,
  onProgress,
  probe = probeStreams,
  encoders = preferredH264Encoders(),
}: {
  filepath: string;
  ffmpeg: Pick<FFmpegContext, 'run' | 'ffprobePath'>;
  operationId: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  probe?: (ffprobePath: string, file: string) => Promise<ProbedStreams>;
  encoders?: H264Encoder[];
}): Promise<PlaybackCompatResult> {
  let streams: ProbedStreams;
  try {
    streams = await probe(ffmpeg.ffprobePath, filepath);
  } catch (error: any) {
    log.warn(
      `[URLprocessor] Could not probe codecs for playback check (${error?.message || error}); keeping the file as downloaded (Op ID: ${operationId}).`
    );
    return { filepath, transcoded: false, fromCodec: null };
  }
  if (!needsPlaybackTranscode(streams)) {
    return { filepath, transcoded: false, fromCodec: streams.videoCodec };
  }
  log.info(
    `[URLprocessor] Downloaded video is ${streams.videoCodec}/${streams.pixelFormat ?? '?'}; re-encoding to H.264 for playback (Op ID: ${operationId}).`
  );
  const ext = extname(filepath);
  const stem = basename(filepath, ext);
  // Same prefix as the download, so failed-download cleanup also finds it.
  const tempOutput = join(dirname(filepath), `${stem}.playable.mp4`);
  const finalOutput = join(dirname(filepath), `${stem}.mp4`);
  let lastError: unknown = null;
  for (const encoder of encoders) {
    if (signal?.aborted) throw new CancelledError();
    try {
      await ffmpeg.run(
        buildPlaybackTranscodeArgs({
          input: filepath,
          output: tempOutput,
          encoder,
          audioCodec: streams.audioCodec,
        }),
        {
          operationId: `${operationId}-playable`,
          signal,
          totalDuration: streams.durationSec ?? undefined,
          progress: onProgress,
        }
      );
      const stat = await fsp.stat(tempOutput);
      if (!stat.size) throw new Error('re-encode produced an empty file');
      await fsp.unlink(filepath).catch(() => {});
      await fsp.rename(tempOutput, finalOutput);
      log.info(
        `[URLprocessor] Re-encoded ${streams.videoCodec} to H.264 with ${encoder} (Op ID: ${operationId}).`
      );
      return {
        filepath: finalOutput,
        transcoded: true,
        fromCodec: streams.videoCodec,
      };
    } catch (error: any) {
      await fsp.unlink(tempOutput).catch(() => {});
      if (signal?.aborted) throw new CancelledError();
      lastError = error;
      log.warn(
        `[URLprocessor] ${encoder} re-encode failed (${error?.message || error}) (Op ID: ${operationId}).`
      );
    }
  }
  log.warn(
    `[URLprocessor] Could not re-encode for playback (${(lastError as any)?.message || lastError}); keeping the ${streams.videoCodec} file (Op ID: ${operationId}).`
  );
  return { filepath, transcoded: false, fromCodec: streams.videoCodec };
}
