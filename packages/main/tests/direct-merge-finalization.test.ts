import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { directMerge } from '../handlers/render-window-handlers/ffmpeg-direct-merge.js';

test(
  'VideoToolbox startup failure falls back once, preserves quality settings and waits for finalization',
  { skip: process.platform !== 'darwin' },
  async t => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), 'merge-finalization-')
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const fake = path.join(root, 'encoder.mjs'),
      output = path.join(root, 'finished.mp4');
    await fs.writeFile(
      fake,
      `#!${process.execPath}
import fs from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('h264_videotoolbox')){process.stderr.write('Error: cannot create compression session: -12908\\n');process.exit(1);}
process.stderr.write('Starting second pass: moving the moov atom to the beginning\\n');
process.stdout.write('out_time_ms=1000000\\nprogress=end\\n');
setTimeout(()=>{fs.writeFileSync(args.at(-1),JSON.stringify(args));},120);
`,
      { mode: 0o700 }
    );
    const events: Array<{ percent: number; stage: string; exists: boolean }> =
      [];
    let attempts = 0;
    const result = await directMerge({
      concatListPath: 'captions.txt',
      baseVideoPath: 'source.mp4',
      outputSavePath: output,
      videoWidth: 1920,
      videoHeight: 1080,
      frameRate: 30,
      videoDuration: 1,
      sourceVideoBitRate: 749000,
      sourceVideoCodec: 'av1',
      sourceAudioCodec: 'aac',
      operationId: 'fallback-regression',
      ffmpegPath: fake,
      registerProcess: () => {
        attempts++;
      },
      progressCallback: p =>
        events.push({ ...p, exists: requireFileExists(output) }),
    });
    assert.equal(attempts, 2);
    assert.equal(result.diagnostics.softwareFallback, true);
    assert.equal(result.diagnostics.rateControl, 'constant-quality');
    assert.equal(result.diagnostics.targetBitRate, null);
    assert.equal(result.diagnostics.sourceVideoCodec, 'av1');
    const args = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(args[args.indexOf('-crf') + 1], '20');
    assert.equal(args[args.indexOf('-movflags') + 1], '+faststart');
    assert.ok(
      events.some(e => e.stage === 'Finalising container…' && !e.exists)
    );
    assert.ok(
      events.filter(e => e.stage === 'Encoding complete!').every(e => e.exists)
    );
    assert.ok(events.every(e => e.percent < 100));
  }
);

import { existsSync as requireFileExists } from 'node:fs';

test('disk failure and cancellation never masquerade as a recoverable hardware failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-failure-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fake = path.join(root, 'encoder.mjs');
  await fs.writeFile(
    fake,
    `#!${process.execPath}\nprocess.stderr.write('cannot create compression session\\nNo space left on device\\n');process.exit(1);`,
    { mode: 0o700 }
  );
  let attempts = 0;
  await assert.rejects(
    directMerge({
      concatListPath: 'captions.txt',
      baseVideoPath: 'source.mp4',
      outputSavePath: path.join(root, 'output.mp4'),
      videoWidth: 1920,
      videoHeight: 1080,
      videoDuration: 1,
      operationId: 'disk-full-regression',
      ffmpegPath: fake,
      registerProcess: () => {
        attempts++;
      },
      progressCallback: () => {},
    }),
    /insufficient-disk-space/
  );
  assert.equal(attempts, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    directMerge({
      concatListPath: 'captions.txt',
      baseVideoPath: 'source.mp4',
      outputSavePath: path.join(root, 'cancelled.mp4'),
      videoWidth: 1920,
      videoHeight: 1080,
      videoDuration: 1,
      operationId: 'cancel-regression',
      ffmpegPath: fake,
      signal: controller.signal,
      progressCallback: () => {},
    }),
    /Cancelled/
  );
});
