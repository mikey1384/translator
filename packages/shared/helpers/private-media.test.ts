import test from 'node:test';
import assert from 'node:assert/strict';
import { privateMediaRange } from './private-media.js';
test('private streaming ranges support media seeks and reject ambiguous or unsatisfiable input', () => {
  assert.deepEqual(privateMediaRange(null, 100), {
    start: 0,
    end: 99,
    partial: false,
  });
  assert.deepEqual(privateMediaRange('bytes=50-', 100), {
    start: 50,
    end: 99,
    partial: true,
  });
  assert.deepEqual(privateMediaRange('bytes=-20', 100), {
    start: 80,
    end: 99,
    partial: true,
  });
  assert.deepEqual(privateMediaRange('bytes=5-200', 100), {
    start: 5,
    end: 99,
    partial: true,
  });
  for (const invalid of [
    'bytes=100-',
    'bytes=30-20',
    'bytes=1-2,3-4',
    'bytes=-',
    'bytes=-0',
    'bytes=NaN-',
  ])
    assert.equal(privateMediaRange(invalid, 100), null);
});
