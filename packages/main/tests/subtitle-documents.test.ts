import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SrtSegment } from '@shared-types/app';
import {
  detachSubtitleDocumentSource,
  findSubtitleDocumentForFile,
  findSubtitleDocumentForSource,
  readSubtitleDocument,
  saveSubtitleDocumentRecord,
} from '../services/subtitle-documents.js';
import { buildSavedSubtitleSrt } from '../../renderer/utils/canonical-subtitle-srt.js';

async function withTempDir<T>(fn: (rootDir: string) => Promise<T>): Promise<T> {
  const rootDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'stage5-subtitle-documents-')
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
      start: 0,
      end: 2,
      original: 'Hello world',
      translation: 'Hola mundo',
      words: [
        { start: 0.1, end: 0.5, word: 'Hello' },
        { start: 0.7, end: 1.1, word: 'world' },
      ],
    },
  ];
}

test('subtitle document records persist and restore segments', async () => {
  await withTempDir(async rootDir => {
    const segments = createSegments();
    const document = await saveSubtitleDocumentRecord({
      segments,
      title: 'My subtitles',
      rootDir,
    });

    const restored = await readSubtitleDocument({
      documentId: document.id,
      rootDir,
    });

    assert.ok(restored);
    assert.equal(restored?.document.title, 'My subtitles');
    assert.deepEqual(restored?.segments[0].words, segments[0].words);
  });
});

test('subtitle documents resolve by linked SRT file and fingerprint', async () => {
  await withTempDir(async rootDir => {
    const segments = createSegments();
    const srtContent = buildSavedSubtitleSrt(segments, 'original');
    const filePath = '/Users/test/Documents/subtitles.srt';

    const document = await saveSubtitleDocumentRecord({
      segments,
      importFilePath: filePath,
      importSrtContent: srtContent,
      importMode: 'original',
      rootDir,
    });

    const matched = await findSubtitleDocumentForFile({
      filePath,
      srtContent,
      rootDir,
    });
    const stale = await findSubtitleDocumentForFile({
      filePath,
      srtContent: `${srtContent}\n`,
      rootDir,
    });

    assert.equal(matched?.document.id, document.id);
    assert.equal(matched?.fileMode, 'original');
    assert.equal(matched?.fileRole, 'import');
    assert.equal(stale, null);
  });
});

test('subtitle documents resolve by current video source', async () => {
  await withTempDir(async rootDir => {
    const first = await saveSubtitleDocumentRecord({
      segments: createSegments(),
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      rootDir,
    });

    await saveSubtitleDocumentRecord({
      segments: [
        {
          ...createSegments()[0],
          id: 'seg-2',
          original: 'Most recent',
        },
      ],
      sourceVideoPath: '/Users/test/Videos/interview-renamed.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      rootDir,
    });

    const matched = await findSubtitleDocumentForSource({
      sourceVideoAssetIdentity: 'asset:123',
      rootDir,
    });

    assert.ok(matched);
    assert.notEqual(matched?.document.id, first.id);
    assert.equal(matched?.segments[0].original, 'Most recent');
  });
});

test('subtitle documents do not path-match a replaced video when asset identity disagrees', async () => {
  await withTempDir(async rootDir => {
    await saveSubtitleDocumentRecord({
      segments: createSegments(),
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:old',
      rootDir,
    });

    const matched = await findSubtitleDocumentForSource({
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:new',
      rootDir,
    });

    assert.equal(matched, null);
  });
});

test('subtitle documents do not URL-match a different asset revision when asset identity disagrees', async () => {
  await withTempDir(async rootDir => {
    await saveSubtitleDocumentRecord({
      segments: [
        {
          ...createSegments()[0],
          id: 'seg-old',
          original: 'Old asset subtitle',
        },
      ],
      sourceUrl: 'https://example.com/watch?v=123',
      sourceVideoAssetIdentity: 'asset:old',
      rootDir,
    });

    await saveSubtitleDocumentRecord({
      segments: [
        {
          ...createSegments()[0],
          id: 'seg-new',
          original: 'New asset subtitle',
        },
      ],
      sourceUrl: 'https://example.com/watch?v=123',
      sourceVideoAssetIdentity: 'asset:new',
      rootDir,
    });

    const matched = await findSubtitleDocumentForSource({
      sourceUrl: 'https://example.com/watch?v=123',
      sourceVideoAssetIdentity: 'asset:old',
      rootDir,
    });

    assert.ok(matched);
    assert.equal(matched?.document.sourceVideoAssetIdentity, 'asset:old');
    assert.equal(matched?.segments[0].original, 'Old asset subtitle');
  });
});

test('subtitle documents prefer the requested subtitle variant over a newer source match', async () => {
  await withTempDir(async rootDir => {
    await saveSubtitleDocumentRecord({
      segments: createSegments(),
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
      rootDir,
    });

    await saveSubtitleDocumentRecord({
      segments: [
        {
          ...createSegments()[0],
          id: 'seg-2',
          original: 'Newest transcript',
        },
      ],
      sourceVideoPath: '/Users/test/Videos/interview-renamed.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      subtitleKind: 'transcription',
      rootDir,
    });

    const translationMatch = await findSubtitleDocumentForSource({
      sourceVideoAssetIdentity: 'asset:123',
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
      rootDir,
    });
    const transcriptMatch = await findSubtitleDocumentForSource({
      sourceVideoAssetIdentity: 'asset:123',
      subtitleKind: 'transcription',
      rootDir,
    });

    assert.ok(translationMatch);
    assert.equal(translationMatch?.document.subtitleKind, 'translation');
    assert.equal(translationMatch?.document.targetLanguage, 'spanish');
    assert.equal(translationMatch?.segments[0].original, 'Hello world');

    assert.ok(transcriptMatch);
    assert.equal(transcriptMatch?.document.subtitleKind, 'transcription');
    assert.equal(transcriptMatch?.segments[0].original, 'Newest transcript');
  });
});

test('linked file reopen uses the fingerprint-matched snapshot instead of the latest document state', async () => {
  await withTempDir(async rootDir => {
    const importedSegments = createSegments();
    const importedSrt = buildSavedSubtitleSrt(importedSegments, 'dual');
    const document = await saveSubtitleDocumentRecord({
      segments: importedSegments,
      importFilePath: '/Users/test/Documents/input.srt',
      importSrtContent: importedSrt,
      importMode: 'dual',
      rootDir,
    });

    const editedSegments = [
      {
        ...importedSegments[0],
        original: 'Edited hello world',
        translation: 'Hola editado',
      },
    ];
    const exportedSrt = buildSavedSubtitleSrt(editedSegments, 'dual');

    await saveSubtitleDocumentRecord({
      documentId: document.id,
      segments: editedSegments,
      importFilePath: '/Users/test/Documents/input.srt',
      exportFilePath: '/Users/test/Documents/output.srt',
      exportSrtContent: exportedSrt,
      exportMode: 'dual',
      rootDir,
    });

    const reopenedImport = await findSubtitleDocumentForFile({
      filePath: '/Users/test/Documents/input.srt',
      srtContent: importedSrt,
      rootDir,
    });
    const reopenedExport = await findSubtitleDocumentForFile({
      filePath: '/Users/test/Documents/output.srt',
      srtContent: exportedSrt,
      rootDir,
    });

    assert.ok(reopenedImport);
    assert.equal(reopenedImport?.document.id, document.id);
    assert.equal(reopenedImport?.fileRole, 'import');
    assert.equal(reopenedImport?.fileMode, 'dual');
    assert.equal(reopenedImport?.segments?.[0].original, 'Hello world');
    assert.equal(reopenedImport?.segments?.[0].translation, 'Hola mundo');

    assert.ok(reopenedExport);
    assert.equal(reopenedExport?.document.id, document.id);
    assert.equal(reopenedExport?.fileRole, 'export');
    assert.equal(reopenedExport?.fileMode, 'dual');
    assert.equal(reopenedExport?.segments?.[0].original, 'Edited hello world');
    assert.equal(reopenedExport?.segments?.[0].translation, 'Hola editado');
  });
});

test('document metadata preserves the active linked file target for source auto-mount restores', async () => {
  await withTempDir(async rootDir => {
    const segments = createSegments();
    const originalSrt = buildSavedSubtitleSrt(segments, 'original');

    const document = await saveSubtitleDocumentRecord({
      segments,
      importFilePath: '/Users/test/Documents/input.srt',
      importSrtContent: originalSrt,
      importMode: 'original',
      activeLinkedFilePath: '/Users/test/Documents/output-translation.srt',
      activeLinkedFileMode: 'translation',
      activeLinkedFileRole: 'export',
      exportFilePath: '/Users/test/Documents/output-translation.srt',
      exportSrtContent: buildSavedSubtitleSrt(segments, 'translation'),
      exportMode: 'translation',
      rootDir,
    });

    const restored = await readSubtitleDocument({
      documentId: document.id,
      rootDir,
    });

    assert.ok(restored);
    assert.equal(
      restored?.document.activeLinkedFilePath,
      '/Users/test/Documents/output-translation.srt'
    );
    assert.equal(restored?.document.activeLinkedFileMode, 'translation');
    assert.equal(restored?.document.activeLinkedFileRole, 'export');
  });
});

test('detaching a subtitle document source stops source auto-mount while preserving linked file reopen', async () => {
  await withTempDir(async rootDir => {
    const segments = createSegments();
    const srtContent = buildSavedSubtitleSrt(segments, 'dual');
    const filePath = '/Users/test/Documents/subtitles.srt';

    const document = await saveSubtitleDocumentRecord({
      segments,
      importFilePath: filePath,
      importSrtContent: srtContent,
      importMode: 'dual',
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: 'https://example.com/watch?v=123',
      rootDir,
    });

    const detached = await detachSubtitleDocumentSource({
      documentId: document.id,
      rootDir,
    });
    const sourceMatch = await findSubtitleDocumentForSource({
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: 'https://example.com/watch?v=123',
      rootDir,
    });
    const fileMatch = await findSubtitleDocumentForFile({
      filePath,
      srtContent,
      rootDir,
    });

    assert.ok(detached);
    assert.equal(detached?.sourceVideoPath, null);
    assert.equal(detached?.sourceVideoAssetIdentity, null);
    assert.equal(detached?.sourceUrl, null);
    assert.equal(sourceMatch, null);
    assert.ok(fileMatch);
    assert.equal(fileMatch?.document.id, document.id);
    assert.equal(fileMatch?.segments?.[0].original, 'Hello world');
  });
});
