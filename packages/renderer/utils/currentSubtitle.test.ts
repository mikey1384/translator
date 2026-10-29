import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSubtitleIndex } from './currentSubtitle';

test('jump targets the playing line or the closest line in a pause, including either end', () => {
  const cues = [
    { start: 10, end: 20 },
    { start: 30, end: 35 },
    { start: 40, end: 45 },
  ];
  for (const [time, index] of [
    [0, 0],
    [14, 0],
    [22, 0],
    [28, 1],
    [33, 1],
    [43, 2],
    [90, 2],
  ]) {
    assert.equal(currentSubtitleIndex(cues, time), index);
  }
  assert.equal(currentSubtitleIndex([], 0), -1);
  assert.equal(currentSubtitleIndex(cues, NaN), -1);
  assert.equal(
    currentSubtitleIndex(
      [
        { start: 0, end: 10 },
        { start: 10, end: 11 },
      ],
      10
    ),
    1
  );
});
