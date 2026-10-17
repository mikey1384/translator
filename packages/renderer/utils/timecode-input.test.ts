import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimecodeInput, validateCueTimeEdit } from './timecode-input';

test('parseTimecodeInput reads full SRT times and short forms', () => {
  assert.equal(parseTimecodeInput('00:01:02,500'), 62.5);
  assert.equal(parseTimecodeInput('00:01:02.500'), 62.5);
  assert.equal(parseTimecodeInput('1:02'), 62);
  assert.equal(parseTimecodeInput('1:00'), 60);
  assert.equal(parseTimecodeInput('1:02.5'), 62.5);
  assert.equal(parseTimecodeInput('62.25'), 62.25);
  assert.equal(parseTimecodeInput('90'), 90);
  assert.equal(parseTimecodeInput('1:00:02'), 3602);
  assert.equal(parseTimecodeInput(' 00:00:10,000 '), 10);
});

test('parseTimecodeInput rejects text that is not a time', () => {
  for (const bad of [
    '',
    'abc',
    '1:',
    ':30',
    '1:75',
    '1:60:00',
    '00:00:10,',
    '1::2',
  ]) {
    assert.equal(parseTimecodeInput(bad), null, bad);
  }
});

test('validateCueTimeEdit rejects end before start and unreadable input', () => {
  assert.deepEqual(
    validateCueTimeEdit({
      field: 'end',
      input: '00:00:05,000',
      start: 10,
      end: 12,
    }),
    { ok: false, error: 'endBeforeStart' }
  );
  assert.deepEqual(
    validateCueTimeEdit({
      field: 'start',
      input: '00:00:12,000',
      start: 10,
      end: 12,
    }),
    { ok: false, error: 'endBeforeStart' }
  );
  assert.deepEqual(
    validateCueTimeEdit({ field: 'start', input: '1:0x', start: 10, end: 12 }),
    { ok: false, error: 'unreadable' }
  );
  assert.deepEqual(
    validateCueTimeEdit({ field: 'end', input: '0:15', start: 10, end: 12 }),
    { ok: true, seconds: 15 }
  );
});
