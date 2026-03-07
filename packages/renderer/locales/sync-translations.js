#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import manualOverrides from './sync-translations-overrides.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EN_FILE = path.join(__dirname, 'en.json');
const BATCH_FILE = path.join(__dirname, 'translations-batch.json');

const enTranslation = JSON.parse(fs.readFileSync(EN_FILE, 'utf8'));
const batchTranslations = fs.existsSync(BATCH_FILE)
  ? JSON.parse(fs.readFileSync(BATCH_FILE, 'utf8'))
  : {};

const PLACEHOLDER_NORMALIZERS = {
  'settings.performanceQuality.qualityTranslation.helpWithEstimateOn': value =>
    replacePlaceholders(value, { hqTime: 'time' }),
  'settings.performanceQuality.qualityTranslation.helpWithEstimateOff': value =>
    replacePlaceholders(value, { normalTime: 'time' }),
  'settings.performanceQuality.qualitySummary.helpWithEstimateOn': value =>
    replacePlaceholders(value, { hqTime: 'time' }),
  'settings.performanceQuality.qualitySummary.helpWithEstimateOff': value =>
    replacePlaceholders(value, { normalTime: 'time' }),
  'settings.performanceQuality.qualityDubbing.helpWithEstimateOn': value =>
    replacePlaceholders(value, { hqTime: 'time' }),
  'settings.performanceQuality.qualityDubbing.helpWithEstimateOff': value =>
    replacePlaceholders(value, { normalTime: 'time' }),
};

const MANUAL_OVERRIDES = manualOverrides;

const MODEL_HELP_KEYS = {
  'settings.performanceQuality.qualityTranslation.modelOn':
    'settings.performanceQuality.qualityTranslation.helpOn',
  'settings.performanceQuality.qualityTranslation.modelOff':
    'settings.performanceQuality.qualityTranslation.helpOff',
  'settings.performanceQuality.qualitySummary.modelOn':
    'settings.performanceQuality.qualitySummary.helpOn',
  'settings.performanceQuality.qualitySummary.modelOff':
    'settings.performanceQuality.qualitySummary.helpOff',
  'settings.performanceQuality.qualityDubbing.modelOn':
    'settings.performanceQuality.qualityDubbing.helpOn',
  'settings.performanceQuality.qualityDubbing.modelOff':
    'settings.performanceQuality.qualityDubbing.helpOff',
};

const BALANCE_HELP_KEYS = [
  'settings.performanceQuality.qualityTranslation.helpWithEstimateOff',
  'settings.performanceQuality.qualitySummary.helpWithEstimateOff',
  'settings.performanceQuality.qualityDubbing.helpWithEstimateOff',
  'settings.performanceQuality.qualityTranslation.helpWithEstimateOn',
  'settings.performanceQuality.qualitySummary.helpWithEstimateOn',
  'settings.performanceQuality.qualityDubbing.helpWithEstimateOn',
];

function replacePlaceholders(value, replacements) {
  if (typeof value !== 'string') return value;
  let nextValue = value;
  for (const [from, to] of Object.entries(replacements)) {
    nextValue = nextValue.replaceAll(`{{${from}}}`, `{{${to}}}`);
  }
  return nextValue;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getDeep(obj, dotKey) {
  return dotKey.split('.').reduce((current, part) => current?.[part], obj);
}

function flattenObject(obj, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenObject(value, fullKey, out);
      continue;
    }
    out.add(fullKey);
  }
  return out;
}

function extractTokens(value) {
  if (typeof value !== 'string') return [];

  const variables = [...value.matchAll(/\{\{([^}]+)\}\}/g)].map(
    match => `var:${match[1]}`
  );
  const openTags = [...value.matchAll(/<([0-9]+)>/g)].map(
    match => `open:${match[1]}`
  );
  const closeTags = [...value.matchAll(/<\/([0-9]+)>/g)].map(
    match => `close:${match[1]}`
  );

  return [...variables, ...openTags, ...closeTags].sort();
}

function hasMatchingTokens(sourceValue, candidateValue) {
  if (typeof sourceValue !== 'string' || typeof candidateValue !== 'string') {
    return false;
  }

  return (
    extractTokens(sourceValue).join('|') ===
    extractTokens(candidateValue).join('|')
  );
}

function normalizeValue(key, value) {
  if (typeof value !== 'string') return value;
  return PLACEHOLDER_NORMALIZERS[key]?.(value) ?? value;
}

function extractDescriptor(helpValue) {
  if (typeof helpValue !== 'string') return null;

  const withoutTags = helpValue.replace(/<[^>]+>/g, '').trim();
  if (!withoutTags) return null;

  const parts = withoutTags
    .split('•')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    return parts.slice(1).join(' • ').trim();
  }

  return parts[0] || null;
}

function deriveAdminTitle(localeData) {
  const adminHeader = getDeep(localeData, 'admin.addStandardPackTitle');
  if (typeof adminHeader !== 'string') return null;

  const match = adminHeader.match(/^(.+?)[：:]/);
  if (match?.[1]) {
    return match[1].trim();
  }

  return null;
}

function deriveBalanceLabel(localeData) {
  for (const key of BALANCE_HELP_KEYS) {
    const value = normalizeValue(key, getDeep(localeData, key));
    if (typeof value !== 'string') continue;

    const parts = value
      .split('•')
      .map(part => part.trim())
      .filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (/\{\{time\}\}/.test(parts[index])) {
        return parts[index];
      }
    }

    const match = value.match(/([^•]*\{\{time\}\}[^•]*)/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function deriveRateValue(localeData, unit) {
  const creditsWord =
    getDeep(localeData, 'credits.credits') ??
    getDeep(localeData, 'settings.dubbing.credits') ??
    'credits';
  const hoursWord = getDeep(localeData, 'credits.hours') ?? 'hour';
  const searchWord = getDeep(localeData, 'common.search') ?? 'search';

  if (unit === 'perHour') {
    return `~{{credits}} ${creditsWord}/${hoursWord}`;
  }

  if (unit === 'perMinute') {
    return `~{{credits}} ${creditsWord}/min`;
  }

  return `~{{credits}} ${creditsWord}/${searchWord}`;
}

function deriveValue(key, localeData) {
  if (key === 'admin.title') {
    return deriveAdminTitle(localeData);
  }

  if (key in MODEL_HELP_KEYS) {
    return extractDescriptor(getDeep(localeData, MODEL_HELP_KEYS[key]));
  }

  if (key === 'settings.performanceQuality.rate.balance') {
    return deriveBalanceLabel(localeData);
  }

  if (key.endsWith('.rate.perHour')) {
    return deriveRateValue(localeData, 'perHour');
  }

  if (key.endsWith('.rate.perMinute')) {
    return deriveRateValue(localeData, 'perMinute');
  }

  if (key.endsWith('.rate.perSearch')) {
    return deriveRateValue(localeData, 'perSearch');
  }

  return null;
}

function resolveLeafValue(langCode, key, sourceValue, localeData) {
  const overrideValue = normalizeValue(key, MANUAL_OVERRIDES[langCode]?.[key]);
  if (hasMatchingTokens(sourceValue, overrideValue)) {
    return { value: overrideValue, source: 'derived' };
  }

  const existingValue = normalizeValue(key, getDeep(localeData, key));
  if (hasMatchingTokens(sourceValue, existingValue)) {
    return { value: existingValue, source: 'existing' };
  }

  const derivedValue = normalizeValue(key, deriveValue(key, localeData));
  if (hasMatchingTokens(sourceValue, derivedValue)) {
    return { value: derivedValue, source: 'derived' };
  }

  const batchValue = normalizeValue(key, batchTranslations[langCode]?.[key]);
  if (hasMatchingTokens(sourceValue, batchValue)) {
    return { value: batchValue, source: 'batch' };
  }

  return { value: sourceValue, source: 'english' };
}

function buildLocaleObject(langCode, localeData, sourceNode, prefix = '') {
  const result = {};
  const stats = {
    existing: 0,
    derived: 0,
    batch: 0,
    english: 0,
  };

  for (const [key, sourceValue] of Object.entries(sourceNode)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(sourceValue)) {
      const nested = buildLocaleObject(langCode, localeData, sourceValue, fullKey);
      result[key] = nested.result;
      for (const statKey of Object.keys(stats)) {
        stats[statKey] += nested.stats[statKey];
      }
      continue;
    }

    const resolved = resolveLeafValue(langCode, fullKey, sourceValue, localeData);
    result[key] = resolved.value;
    stats[resolved.source] += 1;
  }

  return { result, stats };
}

const localeFiles = fs
  .readdirSync(__dirname)
  .filter(
    file =>
      file.endsWith('.json') &&
      file !== 'en.json' &&
      file !== 'translations-batch.json'
  )
  .sort();

const sourceKeySet = flattenObject(enTranslation);

console.log(`Found ${localeFiles.length} locale files to sync`);

let totalRemovedKeys = 0;
let totalFallbacks = 0;

for (const filename of localeFiles) {
  const langCode = filename.replace('.json', '');
  const filePath = path.join(__dirname, filename);
  const localeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const localeKeySet = flattenObject(localeData);
  const removedKeys = [...localeKeySet].filter(key => !sourceKeySet.has(key));

  const { result, stats } = buildLocaleObject(
    langCode,
    localeData,
    enTranslation
  );

  fs.writeFileSync(filePath, JSON.stringify(result, null, 2) + '\n');

  totalRemovedKeys += removedKeys.length;
  totalFallbacks += stats.english;

  console.log(
    [
      `✅ ${filename}`,
      `existing ${stats.existing}`,
      `derived ${stats.derived}`,
      `batch ${stats.batch}`,
      `english ${stats.english}`,
      `removed ${removedKeys.length}`,
    ].join(' | ')
  );
}

console.log('\n========================================');
console.log('Locale sync complete');
console.log(`English fallbacks used: ${totalFallbacks}`);
console.log(`Retired keys removed: ${totalRemovedKeys}`);
