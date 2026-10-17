import test from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd } from './formatUsd';

test('prices keep their shape inside RTL sentences', () => {
  assert.equal(formatUsd(5, 'en'), '$5');
  assert.match(formatUsd(1, 'ar'), /^\u20661\s?US\$\u2069$/);
  assert.ok(!/[‎‏؜]/.test(formatUsd(1, 'he')));
});
