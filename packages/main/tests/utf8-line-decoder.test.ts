import assert from 'node:assert/strict';
import test from 'node:test';
import { Utf8LineDecoder } from '../utils/utf8-line-decoder.js';

test('UTF-8 line decoder preserves code points split across stream chunks', () => {
  const input = Buffer.from('요청 🎬\nresponse\r\n끝', 'utf8');
  const emojiOffset = input.indexOf(Buffer.from('🎬'));
  const decoder = new Utf8LineDecoder();

  assert.deepEqual(decoder.write(input.subarray(0, emojiOffset + 2)), []);
  assert.deepEqual(decoder.write(input.subarray(emojiOffset + 2, -1)), [
    '요청 🎬',
    'response',
  ]);
  assert.deepEqual(decoder.end(input.subarray(-1)), ['끝']);
});

test('UTF-8 line decoder rejects an unbounded unterminated request', () => {
  const decoder = new Utf8LineDecoder(4);

  assert.throws(() => decoder.write(Buffer.from('12345')), /size limit/);
  assert.deepEqual(decoder.write(Buffer.from('ok\n')), ['ok']);
});
