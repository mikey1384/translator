import assert from 'node:assert/strict';
import test from 'node:test';
import {
  rankDistinctHighlights,
  rebaseClipSubtitles,
  resolveClipRanges,
} from './highlight-clips.js';

test('invalid or unverified ranges never become unrelated fallback clips', () => {
  for (const range of [
    { start: NaN, end: 30 },
    { start: 5, end: 4 },
    { start: -1, end: 5 },
    { start: 95, end: 110 },
  ]) {
    assert.throws(() => resolveClipRanges([range], 100));
  }
  assert.throws(() => resolveClipRanges([{ start: 0, end: 5 }], 0));
  assert.deepEqual(
    resolveClipRanges(
      [
        { start: 10, end: 20 },
        { start: 2, end: 5 },
      ],
      100
    ),
    [
      { start: 10, end: 20 },
      { start: 2, end: 5 },
    ]
  );
});

test('reordered clips retain Korean translation, correct offsets, and relative words', () => {
  const cues = [
    {
      id: 'a',
      index: 1,
      start: 2,
      end: 5,
      original: 'Try it.',
      translation: '직접 해보세요.',
      words: [
        { start: 0, end: 1, word: 'Try' },
        { start: 1, end: 3, word: 'it.' },
      ],
    },
    {
      id: 'b',
      index: 2,
      start: 10,
      end: 12,
      original: 'A new idea.',
      translation: '새로운 아이디어입니다.',
    },
  ];
  const result = rebaseClipSubtitles(cues, [
    { start: 9, end: 13 },
    { start: 3, end: 5 },
  ]);
  assert.deepEqual(
    result.map(c => [c.start, c.end, c.translation]),
    [
      [1, 3, '새로운 아이디어입니다.'],
      [4, 6, '직접 해보세요.'],
    ]
  );
  assert.deepEqual(result[1].words, [{ start: 0, end: 2, word: 'it.' }]);
  assert.equal(new Set(result.map(c => c.id)).size, 2);
  assert.equal(cues[0].start, 2);
});

test('ranking removes overlapping weaker moments and never manufactures filler', () => {
  assert.deepEqual(rankDistinctHighlights([]), []);
  const result = rankDistinctHighlights([
    { id: 'weak', start: 10, end: 40, score: 5 },
    { id: 'strong', start: 12, end: 42, score: 9 },
    { id: 'other', start: 80, end: 110, score: 8 },
    { id: 'uncertain', start: 120, end: 140, confidence: 0.2 },
  ]);
  assert.deepEqual(
    result.map(h => h.id),
    ['strong', 'other']
  );
});
