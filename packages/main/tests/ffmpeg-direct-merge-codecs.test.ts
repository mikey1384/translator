import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hardwareTargetBitRate,
  mergeAudioCodecArgs,
  mergeVideoCodecArgs,
} from '../handlers/render-window-handlers/ffmpeg-direct-merge.js';

test('MP4-safe audio is copied; anything else becomes AAC', () => {
  for (const codec of ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'AAC']) {
    assert.deepEqual(mergeAudioCodecArgs(codec), ['-c:a', 'copy'], codec);
  }
  for (const codec of ['vorbis', 'opus', 'dts', 'pcm_s16le', null, undefined]) {
    assert.deepEqual(
      mergeAudioCodecArgs(codec),
      ['-c:a', 'aac', '-b:a', '192k'],
      String(codec)
    );
  }
});

test('H.264 subtitle budget cannot be driven down by an efficient source codec', () => {
  const args = mergeVideoCodecArgs({
    platform: 'darwin',
    width: 1280,
    height: 720,
    frameRate: 24,
    sourceVideoBitRate: 1_400_000,
  });
  assert.equal(args[1], 'h264_videotoolbox');
  assert.ok(!args.includes('-crf'));
  assert.ok(!args.includes('-preset'));
  assert.equal(args[args.indexOf('-b:v') + 1], String(2_211_840));
});

test('software encoder keeps its quality flags', () => {
  assert.deepEqual(
    mergeVideoCodecArgs({ platform: 'win32', width: 1920, height: 1080 }),
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
  );
});

test('hardware bitrate falls back to frame size and stays clamped', () => {
  assert.equal(
    hardwareTargetBitRate({ width: 1280, height: 720, frameRate: 30 }),
    2_764_800
  );
  assert.equal(
    hardwareTargetBitRate({
      width: 3840,
      height: 2160,
      sourceVideoBitRate: 120_000_000,
    }),
    80_000_000
  );
  assert.equal(
    hardwareTargetBitRate({ width: 320, height: 240, sourceVideoBitRate: 1 }),
    1_000_000
  );
});

test('production low-rate AV1 and 4K60 keep a resolution/frame-rate floor', () => {
  assert.equal(
    hardwareTargetBitRate({
      width: 1920,
      height: 1080,
      frameRate: 30000 / 1001,
      sourceVideoBitRate: 749000,
    }),
    6214585
  );
  assert.equal(
    hardwareTargetBitRate({
      width: 3840,
      height: 2160,
      frameRate: 60,
      sourceVideoBitRate: 749000,
    }),
    49766400
  );
  assert.equal(
    hardwareTargetBitRate({
      width: 1920,
      height: 1080,
      sourceVideoBitRate: Number.NaN,
    }),
    6220800
  );
  assert.throws(
    () => hardwareTargetBitRate({ width: 0, height: 1080 }),
    /dimensions/
  );
});
