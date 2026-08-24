import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSrt, parseSrtWithDiagnostics } from '../src/srt.mjs';

test('valid SRT parsing preserves normal cues without diagnostics', () => {
  const input =
    '\uFEFF1\r\n00:00:00,000 --> 00:00:02,000\r\nHello.\r\n\r\n2\r\n00:00:02.500 --> 00:00:04.000\r\nWorld.\r\n';
  const analysis = parseSrtWithDiagnostics(input);

  assert.equal(analysis.totalBlockCount, 2);
  assert.equal(analysis.invalidBlockCount, 0);
  assert.deepEqual(analysis.diagnostics, []);
  assert.deepEqual(parseSrt(input), analysis.segments);
  assert.deepEqual(
    analysis.segments.map(segment => segment.source),
    ['Hello.', 'World.']
  );
});

test('partially malformed SRT reports blocks that the compatibility parser cannot use', () => {
  const analysis = parseSrtWithDiagnostics(
    '1\n00:00:00,000 --> 00:00:02,000\nReadable.\n\n2\nnot a timecode --> still invalid\nWould previously disappear.\n'
  );

  assert.equal(analysis.totalBlockCount, 2);
  assert.equal(analysis.segments.length, 1);
  assert.equal(analysis.invalidBlockCount, 1);
  assert.equal(analysis.diagnostics[0].code, 'invalid_timecode');
  assert.equal(analysis.diagnosticsTruncated, false);
});

test('missing cue separators and invalid clock components are explicit diagnostics', () => {
  const missingSeparator = parseSrtWithDiagnostics(
    '1\n00:00:00,000 --> 00:00:02,000\nFirst.\n2\n00:00:02,500 --> 00:00:04,000\nSecond.\n'
  );
  assert.equal(missingSeparator.invalidBlockCount, 1);
  assert.equal(missingSeparator.diagnostics[0].code, 'multiple_timecodes');

  const invalidClock = parseSrtWithDiagnostics(
    '1\n00:61:00,000 --> 00:61:02,000\nInvalid clock.\n'
  );
  assert.equal(invalidClock.invalidBlockCount, 1);
  assert.equal(invalidClock.diagnostics[0].code, 'invalid_timecode_component');
});

test('SRT diagnostic detail is bounded while exact invalid counts are retained', () => {
  const analysis = parseSrtWithDiagnostics(
    Array.from(
      { length: 5 },
      (_, index) => `${index + 1}\nmissing timecode`
    ).join('\n\n'),
    { detailLimit: 2 }
  );

  assert.equal(analysis.invalidBlockCount, 5);
  assert.equal(analysis.diagnostics.length, 2);
  assert.equal(analysis.diagnosticsTruncated, true);
});
