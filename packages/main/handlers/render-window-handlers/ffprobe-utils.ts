import { spawn } from 'child_process';
import log from 'electron-log';

export async function probeFps(
  file: string,
  ffprobePath: string
): Promise<number> {
  log.info(`[ffprobe-utils] Probing FPS for ${file}`);
  return await new Promise((resolve, reject) => {
    const p = spawn(ffprobePath, [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate',
      '-of',
      'default=nw=1:nk=1',
      file,
    ]);
    let out = '';
    let err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));

    p.on('close', code => {
      if (code !== 0 || !out.trim()) {
        log.error(
          `[ffprobe-utils] Failed to probe FPS for ${file}. Code: ${code}, Stderr: ${err}`
        );
        return reject(
          new Error(`ffprobe failed (code ${code}): ${err || 'No output'}`)
        );
      }
      try {
        const [num, den] = out.trim().split('/').map(Number);
        if (isNaN(num) || isNaN(den) || den === 0) {
          log.error(
            `[ffprobe-utils] Invalid FPS format from ffprobe: ${out.trim()}`
          );
          return reject(
            new Error(`Invalid FPS format from ffprobe: ${out.trim()}`)
          );
        }
        const fps = num / den;
        log.info(`[ffprobe-utils] Detected FPS: ${fps} for ${file}`);
        resolve(fps);
      } catch (parseError: any) {
        log.error(
          `[ffprobe-utils] Error parsing ffprobe output: ${parseError.message}`
        );
        reject(
          new Error(`Error parsing ffprobe output: ${parseError.message}`)
        );
      }
    });

    p.on('error', spawnError => {
      log.error(
        `[ffprobe-utils] Spawn error for ffprobe: ${spawnError.message}`
      );
      reject(new Error(`Failed to spawn ffprobe: ${spawnError.message}`));
    });
  });
}

export type MergeSourceStreams = {
  /** First audio stream's codec, or null when there is none / unknown. */
  audioCodec: string | null;
  /** First video stream's bit rate (bits/s), falling back to the container's. */
  videoBitRate: number | null;
};

/** Best effort: never throws; unknown values come back null. */
export async function probeMergeSourceStreams(
  file: string,
  ffprobePath: string
): Promise<MergeSourceStreams> {
  const empty: MergeSourceStreams = { audioCodec: null, videoBitRate: null };
  return await new Promise(resolve => {
    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_type,codec_name,bit_rate:format=bit_rate',
        '-of',
        'json',
        file,
      ]);
    } catch {
      resolve(empty);
      return;
    }
    let out = '';
    p.stdout?.on('data', d => (out += d));
    p.on('error', () => resolve(empty));
    p.on('close', () => {
      try {
        const parsed = JSON.parse(out || '{}') as {
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            bit_rate?: string;
          }>;
          format?: { bit_rate?: string };
        };
        const streams = parsed.streams ?? [];
        const audio = streams.find(s => s.codec_type === 'audio');
        const video = streams.find(s => s.codec_type === 'video');
        const rate = (value?: string) => {
          const n = Number(value);
          return Number.isFinite(n) && n > 0 ? n : null;
        };
        resolve({
          audioCodec: audio?.codec_name?.toLowerCase() ?? null,
          videoBitRate: rate(video?.bit_rate) ?? rate(parsed.format?.bit_rate),
        });
      } catch {
        resolve(empty);
      }
    });
  });
}
