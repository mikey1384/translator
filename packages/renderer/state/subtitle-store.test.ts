import test from 'node:test';
import assert from 'node:assert/strict';

import { useSubStore } from './subtitle-store';

test('clearConfidence preserves word timings while clearing Whisper review hints', () => {
  const words = [
    { start: 0.1, end: 0.4, word: 'Hello' },
    { start: 0.5, end: 0.9, word: 'world' },
  ];

  useSubStore.getState().load(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Hello world',
        avg_logprob: -0.32,
        no_speech_prob: 0.04,
        words,
      },
    ],
    '/tmp/test.srt',
    'disk',
    null,
    'whisper'
  );

  useSubStore.getState().clearConfidence();

  const cue = useSubStore.getState().segments['seg-1'];
  assert.ok(cue);
  assert.equal(cue.avg_logprob, undefined);
  assert.equal(cue.no_speech_prob, undefined);
  assert.deepEqual(cue.words, words);
  assert.equal(useSubStore.getState().transcriptionEngine, null);
});

test('document-backed loads preserve subtitle variant metadata without requiring a library link', () => {
  useSubStore.getState().load(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    null,
    'fresh',
    '/Users/test/Videos/interview.mp4',
    null,
    null,
    'asset:123',
    {
      id: 'doc-1',
      title: 'Spanish translation',
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      sourceUrl: 'https://example.com/watch?v=123',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  );

  const state = useSubStore.getState();
  assert.equal(state.documentId, 'doc-1');
  assert.equal(state.subtitleKind, 'translation');
  assert.equal(state.targetLanguage, 'spanish');
  assert.equal(state.libraryEntryId, null);
  assert.equal(state.sourceUrl, 'https://example.com/watch?v=123');
});

test('caption-only loads keep automatic-caption provenance and no transcription source', () => {
  useSubStore.getState().load(
    [
      {
        id: 'caption-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Fixture automatic caption',
      },
    ],
    null,
    'fresh',
    null,
    null,
    null,
    null,
    {
      title: 'Fixture automatic captions',
      sourceVideoPath: null,
      sourceVideoAssetIdentity: null,
      sourceUrl: 'https://www.youtube.com/watch?v=fixture',
      sourceProvenance: 'youtube_automatic_captions',
      subtitleKind: null,
      targetLanguage: null,
    }
  );

  const state = useSubStore.getState();
  assert.equal(state.sourceProvenance, 'youtube_automatic_captions');
  assert.equal(state.sourceVideoPath, null);
  assert.equal(state.sourceVideoAssetIdentity, null);
  assert.equal(state.transcriptionEngine, null);
  assert.equal(state.subtitleKind, null);
});

test('translated caption documents retain automatic-caption provenance', () => {
  useSubStore.getState().load(
    [
      {
        id: 'translated-caption-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Fixture automatic caption',
        translation: 'Translated fixture caption',
      },
    ],
    null,
    'fresh',
    null,
    null,
    null,
    null,
    {
      id: 'translated-caption-document',
      title: 'Fixture automatic captions',
      sourceUrl: 'https://www.youtube.com/watch?v=fixture',
      sourceProvenance: 'youtube_automatic_captions',
      subtitleKind: 'translation',
      targetLanguage: 'ko',
    }
  );

  const state = useSubStore.getState();
  assert.equal(state.sourceProvenance, 'youtube_automatic_captions');
  assert.equal(state.subtitleKind, 'translation');
  assert.equal(state.targetLanguage, 'ko');
  assert.equal(state.transcriptionEngine, null);
});

test('disk-backed document load preserves import linkage while reopening a different linked file as the active target', () => {
  useSubStore.getState().load(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    '/Users/test/Subtitles/output-v1.srt',
    'disk',
    '/Users/test/Videos/interview.mp4',
    null,
    null,
    'asset:123',
    {
      id: 'doc-1',
      title: 'Known document',
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
      importFilePath: '/Users/test/Subtitles/input.srt',
      lastExportPath: '/Users/test/Subtitles/output-v2.srt',
      sourceVideoPath: '/Users/test/Videos/interview.mp4',
      sourceVideoAssetIdentity: 'asset:123',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  );

  const state = useSubStore.getState();
  assert.equal(state.originalPath, '/Users/test/Subtitles/input.srt');
  assert.equal(state.activeFilePath, '/Users/test/Subtitles/output-v1.srt');
  assert.equal(state.exportPath, '/Users/test/Subtitles/output-v2.srt');
});

test('disk-backed document load preserves the document source association when no explicit video override is provided', () => {
  useSubStore.getState().load(
    [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1.2,
        original: 'Hola',
        translation: 'Hello',
      },
    ],
    '/Users/test/Subtitles/input.srt',
    'disk',
    null,
    null,
    null,
    undefined,
    {
      id: 'doc-1',
      title: 'Known document',
      subtitleKind: 'translation',
      targetLanguage: 'spanish',
      importFilePath: '/Users/test/Subtitles/input.srt',
      sourceVideoPath: '/Users/test/Videos/original.mp4',
      sourceVideoAssetIdentity: 'asset:original',
      sourceUrl: 'https://example.com/watch?v=original',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }
  );

  const state = useSubStore.getState();
  assert.equal(state.sourceVideoPath, '/Users/test/Videos/original.mp4');
  assert.equal(state.sourceVideoAssetIdentity, 'asset:original');
  assert.equal(state.sourceUrl, 'https://example.com/watch?v=original');
});

test('setExportPath updates the active file target after an explicit export', () => {
  useSubStore
    .getState()
    .setExportPath(
      '/Users/test/Subtitles/output-v2.srt',
      'translation',
      'export'
    );

  const state = useSubStore.getState();
  assert.equal(state.exportPath, '/Users/test/Subtitles/output-v2.srt');
  assert.equal(state.activeFilePath, '/Users/test/Subtitles/output-v2.srt');
  assert.equal(state.activeFileMode, 'translation');
  assert.equal(state.activeFileRole, 'export');
});
