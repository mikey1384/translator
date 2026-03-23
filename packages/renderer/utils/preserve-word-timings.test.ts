import test from 'node:test';
import assert from 'node:assert/strict';

import { preserveWordTimingsOnTranslatedSegments } from './preserve-word-timings';

test('preserveWordTimingsOnTranslatedSegments carries source words into translated cues', () => {
  const sourceSegments = [
    {
      id: 'src-1',
      index: 1,
      start: 0,
      end: 1.2,
      original: 'Hello world',
      words: [
        { word: 'Hello', start: 0, end: 0.45 },
        { word: 'world', start: 0.5, end: 1.0 },
      ],
    },
    {
      id: 'src-2',
      index: 2,
      start: 1.2,
      end: 2.1,
      original: 'How are you',
      words: [
        { word: 'How', start: 0, end: 0.2 },
        { word: 'are', start: 0.24, end: 0.46 },
        { word: 'you', start: 0.5, end: 0.8 },
      ],
    },
  ];

  const translatedSegments = [
    {
      id: 'tr-1',
      index: 1,
      start: 0,
      end: 1.2,
      original: 'Hello world',
      translation: 'Hola mundo',
    },
    {
      id: 'tr-2',
      index: 2,
      start: 1.2,
      end: 2.1,
      original: 'How are you',
      translation: 'Como estas',
    },
  ];

  const preserved = preserveWordTimingsOnTranslatedSegments(
    sourceSegments,
    translatedSegments
  );

  assert.deepEqual(preserved.map(segment => segment.words), [
    sourceSegments[0].words,
    sourceSegments[1].words,
  ]);
  assert.equal(preserved[0].translation, 'Hola mundo');
  assert.equal(preserved[1].translation, 'Como estas');
});

test('preserveWordTimingsOnTranslatedSegments falls back to index when timings drift slightly', () => {
  const sourceSegments = [
    {
      id: 'src-1',
      index: 1,
      start: 0,
      end: 1.2,
      original: 'Hello world',
      words: [{ word: 'Hello', start: 0, end: 0.45 }],
    },
  ];

  const translatedSegments = [
    {
      id: 'tr-1',
      index: 1,
      start: 0.001,
      end: 1.199,
      original: 'Hello world',
      translation: 'Hola mundo',
    },
  ];

  const preserved = preserveWordTimingsOnTranslatedSegments(
    sourceSegments,
    translatedSegments
  );

  assert.deepEqual(preserved[0].words, sourceSegments[0].words);
});
