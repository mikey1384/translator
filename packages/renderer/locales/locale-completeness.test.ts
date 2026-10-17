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
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
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
      // Plural forms are per language: English's "_one" isn't required of
      // a language without that category (checked separately below).
      if (PLURAL_SUFFIX.test(key)) continue;
      const value = map.get(key);
      if (value === undefined || value.trim() === '') {
        problems.push(`${file}: missing ${key}`);
      } else if (
        placeholders(
          value.replace(/\{\{\s*languageInto\s*\}\}/g, '{{language}}')
        ) !== placeholders(source) &&
        placeholders(value) !== placeholders(source)
      ) {
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

test('plural forms match each language and keep their placeholders', () => {
  const problems: string[] = [];
  for (const file of ['en.json', ...locales]) {
    const locale = file.replace(/\.json$/, '');
    const categories = new Set(
      new Intl.PluralRules(locale).resolvedOptions().pluralCategories
    );
    const map = flatten(JSON.parse(readFileSync(join(here, file), 'utf8')));
    for (const [key, value] of map) {
      const plural = key.match(PLURAL_SUFFIX);
      if (!plural) continue;
      const base = key.slice(0, -plural[0].length);
      if (!categories.has(plural[1] as Intl.LDMLPluralRule)) {
        problems.push(`${file}: ${key} is not a ${locale} plural category`);
      }
      const source = en.get(base);
      if (source === undefined) {
        problems.push(`${file}: ${key} has no English base key`);
      } else {
        // A plural form may spell an amount out ("one line", "an hour"),
        // so it can drop placeholders, but never add one the base lacks.
        const allowed = new Set([
          ...placeholders(source).split(','),
          'languageInto',
        ]);
        const extra = placeholders(value)
          .split(',')
          .filter(name => name && !allowed.has(name));
        if (extra.length > 0) {
          problems.push(`${file}: unknown placeholders in ${key}`);
        }
      }
    }
  }
  assert.equal(problems.length, 0, problems.slice(0, 8).join('; '));
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
  // Unknown text passes through; task-specific i18n codes are left to their
  // own helpers.
  assert.equal(localizeLegacyStage('Something new', t), 'Something new');
  assert.equal(
    localizeLegacyStage('__i18n__:reviewing_range:1:2:3', t),
    '__i18n__:reviewing_range:1:2:3'
  );
});

test('bare status words and final tokens never reach the UI in English', () => {
  const seen: string[] = [];
  const t = ((key: string) => {
    seen.push(key);
    return key;
  }) as any;
  for (const stage of [
    'Starting...',
    'Completed',
    'Process cancelled',
    'Cancelling...',
    'Downloading...',
    'Downloading audio...',
    'Failed',
    'Error: Request failed with status code 500',
    '__i18n__:completed',
    '__i18n__:process_cancelled',
    '__i18n__:error',
    '__i18n__:insufficient_credits',
  ]) {
    assert.match(localizeLegacyStage(stage, t), /^progress\.legacy\./, stage);
  }
  assert.ok(seen.includes('progress.legacy.insufficientCredits'));
});
