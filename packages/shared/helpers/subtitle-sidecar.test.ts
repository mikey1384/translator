import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalSubtitleSrt,
  buildSavedSubtitleSrt,
} from '../../renderer/utils/canonical-subtitle-srt';
import {
  buildSubtitleSidecarContent,
  fingerprintSubtitleText,
  restoreSegmentsFromSubtitleSidecar,
} from './subtitle-sidecar';

test('subtitle sidecar restores same-script bilingual subtitles losslessly from translation-only export', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hello, how are you?',
      translation: 'Hola, ¿cómo estás?',
    },
  ];

  const srtContent = buildSavedSubtitleSrt(segments, 'translation');
  const sidecarContent = buildSubtitleSidecarContent({ segments, srtContent });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent,
    sidecarContent,
  });

  assert.ok(restored);
  assert.equal(restored?.[0].original, 'Hello, how are you?');
  assert.equal(restored?.[0].translation, 'Hola, ¿cómo estás?');
});

test('subtitle sidecar restores full bilingual subtitles from original-only export', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'How are you?',
      translation: 'Comment ca va ?',
    },
  ];

  const srtContent = buildSavedSubtitleSrt(segments, 'original');
  const sidecarContent = buildSubtitleSidecarContent({ segments, srtContent });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent,
    sidecarContent,
  });

  assert.ok(restored);
  assert.equal(restored?.[0].original, 'How are you?');
  assert.equal(restored?.[0].translation, 'Comment ca va ?');
});

test('subtitle sidecar preserves multiline original and translation text', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'line 1\nline 2',
      translation: 'línea 1\nlínea 2',
    },
  ];

  const srtContent = buildCanonicalSubtitleSrt(segments);
  const sidecarContent = buildSubtitleSidecarContent({ segments, srtContent });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent,
    sidecarContent,
  });

  assert.ok(restored);
  assert.equal(restored?.[0].original, 'line 1\nline 2');
  assert.equal(restored?.[0].translation, 'línea 1\nlínea 2');
});

test('subtitle sidecar is ignored when the SRT content no longer matches', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hello',
      translation: 'Bonjour',
    },
  ];

  const srtContent = buildCanonicalSubtitleSrt(segments);
  const sidecarContent = buildSubtitleSidecarContent({ segments, srtContent });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent: `${srtContent}\n`,
    sidecarContent,
  });

  assert.equal(restored, null);
});

test('subtitle sidecar preserves word timings when present', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hello world',
      words: [
        { start: 0.1, end: 0.5, word: 'Hello' },
        { start: 0.7, end: 1.1, word: 'world' },
      ],
    },
  ];

  const srtContent = buildCanonicalSubtitleSrt(segments);
  const sidecarContent = buildSubtitleSidecarContent({ segments, srtContent });
  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent,
    sidecarContent,
  });

  assert.deepEqual(restored?.[0].words, segments[0].words);
});

test('subtitle sidecar still restores legacy v1 payloads', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hello',
      translation: 'Bonjour',
      words: [{ start: 0.2, end: 0.5, word: 'Hello' }],
    },
  ];

  const srtContent = buildCanonicalSubtitleSrt(segments);
  const nextSidecarContent = buildSubtitleSidecarContent({
    segments,
    srtContent,
  });
  const legacyPayload = JSON.parse(nextSidecarContent) as {
    version: number;
    segments: Array<{
      index?: number;
      start: number;
      end: number;
      original: string;
      translation?: string;
      words?: Array<{ start: number; end: number; word: string }>;
    }>;
  };
  legacyPayload.version = 1;
  legacyPayload.segments = legacyPayload.segments.map(segment => ({
    index: segment.index,
    start: segment.start,
    end: segment.end,
    original: segment.original,
    translation: segment.translation,
  }));

  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent,
    sidecarContent: JSON.stringify(legacyPayload, null, 2),
  });

  assert.ok(restored);
  assert.equal(restored?.[0].original, 'Hello');
  assert.equal(restored?.[0].translation, 'Bonjour');
  assert.equal(restored?.[0].words, undefined);
});

test('subtitle fingerprints are stable across LF and CRLF line endings', () => {
  const lfContent = `1
00:00:00,000 --> 00:00:02,000
Hello
Bonjour`;
  const crlfContent = lfContent.replace(/\n/g, '\r\n');

  assert.equal(
    fingerprintSubtitleText(lfContent),
    fingerprintSubtitleText(crlfContent)
  );
});

test('subtitle sidecar still restores when equivalent SRT content only differs by line endings', () => {
  const segments = [
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'Hello',
      translation: 'Bonjour',
    },
  ];

  const lfContent = buildCanonicalSubtitleSrt(segments);
  const sidecarContent = buildSubtitleSidecarContent({
    segments,
    srtContent: lfContent,
  });
  const crlfContent = lfContent.replace(/\n/g, '\r\n');

  const restored = restoreSegmentsFromSubtitleSidecar({
    srtContent: crlfContent,
    sidecarContent,
  });

  assert.ok(restored);
  assert.equal(restored?.[0].original, 'Hello');
  assert.equal(restored?.[0].translation, 'Bonjour');
});
