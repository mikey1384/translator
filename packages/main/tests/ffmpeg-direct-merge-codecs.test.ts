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

test('VideoToolbox gets an explicit bitrate instead of ignored crf/preset', () => {
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
  assert.equal(args[args.indexOf('-b:v') + 1], String(1_610_000));
});

test('software encoder keeps its quality flags', () => {
  assert.deepEqual(
    mergeVideoCodecArgs({ platform: 'win32', width: 1920, height: 1080 }),
    ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22']
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
    40_000_000
  );
  assert.equal(
    hardwareTargetBitRate({ width: 320, height: 240, sourceVideoBitRate: 1 }),
    1_000_000
  );
});
