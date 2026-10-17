import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSrt,
  parseSrtOriginalOnlyWithReport,
  parseSrtWithReport,
  srtTimeToSeconds,
} from './index.js';

test('srtTimeToSeconds reads off-spec millisecond widths', () => {
  assert.equal(srtTimeToSeconds('00:00:01,500'), 1.5);
  assert.equal(srtTimeToSeconds('00:00:01.250'), 1.25);
  assert.equal(srtTimeToSeconds('00:00:01,5'), 1.5);
  assert.equal(srtTimeToSeconds('00:00:01,05'), 1.05);
  assert.equal(srtTimeToSeconds('00:05:28,1000'), 329);
  assert.equal(srtTimeToSeconds('00:00:02'), 2);
  assert.equal(srtTimeToSeconds('1:02:03,004'), 3723.004);
  assert.equal(srtTimeToSeconds('garbage'), 0);
});

test('4-digit milliseconds no longer fold a cue into the previous one', () => {
  const srt = [
    '1',
    '00:05:26,000 --> 00:05:28,000',
    'first line',
    '',
    '2',
    '00:05:28,1000 --> 00:05:30,600',
    'second line',
    '',
    '3',
    '00:05:31,000 --> 00:05:32,000',
    'third line',
    '',
  ].join('\n');
  const { segments, unreadableCues } = parseSrtWithReport(srt);
  assert.equal(unreadableCues, 0);
  assert.deepEqual(
    segments.map(s => [s.index, s.start, s.end, s.original, s.translation]),
    [
      [1, 326, 328, 'first line', undefined],
      [2, 329, 330.6, 'second line', undefined],
      [3, 331, 332, 'third line', undefined],
    ]
  );
});

test('unreadable timing lines are counted and never become cue text', () => {
  const srt = [
    '1',
    '00:00:01,000 --> 00:00:02,000',
    'kept',
    'translation',
    '',
    '2',
    '00:00:03,000 -> 00:00:04',
    'lost',
    '',
    '3',
    'no timing at all',
    '',
    '4',
    '00:00:05,000 --> 00:00:06,000',
    'also kept',
  ].join('\n');
  const { segments, unreadableCues } = parseSrtWithReport(srt);
  assert.equal(unreadableCues, 2);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].original, 'kept');
  assert.equal(segments[0].translation, 'translation');
  assert.equal(segments[1].original, 'also kept');
  assert.equal(segments[1].index, 4);
});

test('original-only parse keeps all cue lines and inner blank lines', () => {
  const srt =
    '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nline a\r\nline b\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nnext\r\n';
  const { segments, unreadableCues } = parseSrtOriginalOnlyWithReport(srt);
  assert.equal(unreadableCues, 0);
  assert.deepEqual(
    segments.map(s => s.original),
    ['line a\nline b', 'next']
  );
});

test('well-formed SRT parses as before', () => {
  const srt =
    '1\n00:00:00,000 --> 00:00:01,000\nHello\nHola\n\n2\n00:00:01,500 --> 00:00:02,000\nBye\n';
  const segments = parseSrt(srt);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].translation, 'Hola');
  assert.equal(segments[1].start, 1.5);
  assert.equal(parseSrt('').length, 0);
});
