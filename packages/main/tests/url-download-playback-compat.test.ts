import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildPlaybackTranscodeArgs,
  ensurePlayableDownload,
  needsPlaybackTranscode,
  preferredH264Encoders,
} from '../services/url-processor/playback-compat.js';
import {
  minPreferredH264Height,
  withH264Preference,
} from '../services/url-processor/constants.js';

const probe = (videoCodec: string | null, pixelFormat = 'yuv420p') => ({
  videoCodec,
  pixelFormat,
  audioCodec: 'aac',
  durationSec: 12.6,
});

test('only codecs Chromium cannot play everywhere are re-encoded', () => {
  for (const codec of ['vp8', 'vp9', 'av1']) {
    assert.equal(needsPlaybackTranscode(probe(codec)), false, codec);
  }
  assert.equal(needsPlaybackTranscode(probe('h264')), false);
  assert.equal(needsPlaybackTranscode(probe('h264', 'yuvj420p')), false);
  // High 10 / 4:2:2 H.264 does not decode in Chromium.
  assert.equal(needsPlaybackTranscode(probe('h264', 'yuv420p10le')), true);
  for (const codec of ['hevc', 'mpeg4', 'prores', 'mpeg2video']) {
    assert.equal(needsPlaybackTranscode(probe(codec)), true, codec);
  }
  assert.equal(needsPlaybackTranscode(probe(null)), false, 'audio only');
  assert.equal(needsPlaybackTranscode(probe('mjpeg')), false, 'cover art');
});

test('Apple Silicon tries VideoToolbox first with libx264 as the fallback', () => {
  assert.deepEqual(preferredH264Encoders('darwin', 'arm64'), [
    'h264_videotoolbox',
    'libx264',
  ]);
  assert.deepEqual(preferredH264Encoders('darwin', 'x64'), ['libx264']);
  assert.deepEqual(preferredH264Encoders('win32', 'x64'), ['libx264']);
});

test('re-encode args produce 8-bit H.264 MP4 and keep AAC audio as is', () => {
  const args = buildPlaybackTranscodeArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    encoder: 'libx264',
    audioCodec: 'aac',
  });
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(after('-c:v'), 'libx264');
  assert.equal(after('-pix_fmt'), 'yuv420p');
  assert.equal(after('-c:a'), 'copy');
  assert.equal(after('-tag:v'), 'avc1');
  assert.equal(args.at(-1), 'out.mp4');
  const opus = buildPlaybackTranscodeArgs({
    input: 'in.webm',
    output: 'out.mp4',
    encoder: 'h264_videotoolbox',
    audioCodec: 'opus',
  });
  assert.equal(opus[opus.indexOf('-c:a') + 1], 'aac');
  assert.equal(opus[opus.indexOf('-c:v') + 1], 'h264_videotoolbox');
  const silent = buildPlaybackTranscodeArgs({
    input: 'in.mp4',
    output: 'out.mp4',
    encoder: 'libx264',
    audioCodec: null,
  });
  assert.equal(silent.includes('-c:a'), false);
});

async function scratch(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'playback-compat-'));
}

test('an HEVC download is replaced by an H.264 copy; VideoToolbox failure falls back to libx264', async () => {
  const dir = await scratch();
  const original = path.join(dir, 'download_1_abc.mp4');
  await fs.writeFile(original, 'hevc bytes');
  const used: string[] = [];
  const result = await ensurePlayableDownload({
    filepath: original,
    operationId: 'op',
    probe: async () => probe('hevc'),
    encoders: ['h264_videotoolbox', 'libx264'],
    ffmpeg: {
      ffprobePath: 'ffprobe',
      run: async args => {
        const encoder = args[args.indexOf('-c:v') + 1];
        used.push(encoder);
        if (encoder === 'h264_videotoolbox') {
          throw new Error('cannot create compression session');
        }
        await fs.writeFile(args.at(-1)!, 'h264 bytes');
      },
    },
  });
  assert.deepEqual(used, ['h264_videotoolbox', 'libx264']);
  assert.equal(result.transcoded, true);
  assert.equal(result.fromCodec, 'hevc');
  assert.equal(result.filepath, original);
  assert.equal(await fs.readFile(original, 'utf8'), 'h264 bytes');
  assert.deepEqual(await fs.readdir(dir), ['download_1_abc.mp4']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a non-mp4 download with a non-web codec ends up as .mp4', async () => {
  const dir = await scratch();
  const original = path.join(dir, 'download_2_x.mkv');
  await fs.writeFile(original, 'mpeg4');
  const result = await ensurePlayableDownload({
    filepath: original,
    operationId: 'op',
    probe: async () => probe('mpeg4'),
    encoders: ['libx264'],
    ffmpeg: {
      ffprobePath: 'ffprobe',
      run: async args => fs.writeFile(args.at(-1)!, 'h264'),
    },
  });
  assert.equal(result.filepath, path.join(dir, 'download_2_x.mp4'));
  assert.deepEqual(await fs.readdir(dir), ['download_2_x.mp4']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('playable files are untouched, and a failed re-encode keeps the original', async () => {
  const dir = await scratch();
  const original = path.join(dir, 'download_3_y.mp4');
  await fs.writeFile(original, 'h264');
  let ran = 0;
  const untouched = await ensurePlayableDownload({
    filepath: original,
    operationId: 'op',
    probe: async () => probe('h264'),
    ffmpeg: {
      ffprobePath: 'ffprobe',
      run: async () => {
        ran++;
      },
    },
  });
  assert.equal(ran, 0);
  assert.equal(untouched.transcoded, false);

  const failed = await ensurePlayableDownload({
    filepath: original,
    operationId: 'op',
    probe: async () => probe('hevc'),
    encoders: ['h264_videotoolbox', 'libx264'],
    ffmpeg: {
      ffprobePath: 'ffprobe',
      run: async args => {
        await fs.writeFile(args.at(-1)!, 'partial');
        throw new Error('ffmpeg exited with code 1');
      },
    },
  });
  assert.equal(failed.transcoded, false);
  assert.equal(failed.filepath, original);
  assert.deepEqual(await fs.readdir(dir), ['download_3_y.mp4']);

  const unprobeable = await ensurePlayableDownload({
    filepath: original,
    operationId: 'op',
    probe: async () => {
      throw new Error('ffprobe missing');
    },
    ffmpeg: { ffprobePath: 'ffprobe', run: async () => {} },
  });
  assert.equal(unprobeable.filepath, original);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a cancelled re-encode reports cancellation and leaves no temp file', async () => {
  const dir = await scratch();
  const original = path.join(dir, 'download_4_z.mp4');
  await fs.writeFile(original, 'hevc');
  const controller = new AbortController();
  await assert.rejects(
    ensurePlayableDownload({
      filepath: original,
      operationId: 'op',
      signal: controller.signal,
      probe: async () => probe('hevc'),
      encoders: ['h264_videotoolbox', 'libx264'],
      ffmpeg: {
        ffprobePath: 'ffprobe',
        run: async args => {
          await fs.writeFile(args.at(-1)!, 'partial');
          controller.abort();
          throw new Error('Operation aborted');
        },
      },
    }),
    (error: Error) => error.name === 'CancelledError'
  );
  assert.deepEqual(await fs.readdir(dir), ['download_4_z.mp4']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('format selection prefers H.264 within ~2/3 of the wanted size, portrait by width', () => {
  assert.equal(minPreferredH264Height(1080), 720);
  assert.equal(minPreferredH264Height(2160), 1440);
  assert.equal(minPreferredH264Height(480), 360);
  assert.equal(minPreferredH264Height(240), 240);
  const base = 'bv*[height<=1080]+ba/b[height<=1080]';
  const format = withH264Preference(base, 1080);
  assert.ok(format.endsWith(`/${base}`));
  assert.ok(
    format.startsWith(
      "bv*[vcodec~='^(?:avc|h264)'][aspect_ratio>=1][height>=720][height<=1080]+ba/"
    )
  );
  assert.ok(format.includes('[aspect_ratio<1][width>=720][width<=1080]'));
  // "Best" stays best: no codec-first alternative.
  assert.equal(
    withH264Preference('bestvideo+bestaudio/best', null),
    'bestvideo+bestaudio/best'
  );
});
