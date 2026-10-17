import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCueTimeline,
  findActiveCueIndex,
} from './subtitle-cue-timeline.js';

const cues = [
  { start: 1, end: 2 },
  { start: 7, end: 8 },
  { start: 12, end: 14 },
  { start: 13, end: 15 },
  { start: 20, end: 26 },
  { start: 22, end: 23 },
];

test('a cue shows only between its own start and end', () => {
  assert.equal(findActiveCueIndex(cues, 1.5), 0);
  assert.equal(findActiveCueIndex(cues, 3), -1);
  assert.equal(findActiveCueIndex(cues, 5.5), -1);
  assert.equal(findActiveCueIndex(cues, 8.5), -1);
});

test('overlaps: the cue that started later wins', () => {
  assert.equal(findActiveCueIndex(cues, 13.5), 3);
  assert.equal(findActiveCueIndex(cues, 22.5), 5);
  assert.equal(findActiveCueIndex(cues, 24), 4);
});

test('the timeline agrees with the lookup everywhere', () => {
  const spans = buildCueTimeline(cues, 30);
  for (let t = 0; t < 30; t += 0.25) {
    const span = spans.find(s => s.start <= t && t < s.end);
    const expected = findActiveCueIndex(cues, t);
    // The lookup includes the end instant; the timeline hands it to the next.
    if (cues.some(c => c.end === t)) continue;
    assert.equal(span ? span.cueIndex : -1, expected, `t=${t}`);
  }
});

test('the timeline clamps to the limit and skips empty cues', () => {
  assert.deepEqual(
    buildCueTimeline(
      [
        { start: 3, end: 3 },
        { start: 8, end: 12 },
      ],
      10
    ),
    [{ start: 8, end: 10, cueIndex: 1 }]
  );
});
