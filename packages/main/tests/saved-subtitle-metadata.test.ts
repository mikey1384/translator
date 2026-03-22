import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  getSavedSubtitleMetadataCachePath,
  readSavedSubtitleMetadata,
  saveSavedSubtitleMetadata,
} from '../services/saved-subtitle-metadata.js';
import { buildSrt } from '../../shared/helpers/index.js';
import type { SrtSegment } from '@shared-types/app';

async function withTempDir<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'stage5-saved-subtitle-metadata-')
  );
  try {
    return await fn(rootDir);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
}

function createSegments(): SrtSegment[] {
  return [
    {
      id: 'seg-1',
      index: 1,
      start: 1,
      end: 3,
      original: 'Hello world',
      translation: 'Hola mundo',
      words: [
        { start: 0.1, end: 0.6, word: 'Hello' },
        { start: 0.8, end: 1.3, word: 'world' },
      ],
    },
  ];
}

test('saved subtitle metadata cache restores matching structured segments', async () => {
  await withTempDir(async rootDir => {
    const filePath = '/Users/test/Documents/subtitles.srt';
    const segments = createSegments();
    const srtContent = buildSrt({ segments, mode: 'translation' });

    await saveSavedSubtitleMetadata({
      filePath,
      srtContent,
      segments,
      rootDir,
    });

    const restored = await readSavedSubtitleMetadata({
      filePath,
      srtContent,
      rootDir,
    });

    assert.ok(restored);
    assert.equal(restored?.[0].original, 'Hello world');
    assert.equal(restored?.[0].translation, 'Hola mundo');
    assert.deepEqual(restored?.[0].words, segments[0].words);
  });
});

test('saved subtitle metadata cache ignores stale content fingerprints', async () => {
  await withTempDir(async rootDir => {
    const filePath = '/Users/test/Documents/subtitles.srt';
    const segments = createSegments();
    const srtContent = buildSrt({ segments, mode: 'dual' });

    await saveSavedSubtitleMetadata({
      filePath,
      srtContent,
      segments,
      rootDir,
    });

    const restored = await readSavedSubtitleMetadata({
      filePath,
      srtContent: `${srtContent}\n`,
      rootDir,
    });

    assert.equal(restored, null);
  });
});

test('saved subtitle metadata cache keys entries by saved file path', async () => {
  await withTempDir(async rootDir => {
    const firstPath = '/Users/test/Documents/first.srt';
    const secondPath = '/Users/test/Documents/second.srt';
    const firstSegments = createSegments();
    const secondSegments = [
      {
        ...createSegments()[0],
        id: 'seg-2',
        original: 'Different text',
      },
    ];
    const firstContent = buildSrt({
      segments: firstSegments,
      mode: 'original',
    });
    const secondContent = buildSrt({
      segments: secondSegments,
      mode: 'original',
    });

    await saveSavedSubtitleMetadata({
      filePath: firstPath,
      srtContent: firstContent,
      segments: firstSegments,
      rootDir,
    });
    await saveSavedSubtitleMetadata({
      filePath: secondPath,
      srtContent: secondContent,
      segments: secondSegments,
      rootDir,
    });

    assert.notEqual(
      getSavedSubtitleMetadataCachePath(firstPath, rootDir),
      getSavedSubtitleMetadataCachePath(secondPath, rootDir)
    );

    const firstRestored = await readSavedSubtitleMetadata({
      filePath: firstPath,
      srtContent: firstContent,
      rootDir,
    });
    const secondRestored = await readSavedSubtitleMetadata({
      filePath: secondPath,
      srtContent: secondContent,
      rootDir,
    });

    assert.equal(firstRestored?.[0].original, 'Hello world');
    assert.equal(secondRestored?.[0].original, 'Different text');
  });
});
