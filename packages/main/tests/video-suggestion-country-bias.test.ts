import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildYoutubeSearchPageUrl,
  inferCountryCodeFromCountryHint,
  inferSearchLanguageFromCountry,
  normalizeCountryCode,
  resolveCountryCode,
} from '../services/video-suggestions/shared.ts';

test('normalizeCountryCode accepts valid ISO alpha-2 region codes', () => {
  assert.equal(normalizeCountryCode('cn'), 'CN');
  assert.equal(normalizeCountryCode('JP'), 'JP');
});

test('normalizeCountryCode rejects unknown or malformed region codes', () => {
  assert.equal(normalizeCountryCode('ZZ'), '');
  assert.equal(normalizeCountryCode('china'), '');
  assert.equal(normalizeCountryCode(''), '');
});

test('buildYoutubeSearchPageUrl applies validated region and locale bias', () => {
  const url = new URL(
    buildYoutubeSearchPageUrl({
      query: 'ai street interviews',
      countryCode: 'cn',
      searchLocale: 'zh',
    })
  );

  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.pathname, '/results');
  assert.equal(url.searchParams.get('search_query'), 'ai street interviews');
  assert.equal(url.searchParams.get('gl'), 'CN');
  assert.equal(url.searchParams.get('persist_gl'), '1');
  assert.equal(url.searchParams.get('hl'), 'zh');
});

test('buildYoutubeSearchPageUrl ignores invalid region codes', () => {
  const url = new URL(
    buildYoutubeSearchPageUrl({
      query: 'ai street interviews',
      countryCode: 'ZZ',
      searchLocale: 'zh',
    })
  );

  assert.equal(url.searchParams.get('gl'), null);
  assert.equal(url.searchParams.get('persist_gl'), null);
  assert.equal(url.searchParams.get('hl'), 'zh');
});

test('country bias resolves the default search language deterministically', () => {
  assert.equal(inferSearchLanguageFromCountry('argentina', 'en'), 'es');
  assert.equal(inferSearchLanguageFromCountry('japan', 'en'), 'ja');
  assert.equal(inferSearchLanguageFromCountry('', 'ko'), 'ko');
});

test('country bias resolves a deterministic ISO country code from user text', () => {
  assert.equal(inferCountryCodeFromCountryHint('argentina'), 'AR');
  assert.equal(inferCountryCodeFromCountryHint('日本'), 'JP');
  assert.equal(inferCountryCodeFromCountryHint('한국'), 'KR');
  assert.equal(inferCountryCodeFromCountryHint('unknown place'), '');
});

test('resolveCountryCode prefers the explicit country bias over planner fallback', () => {
  assert.equal(resolveCountryCode('argentina', 'US'), 'AR');
  assert.equal(resolveCountryCode('', 'US'), 'US');
  assert.equal(resolveCountryCode('', 'ZZ'), '');
});
