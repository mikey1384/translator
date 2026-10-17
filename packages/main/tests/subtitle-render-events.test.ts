import assert from 'node:assert/strict';
import test from 'node:test';

import { generateSubtitleEvents } from '../handlers/render-window-handlers/srt-parser.js';
import { findActiveCueIndex } from '../../shared/helpers/subtitle-cue-timeline.js';
import { applySegmentPatchWithWordTimings } from '../../shared/helpers/word-timing.js';
import {
  normalizeSegmentWordTimings,
  normalizeSegmentWordTimingsForRender,
  rebaseWordTimingsToSegment,
} from '../services/subtitle-processing/word-timing-normalization.js';

test('plain subtitle render events still merge identical overlapping text', () => {
  const events = generateSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello',
      },
      {
        id: 'seg-2',
        index: 2,
        start: 0.8,
        end: 2,
        original: 'hello',
      },
    ],
    outputMode: 'original',
    videoDuration: 2,
    operationId: 'plain-test',
  });

  assert.deepEqual(
    events.map(event => ({
      timeMs: event.timeMs,
      mode: event.state.mode,
      text: event.state.text,
    })),
    [
      { timeMs: 0, mode: 'plain', text: 'hello' },
      { timeMs: 2000, mode: 'plain', text: '' },
    ]
  );
});

test('plain original-only render preserves multiline original cues', () => {
  const events = generateSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'line 1\nline 2',
        translation: 'translated line',
      },
    ],
    outputMode: 'original',
    videoDuration: 2,
    operationId: 'multiline-original-test',
  });

  assert.deepEqual(events, [
    { timeMs: 0, state: { mode: 'plain', text: 'line 1\nline 2' } },
    { timeMs: 2000, state: { mode: 'plain', text: '' } },
  ]);
});

test('plain dual render preserves multiline original cues before translation', () => {
  const events = generateSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'line 1\nline 2',
        translation: 'translated line',
      },
    ],
    outputMode: 'dual',
    videoDuration: 2,
    operationId: 'multiline-dual-test',
  });

  assert.deepEqual(events, [
    {
      timeMs: 0,
      state: { mode: 'plain', text: 'line 1\nline 2\ntranslated line' },
    },
    { timeMs: 2000, state: { mode: 'plain', text: '' } },
  ]);
});

test('render events keep the exact cue times the player uses', () => {
  const events = generateSubtitleEvents({
    segments: [
      { id: 'a', index: 1, start: 1, end: 2, original: 'Short one' },
      { id: 'b', index: 2, start: 7, end: 8, original: 'Second cue' },
    ],
    outputMode: 'original',
    videoDuration: 30,
    operationId: 'exact-times',
  });

  assert.deepEqual(
    events.map(event => [event.timeMs, event.state.text]),
    [
      [0, ''],
      [1000, 'Short one'],
      [2000, ''],
      [7000, 'Second cue'],
      [8000, ''],
      [30000, ''],
    ]
  );
});

test('overlapping cues: the later cue wins, in the export and the player', () => {
  const segments = [
    { id: 'a', index: 1, start: 12, end: 14, original: 'Overlap A' },
    { id: 'b', index: 2, start: 13, end: 15, original: 'Overlap B' },
    { id: 'c', index: 3, start: 20, end: 26, original: 'Long' },
    { id: 'd', index: 4, start: 22, end: 23, original: 'Inside' },
  ];
  const events = generateSubtitleEvents({
    segments,
    outputMode: 'original',
    videoDuration: 30,
    operationId: 'overlap',
  });

  const exportTextAt = (t: number) => {
    let text = '';
    for (const event of events) {
      if (event.timeMs <= t * 1000) text = event.state.text;
    }
    return text;
  };
  for (const t of [11, 12.5, 13, 13.5, 14.5, 16, 21, 22.5, 24, 27]) {
    const index = findActiveCueIndex(segments, t);
    const playerText = index >= 0 ? segments[index].original : '';
    assert.equal(exportTextAt(t), playerText, `at ${t}s`);
  }
  assert.equal(exportTextAt(13.5), 'Overlap B');
  assert.equal(exportTextAt(24), 'Long');
});

test('cues past the video end are clamped', () => {
  const events = generateSubtitleEvents({
    segments: [{ id: 'a', index: 1, start: 9, end: 12, original: 'Tail' }],
    outputMode: 'original',
    videoDuration: 10,
    operationId: 'clamp',
  });
  assert.deepEqual(
    events.map(event => [event.timeMs, event.state.text]),
    [
      [0, ''],
      [9000, 'Tail'],
      [10000, ''],
    ]
  );
});

test('rebaseWordTimingsToSegment stores direct transcription words relative to the segment', () => {
  assert.deepEqual(
    rebaseWordTimingsToSegment(
      [
        { start: 10.1, end: 10.4, word: 'hello' },
        { start: 10.7, end: 11.0, word: 'world' },
      ],
      10,
      12
    ),
    [
      { start: 0.1, end: 0.4, word: 'hello' },
      { start: 0.7, end: 1.0, word: 'world' },
    ]
  );
});

test('render-timing normalizer rescues older absolute-timestamp words', () => {
  const normalized = normalizeSegmentWordTimings({
    id: 'seg-1',
    index: 1,
    start: 10,
    end: 12,
    original: 'hello world',
    words: [
      { start: 10.1, end: 10.4, word: 'hello' },
      { start: 10.7, end: 11.0, word: 'world' },
    ],
  });

  assert.deepEqual(normalized.words, [
    { start: 0.1, end: 0.4, word: 'hello' },
    { start: 0.7, end: 1.0, word: 'world' },
  ]);
});

test('render-timing normalizer rescues ambiguous early legacy cues when later cues prove absolute timing', () => {
  const normalized = normalizeSegmentWordTimingsForRender([
    {
      id: 'seg-1',
      index: 1,
      start: 1,
      end: 4,
      original: 'hello world',
      words: [
        { start: 1.1, end: 1.6, word: 'hello' },
        { start: 2.0, end: 2.7, word: 'world' },
      ],
    },
    {
      id: 'seg-2',
      index: 2,
      start: 10,
      end: 12,
      original: 'again now',
      words: [
        { start: 10.2, end: 10.6, word: 'again' },
        { start: 10.7, end: 11.0, word: 'now' },
      ],
    },
  ]);

  assert.deepEqual(normalized[0]?.words, [
    { start: 0.1, end: 0.6, word: 'hello' },
    { start: 1.0, end: 1.7, word: 'world' },
  ]);
  assert.deepEqual(normalized[1]?.words, [
    { start: 0.2, end: 0.6, word: 'again' },
    { start: 0.7, end: 1.0, word: 'now' },
  ]);
});

test('render-timing normalizer does not rebase relative cues just because an early cue starts late', () => {
  const normalized = normalizeSegmentWordTimingsForRender([
    {
      id: 'seg-1',
      index: 1,
      start: 1,
      end: 4,
      original: 'hello world',
      words: [
        { start: 1.1, end: 1.6, word: 'hello' },
        { start: 2.0, end: 2.7, word: 'world' },
      ],
    },
    {
      id: 'seg-2',
      index: 2,
      start: 10,
      end: 12,
      original: 'again now',
      words: [
        { start: 0.2, end: 0.6, word: 'again' },
        { start: 0.7, end: 1.0, word: 'now' },
      ],
    },
  ]);

  assert.deepEqual(normalized[0]?.words, [
    { start: 1.1, end: 1.6, word: 'hello' },
    { start: 2.0, end: 2.7, word: 'world' },
  ]);
  assert.deepEqual(normalized[1]?.words, [
    { start: 0.2, end: 0.6, word: 'again' },
    { start: 0.7, end: 1.0, word: 'now' },
  ]);
});

test('cue start edits rebase stored word timings to the edited boundary', () => {
  const edited = applySegmentPatchWithWordTimings(
    {
      id: 'seg-1',
      index: 1,
      start: 10,
      end: 12,
      original: 'hello world',
      words: [
        { start: 0.1, end: 0.4, word: 'hello' },
        { start: 0.8, end: 1.2, word: 'world' },
      ],
    },
    { start: 10.5 }
  );

  assert.deepEqual(edited.words, [{ start: 0.3, end: 0.7, word: 'world' }]);
});

test('whole-cue shifts preserve relative word timings', () => {
  const edited = applySegmentPatchWithWordTimings(
    {
      id: 'seg-1',
      index: 1,
      start: 10,
      end: 12,
      original: 'hello world',
      words: [
        { start: 0.1, end: 0.4, word: 'hello' },
        { start: 0.8, end: 1.2, word: 'world' },
      ],
    },
    { start: 11, end: 13 }
  );

  assert.deepEqual(edited.words, [
    { start: 0.1, end: 0.4, word: 'hello' },
    { start: 0.8, end: 1.2, word: 'world' },
  ]);
});

test('text edits discard stored word timings instead of rendering stale karaoke', () => {
  const edited = applySegmentPatchWithWordTimings(
    {
      id: 'seg-1',
      index: 1,
      start: 0,
      end: 2,
      original: 'hello world',
      words: [
        { start: 0.1, end: 0.4, word: 'hello' },
        { start: 0.8, end: 1.2, word: 'world' },
      ],
    },
    { original: 'goodbye world' }
  );

  assert.equal(edited.words, undefined);
});
