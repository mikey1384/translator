import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeLegacyStage } from '../components/ProgressAreas/legacy-stage-text';

const here = dirname(fileURLToPath(import.meta.url));

function flatten(
  obj: Record<string, unknown>,
  prefix = '',
  out = new Map<string, string>()
) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, full, out);
    } else if (typeof value === 'string') {
      out.set(full, value);
    }
  }
  return out;
}

const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)]
    .map(m => m[1])
    .sort()
    .join(',');

const en = flatten(JSON.parse(readFileSync(join(here, 'en.json'), 'utf8')));
const locales = readdirSync(here).filter(
  f => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(f) && f !== 'en.json'
);

// Existing users run the app in their own language: a key that only exists
// in English shows up as English text in their UI.
test('every locale has every English key with the same placeholders', () => {
  assert.ok(
    locales.length >= 38,
    `expected 38+ locales, found ${locales.length}`
  );
  const problems: string[] = [];
  for (const file of locales) {
    const map = flatten(JSON.parse(readFileSync(join(here, file), 'utf8')));
    for (const [key, source] of en) {
      const value = map.get(key);
      if (value === undefined || value.trim() === '') {
        problems.push(`${file}: missing ${key}`);
      } else if (placeholders(value) !== placeholders(source)) {
        problems.push(`${file}: placeholders differ in ${key}`);
      }
    }
  }
  assert.equal(
    problems.length,
    0,
    `${problems.length} locale gaps, first: ${problems.slice(0, 8).join('; ')}`
  );
});

test('old English progress sentences are turned into translated keys', () => {
  const seen: string[] = [];
  const t = ((key: string, opts?: unknown) => {
    seen.push(key);
    return typeof opts === 'string' ? opts : key;
  }) as any;
  assert.equal(
    localizeLegacyStage('Merge complete!', t),
    'Video with subtitles is ready'
  );
  localizeLegacyStage('Selecting highlights section 2 of 5', t);
  localizeLegacyStage('Downloading yt-dlp…', t);
  assert.deepEqual(seen, [
    'progress.legacy.mergeComplete',
    'progress.legacy.selectingHighlights',
    'progress.legacy.settingUpDownloader',
  ]);
  // Unknown text passes through; i18n codes are left to their own helpers.
  assert.equal(localizeLegacyStage('Something new', t), 'Something new');
  assert.equal(
    localizeLegacyStage('__i18n__:completed', t),
    '__i18n__:completed'
  );
});
