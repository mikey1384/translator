import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { processVideoUrl } from '../services/url-processor/index.js';

test('processVideoUrl carries a caption-only download result without requiring media', async t => {
  const tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'translator-process-caption-result-')
  );
  t.after(() => fsp.rm(tempDir, { recursive: true, force: true }));

  const result = await processVideoUrl(
    'https://www.youtube.com/watch?v=fixture',
    '360p',
    undefined,
    'caption-result-test',
    {
      fileManager: { getTempDir: () => tempDir } as any,
      ffmpeg: {} as any,
    },
    {
      downloadVideoFromPlatformImpl: (async () => ({
        kind: 'automatic_captions',
        subtitles: '1\n00:00:00,000 --> 00:00:01,000\nAutomatic caption\n',
        languageCode: 'en-orig',
        info: {
          title: 'Fixture title',
          duration: 1,
        },
      })) as any,
    }
  );

  assert.deepEqual(result, {
    kind: 'automatic_captions',
    subtitles: '1\n00:00:00,000 --> 00:00:01,000\nAutomatic caption\n',
    captionLanguageCode: 'en-orig',
    title: 'Fixture title',
    thumbnailUrl: undefined,
    channel: undefined,
    channelUrl: undefined,
    durationSec: 1,
    uploadedAt: undefined,
  });
  assert.deepEqual(await fsp.readdir(tempDir), []);
});
