import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { ffmpegPath } from 'ffmpeg-ffprobe-static';
import {
  representativeFrameArgs,
  representativeFrameRevision,
  representativeFrameScriptResolution,
} from '../utils/agent-representative-frame.js';

import { createHash } from 'node:crypto';
import {
  readAgentOutputReceipt,
  writeAgentOutputReceipt,
} from '../utils/agent-output-receipt.js';

const run = promisify(execFile);
if (!ffmpegPath)
  throw new Error('Bundled FFmpeg is required for preview regression tests.');
const binary = ffmpegPath;

test('seeked preview shows the matching cue and stays empty outside its interval', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-preview-clock-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const videoPath = path.join(root, 'source.mp4');
  const srtPath = path.join(root, 'captions.srt');
  await fs.writeFile(srtPath, '1\n00:00:01,000 --> 00:00:02,000\nTEST\n');
  await run(binary, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=black:size=1280x720:rate=25:duration=3',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    videoPath,
  ]);
  const escaped = srtPath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
  const subtitleFilter = `subtitles='${escaped}':force_style='${representativeFrameScriptResolution(1280, 720)},FontSize=60,Outline=0,Shadow=0'`;
  async function pixels(positionSeconds: number, subtitles: boolean) {
    const outputPath = path.join(root, `${positionSeconds}-${subtitles}.png`);
    await run(
      binary,
      representativeFrameArgs({
        videoPath,
        outputPath,
        positionSeconds,
        subtitleFilter: subtitles ? subtitleFilter : null,
      })
    );
    return fs.readFile(outputPath);
  }
  assert.notDeepEqual(await pixels(1.5, true), await pixels(1.5, false));
  assert.deepEqual(await pixels(0.5, true), await pixels(0.5, false));
  assert.deepEqual(await pixels(2.5, true), await pixels(2.5, false));
  const { stdout } = await run(
    binary,
    [
      '-i',
      path.join(root, '1.5-true.png'),
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      'pipe:1',
    ],
    { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 }
  );
  const rows = [];
  for (let y = 0; y < 720; y++) {
    if (stdout.subarray(y * 1280, (y + 1) * 1280).some(pixel => pixel > 200))
      rows.push(y);
  }
  const glyphHeight = Math.max(...rows) - Math.min(...rows) + 1;
  assert.ok(
    glyphHeight >= 35 && glyphHeight <= 65,
    `60 px font rendered at ${glyphHeight} px glyph height`
  );
});

test('preview receipts are invalidated by source, cue, position, or styling changes', () => {
  const input = {
    sourceSnapshot: 'source-a',
    positionsSeconds: [1, 2, 3],
    srtContent: 'original',
    subtitleStyle: 'LineBox',
    subtitleFontSize: 60,
    subtitleFontSha256: 'font-a',
  };
  const revision = representativeFrameRevision(input);
  assert.equal(representativeFrameRevision({ ...input }), revision);
  for (const change of [
    { sourceSnapshot: 'source-b' },
    { positionsSeconds: [2, 3, 4] },
    { srtContent: 'translated' },
    { subtitleStyle: 'Default' },
    { subtitleFontSize: 40 },
    { subtitleFontSha256: 'font-b' },
  ]) {
    assert.notEqual(
      representativeFrameRevision({ ...input, ...change }),
      revision
    );
  }
});

test('legacy preview receipts prove ownership but cannot satisfy new render inputs', async t => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'translator-preview-receipt-')
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, 'preview.png');
  const bytes = Buffer.from('existing preview');
  const identity = {
    outputPath,
    operationId: 'preview-job-1',
    kind: 'preview_frame_1',
  };
  const fingerprint = {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const inputSha256 = createHash('sha256')
    .update('corrected renderer')
    .digest('hex');
  await fs.writeFile(outputPath, bytes);
  await writeAgentOutputReceipt({ ...identity, ...fingerprint });
  assert.ok(await readAgentOutputReceipt(identity));
  assert.equal(
    await readAgentOutputReceipt({ ...identity, inputSha256 }),
    null
  );
  await writeAgentOutputReceipt({ ...identity, ...fingerprint, inputSha256 });
  assert.ok(await readAgentOutputReceipt({ ...identity, inputSha256 }));
  assert.equal(
    await readAgentOutputReceipt({ ...identity, inputSha256: '0'.repeat(64) }),
    null
  );
  await fs.writeFile(outputPath, 'user modification');
  assert.equal(await readAgentOutputReceipt(identity), null);
});
