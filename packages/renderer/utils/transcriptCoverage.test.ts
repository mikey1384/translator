import test from 'node:test';
import assert from 'node:assert/strict';
import { formatClockTime, transcriptStopsEarlyAt } from './transcriptCoverage';

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
