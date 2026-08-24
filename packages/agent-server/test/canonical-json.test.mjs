import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalJson, canonicalJsonHash } from '../src/canonical-json.mjs';

test('canonical JSON is stable across object key order', () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: true, x: false }] };
  const right = { list: [{ x: false, y: true }], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(canonicalJsonHash(left), canonicalJsonHash(right));
});

test('canonical JSON rejects cycles and non-finite values', () => {
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /cycles/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /non-finite/);
});

test('canonical JSON preserves prototype-named keys as ordinary data', () => {
  const withPrototypeKey = JSON.parse('{"__proto__":{"safe":true},"a":1}');
  assert.equal(
    canonicalJson(withPrototypeKey),
    '{"__proto__":{"safe":true},"a":1}'
  );
  assert.notEqual(
    canonicalJsonHash(withPrototypeKey),
    canonicalJsonHash({ a: 1 })
  );
});
