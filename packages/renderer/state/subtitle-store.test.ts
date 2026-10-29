import test from 'node:test';
import assert from 'node:assert/strict';

import { replaceLiteral, useSubStore } from './subtitle-store';

test('structured translations match stable cue IDs even with identical timestamps', () => {
  const cues = ['a', 'b', 'c'].map((id, index) => ({
    id,
    index: index + 1,
    start: 1,
    end: 2,
    original: 'Two\nsource lines',
  }));
  useSubStore.getState().load(cues);
  useSubStore
    .getState()
    .applyTranslations([{ ...cues[1], translation: '두 줄' }], {
      markDirty: true,
      matchByIndex: false,
    });
  assert.equal(useSubStore.getState().segments.a.translation, undefined);
  assert.equal(useSubStore.getState().segments.b.translation, '두 줄');
  assert.equal(useSubStore.getState().segments.c.translation, undefined);
  assert.equal(useSubStore.getState().dirty, true);
  assert.equal(useSubStore.getState().segments.b.original, 'Two\nsource lines');
});

test('transcription coverage is restored from its document and cleared on another import', () => {
  const cue = { id: 'coverage', index: 1, start: 0, end: 10, original: 'Done' };
  const coverage = { endSec: 120, durationSec: 120 };
  useSubStore.getState().load([cue], null, 'fresh', null, null, null, null, {
    transcriptionCoverage: coverage,
  });
  assert.deepEqual(useSubStore.getState().transcriptionCoverage, coverage);
  useSubStore
    .getState()
    .load([{ ...cue, id: 'other' }], '.local/other.srt', 'disk');
  assert.equal(useSubStore.getState().transcriptionCoverage, null);
});

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

test('a numbered subset of translations never lands on other rows by index', () => {
  useSubStore.getState().load(
    [
      {
        id: 'a',
        index: 1,
        start: 0,
        end: 1,
        original: 'one',
        translation: '하나',
      },
      {
        id: 'b',
        index: 2,
        start: 1,
        end: 2,
        original: 'two',
        translation: '둘',
      },
      {
        id: 'c',
        index: 3,
        start: 200,
        end: 201,
        original: 'three',
        translation: '',
      },
    ],
    null,
    'fresh',
    null,
    null
  );
  // A missing-lines pass numbers its own cues from 1.
  useSubStore
    .getState()
    .applyTranslations(
      [{ index: 1, start: 200, end: 201, translation: '셋' }],
      { matchByIndex: false }
    );
  const s = useSubStore.getState();
  assert.equal(s.segments.a.translation, '하나');
  assert.equal(s.segments.c.translation, '셋');
});

test('replace all treats the search and replacement as plain text', () => {
  assert.equal(replaceLiteral('Keep going?', '?', '!'), 'Keep going!');
  assert.equal(replaceLiteral('Hi Mr. Smith', 'Mr.', 'Dr.'), 'Hi Dr. Smith');
  assert.equal(replaceLiteral('(laughs) ok', '(laughs)', ''), ' ok');
  assert.equal(replaceLiteral('going go?', 'go?', 'x'), 'going x');
  assert.equal(replaceLiteral('cost 5', '5', '$&$1'), 'cost $&$1');
  assert.equal(replaceLiteral('a\\b', '\\', '/'), 'a/b');
});
