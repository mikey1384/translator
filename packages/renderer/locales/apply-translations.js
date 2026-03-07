#!/usr/bin/env node
/**
 * Apply translated keys to locale JSON files.
 * Usage: node apply-translations.js
 *
 * Reads translations from translations-batch.json and merges into locale files.
 * The batch file format is: { "ko": { "common.send": "보내기", ... }, "ja": { ... }, ... }
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOCALES_DIR = __dirname;
const BATCH_FILE = path.join(LOCALES_DIR, 'translations-batch.json');
const EN_FILE = path.join(LOCALES_DIR, 'en.json');

function setDeep(obj, dotKey, value) {
  const parts = dotKey.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function getDeep(obj, dotKey) {
  const parts = dotKey.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function main() {
  if (!fs.existsSync(BATCH_FILE)) {
    console.error(`❌ ${BATCH_FILE} not found. Create it first.`);
    process.exit(1);
  }
  if (!fs.existsSync(EN_FILE)) {
    console.error(`❌ ${EN_FILE} not found.`);
    process.exit(1);
  }

  const batch = JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8'));
  const en = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
  const langs = Object.keys(batch);
  console.log(`Processing ${langs.length} languages...`);

  let totalUpdated = 0;

  for (const lang of langs) {
    const filePath = path.join(LOCALES_DIR, `${lang}.json`);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  ${lang}.json not found, skipping`);
      continue;
    }

    const locale = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const translations = batch[lang];
    let count = 0;

    for (const [dotKey, value] of Object.entries(translations)) {
      if (typeof value !== 'string' || !value.trim()) continue;
      // Allow update when locale is missing key, already matches target value,
      // or still uses the English fallback value.
      const existing = getDeep(locale, dotKey);
      const english = getDeep(en, dotKey);
      if (
        existing !== undefined &&
        existing !== value &&
        existing !== english
      ) {
        // Already translated differently, skip
        continue;
      }
      setDeep(locale, dotKey, value);
      count++;
    }

    fs.writeFileSync(filePath, JSON.stringify(locale, null, 2) + '\n', 'utf8');
    console.log(`✅ ${lang}.json: Updated ${count} keys`);
    totalUpdated += count;
  }

  console.log(`\n🎉 Done! Updated ${totalUpdated} total translations across ${langs.length} languages.`);
}

main();
