import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateSubtitleEvents,
  generateTimedOriginalSubtitleEvents,
} from '../handlers/render-window-handlers/srt-parser.js';
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

test('timed original render events step word by word for aligned segments', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello world',
        words: [
          { start: 0, end: 0.4, word: 'hello' },
          { start: 0.45, end: 0.8, word: 'world' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'timed-test',
  });

  assert.equal(events.length, 5);
  assert.equal(events[0].timeMs, 0);
  assert.equal(events[0].state.mode, 'timed');
  assert.deepEqual(
    (events[0].state.mode === 'timed' ? events[0].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'active' },
      { kind: 'word', text: 'world', state: 'upcoming' },
    ]
  );

  assert.equal(events[1].timeMs, 400);
  assert.equal(events[1].state.mode, 'timed');
  assert.deepEqual(
    (events[1].state.mode === 'timed' ? events[1].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'spoken' },
      { kind: 'word', text: 'world', state: 'upcoming' },
    ]
  );

  assert.equal(events[2].timeMs, 450);
  assert.equal(events[2].state.mode, 'timed');
  assert.deepEqual(
    (events[2].state.mode === 'timed' ? events[2].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'spoken' },
      { kind: 'word', text: 'world', state: 'active' },
    ]
  );

  assert.equal(events[3].timeMs, 800);
  assert.equal(events[3].state.mode, 'timed');
  assert.deepEqual(
    (events[3].state.mode === 'timed' ? events[3].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'spoken' },
      { kind: 'word', text: 'world', state: 'spoken' },
    ]
  );

  assert.deepEqual(events[4], {
    timeMs: 1000,
    state: { mode: 'plain', text: '' },
  });
});

test('timed original render shows upcoming text before a late first word and during gaps', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 2,
        original: 'hello world',
        words: [
          { start: 0.4, end: 0.8, word: 'hello' },
          { start: 1.2, end: 1.5, word: 'world' },
        ],
      },
    ],
    videoDuration: 2,
    operationId: 'late-gap-test',
  });

  assert.equal(events[0].timeMs, 0);
  assert.equal(events[0].state.mode, 'timed');
  assert.deepEqual(
    (events[0].state.mode === 'timed' ? events[0].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'upcoming' },
      { kind: 'word', text: 'world', state: 'upcoming' },
    ]
  );

  assert.equal(events[2].timeMs, 800);
  assert.equal(events[2].state.mode, 'timed');
  assert.deepEqual(
    (events[2].state.mode === 'timed' ? events[2].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'spoken' },
      { kind: 'word', text: 'world', state: 'upcoming' },
    ]
  );

  assert.equal(events[4].timeMs, 1500);
  assert.equal(events[4].state.mode, 'timed');
  assert.deepEqual(
    (events[4].state.mode === 'timed' ? events[4].state.parts : []).filter(
      part => part.kind === 'word'
    ),
    [
      { kind: 'word', text: 'hello', state: 'spoken' },
      { kind: 'word', text: 'world', state: 'spoken' },
    ]
  );
});

test('timed original render supports punctuation-preserving alignment', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello, world',
        words: [
          { start: 0, end: 0.4, word: 'hello' },
          { start: 0.45, end: 0.8, word: 'world' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'punctuation-test',
  });

  assert.equal(events[0].state.mode, 'timed');
});

test('timed original render preserves punctuation when clipped words are removed between matches', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello, brave world',
        words: [
          { start: 0, end: 0.35, word: 'hello' },
          { start: 0.55, end: 0.9, word: 'world' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'clipped-middle-punctuation-test',
  });

  assert.equal(events[0].state.mode, 'timed');
  assert.equal(events[0].state.text, 'hello, world');
});

test('timed original render preserves sentence-ending punctuation when trailing words are clipped', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello brave.',
        words: [{ start: 0, end: 0.35, word: 'hello' }],
      },
    ],
    videoDuration: 1,
    operationId: 'clipped-trailing-punctuation-test',
  });

  assert.equal(events[0].state.mode, 'timed');
  assert.equal(events[0].state.text, 'hello.');
});

test('timed original render supports scripts without spaces', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'こんにちは',
        words: [
          { start: 0, end: 0.2, word: 'こん' },
          { start: 0.2, end: 0.4, word: 'に' },
          { start: 0.4, end: 0.6, word: 'ちは' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'cjk-test',
  });

  assert.equal(events[0].state.mode, 'timed');
  assert.equal(events[0].timeMs, 0);
});

test('timed original render falls back to plain text when words cannot be aligned', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'goodbye world',
        words: [
          { start: 0, end: 0.4, word: 'hello' },
          { start: 0.45, end: 0.8, word: 'world' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'fallback-test',
  });

  assert.deepEqual(events, [
    { timeMs: 0, state: { mode: 'plain', text: 'goodbye world' } },
    { timeMs: 1000, state: { mode: 'plain', text: '' } },
  ]);
});

test('timed original render drops trimmed-out leading words from visible text', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello, world!',
        words: [{ start: 0.25, end: 0.7, word: 'world' }],
      },
    ],
    videoDuration: 1,
    operationId: 'trimmed-leading-word-test',
  });

  assert.equal(events[0].state.mode, 'timed');
  assert.equal(events[0].state.text, 'world!');
  assert.deepEqual(
    events[0].state.mode === 'timed' ? events[0].state.parts : [],
    [
      { kind: 'word', text: 'world', state: 'upcoming' },
      { kind: 'whitespace', text: '!' },
    ]
  );
});

test('timed original render synthesizes surviving text when removed middle words would otherwise leak through', () => {
  const events = generateTimedOriginalSubtitleEvents({
    segments: [
      {
        id: 'seg-1',
        index: 1,
        start: 0,
        end: 1,
        original: 'hello brave world',
        words: [
          { start: 0, end: 0.25, word: 'hello' },
          { start: 0.55, end: 0.9, word: 'world' },
        ],
      },
    ],
    videoDuration: 1,
    operationId: 'trimmed-middle-word-test',
  });

  assert.equal(events[0].state.mode, 'timed');
  assert.equal(events[0].state.text, 'hello world');
  assert.deepEqual(
    events[0].state.mode === 'timed' ? events[0].state.parts : [],
    [
      { kind: 'word', text: 'hello', state: 'active' },
      { kind: 'whitespace', text: ' ' },
      { kind: 'word', text: 'world', state: 'upcoming' },
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

  const events = generateTimedOriginalSubtitleEvents({
    segments: [normalized],
    videoDuration: 12,
    operationId: 'absolute-timing-test',
  });

  assert.ok(events.some(event => event.state.mode === 'timed'));
  assert.equal(events[1].timeMs, 10000);
  assert.equal(events[1].state.mode, 'timed');
  assert.equal(events[2].timeMs, 10100);
  assert.equal(events[2].state.mode, 'timed');
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

  const events = generateTimedOriginalSubtitleEvents({
    segments: normalized,
    videoDuration: 12,
    operationId: 'legacy-document-basis-test',
  });

  assert.equal(events[1].timeMs, 1000);
  assert.equal(events[2].timeMs, 1100);
  assert.equal(events[2].state.mode, 'timed');
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

  const events = generateTimedOriginalSubtitleEvents({
    segments: [edited],
    videoDuration: 12,
    operationId: 'edited-start-test',
  });

  assert.equal(events[0].timeMs, 0);
  assert.equal(events[0].state.mode, 'plain');
  assert.equal(events[1].timeMs, 10500);
  assert.equal(events[1].state.mode, 'timed');
  assert.equal(events[2].timeMs, 10800);
  assert.equal(events[2].state.mode, 'timed');
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

  const events = generateTimedOriginalSubtitleEvents({
    segments: [edited],
    videoDuration: 2,
    operationId: 'edited-text-test',
  });

  assert.deepEqual(events, [
    { timeMs: 0, state: { mode: 'plain', text: 'goodbye world' } },
    { timeMs: 2000, state: { mode: 'plain', text: '' } },
  ]);
});
