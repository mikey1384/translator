import assert from 'node:assert/strict';
import test from 'node:test';
import { secondsToSrtTime, srtTimeToSeconds } from './index.js';

test('SRT millisecond timings stay stable after repeated exports and minute/hour rollover', () => {
  for (const seconds of [
    970.156, 977.036, 978.756, 1002.616, 59.999, 3600.001,
  ]) {
    let reopened = seconds;
    for (let n = 0; n < 10; n++)
      reopened = srtTimeToSeconds(secondsToSrtTime(reopened));
    assert.equal(reopened, seconds);
  }
  assert.equal(secondsToSrtTime(59.9996), '00:01:00,000');
  assert.equal(secondsToSrtTime(3599.9996), '01:00:00,000');
  for (const seconds of [NaN, Infinity, -1])
    assert.equal(secondsToSrtTime(seconds), '00:00:00,000');
});
