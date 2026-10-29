import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClockTime, transcriptStopsEarlyAt } from './transcriptCoverage';

test('actual audio coverage takes precedence over the last spoken subtitle', () => {
  assert.equal(
    transcriptStopsEarlyAt({
      durationSecs: 7593.5,
      lastEndSecs: 6537,
      coverage: { durationSec: 7593.5, endSec: 7593.5 },
    }),
    null
  );
  assert.equal(
    transcriptStopsEarlyAt({
      durationSecs: 7593.5,
      lastEndSecs: 6300,
      coverage: { durationSec: 7593.5, endSec: 6405 },
    }),
    6405
  );
  assert.equal(
    transcriptStopsEarlyAt({
      durationSecs: 7593.5,
      lastEndSecs: 6537,
      coverage: { durationSec: 8000, endSec: 8000 },
    }),
    6537
  );
});

test('subtitles that stop a minute or more early can be continued', () => {
  assert.equal(
    transcriptStopsEarlyAt({ durationSecs: 720, lastEndSecs: 30 }),
    30
  );
  assert.equal(
    transcriptStopsEarlyAt({ durationSecs: 90, lastEndSecs: 45 }),
    null
  );
  assert.equal(
    transcriptStopsEarlyAt({ durationSecs: null, lastEndSecs: 30 }),
    null
  );
  assert.equal(
    transcriptStopsEarlyAt({ durationSecs: 720, lastEndSecs: undefined }),
    null
  );
});

test('clock times for the "stops at" line', () => {
  assert.equal(formatClockTime(30), '0:30');
  assert.equal(formatClockTime(75), '1:15');
  assert.equal(formatClockTime(3725), '1:02:05');
});
