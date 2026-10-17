import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { audioStreamMapSpecifier } from '../services/subtitle-processing/audio-stream-map';

test('the probed audio stream index maps as an absolute stream', () => {
  // ffprobe reports index 1 for the first audio track of a normal video.
  assert.equal(audioStreamMapSpecifier('1'), '0:1');
});

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 &&
  spawnSync('ffprobe', ['-version']).status === 0;

test(
  'with two audio tracks the first one is used',
  { skip: !hasFfmpeg && 'ffmpeg not installed' },
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-map-'));
    try {
      const input = path.join(dir, 'two.mkv');
      // Video, a tone on the first audio track, silence on the second.
      execFileSync('ffmpeg', [
        '-v', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1',
        '-map', '0', '-map', '1', '-map', '2', '-shortest', input,
      ]); // prettier-ignore
      const first =
        execFileSync('ffprobe', [
        '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=index', '-of', 'csv=p=0', input,
      ]) // prettier-ignore
          .toString()
          .trim()
          .split('\n')[0];
      const output = path.join(dir, 'out.wav');
      execFileSync('ffmpeg', [
        '-v', 'error', '-y', '-i', input,
        '-map', audioStreamMapSpecifier(first), output,
      ]); // prettier-ignore
      const stats = spawnSync(
        'ffmpeg',
        ['-i', output, '-af', 'volumedetect', '-f', 'null', '-'],
        { encoding: 'utf8' }
      ).stderr;
      const mean = Number(/mean_volume: (-?[\d.]+) dB/.exec(stats)?.[1]);
      assert.ok(mean > -60, `expected the tone track, got ${mean} dB`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
