import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCheckoutCountryHintFromLocale } from '../utils/checkout-locale.js';

test('checkout country hint ignores bare language tags', () => {
  assert.equal(resolveCheckoutCountryHintFromLocale('ko'), null);
  assert.equal(resolveCheckoutCountryHintFromLocale('en'), null);
});

test('checkout country hint extracts region subtags', () => {
  assert.equal(resolveCheckoutCountryHintFromLocale('ko-KR'), 'KR');
  assert.equal(resolveCheckoutCountryHintFromLocale('en_US'), 'US');
  assert.equal(resolveCheckoutCountryHintFromLocale('zh-Hant-TW'), 'TW');
});

test('checkout country hint ignores non-alpha region subtags', () => {
  assert.equal(resolveCheckoutCountryHintFromLocale('es-419'), null);
});
