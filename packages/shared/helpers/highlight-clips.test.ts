import assert from 'node:assert/strict';
import test from 'node:test';
import type { TranscriptHighlight } from '@shared-types/app';
import {
  markHighlightCueChanges,
  rankDistinctHighlights,
  rebaseClipSubtitles,
  resolveClipRanges,
  stampHighlightSourceCues,
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

const analysisCues = [
  { start: 0, end: 2, text: 'Hello there' },
  { start: 2, end: 4, text: 'This is the hook' },
  { start: 10, end: 12, text: 'Unrelated later line' },
];

test('editing a line outside a highlight leaves it unmarked', () => {
  const [stamped] = stampHighlightSourceCues(
    [{ id: 'h1', start: 0, end: 4 }] as TranscriptHighlight[],
    analysisCues
  );
  assert.ok(stamped.sourceCueSignature?.startsWith('cues1:'));
  const edited = analysisCues.map(cue =>
    cue.start === 10 ? { ...cue, text: 'Unrelated, fixed line' } : cue
  );
  const [marked] = markHighlightCueChanges([stamped], edited);
  assert.equal(marked.cuesChanged, false);
});

test('editing a line inside a highlight marks only that highlight', () => {
  const stamped = stampHighlightSourceCues(
    [
      { id: 'h1', start: 0, end: 4 },
      { id: 'h2', start: 10, end: 12 },
    ] as TranscriptHighlight[],
    analysisCues
  );
  const edited = analysisCues.map(cue =>
    cue.start === 2 ? { ...cue, text: 'This is the fixed hook' } : cue
  );
  const marked = markHighlightCueChanges(stamped, edited);
  assert.deepEqual(
    marked.map(h => h.cuesChanged),
    [true, false]
  );
});

test('stamping keeps the signature a highlight was found with', () => {
  const [kept] = stampHighlightSourceCues(
    [
      { id: 'h1', start: 0, end: 4, sourceCueSignature: 'cues1:old' },
    ] as TranscriptHighlight[],
    analysisCues
  );
  assert.equal(kept.sourceCueSignature, 'cues1:old');
  const [legacy] = markHighlightCueChanges(
    [{ id: 'h2', start: 0, end: 4 }] as TranscriptHighlight[],
    analysisCues
  );
  assert.equal(legacy.cuesChanged, false);
});
