#!/usr/bin/env node
/**
 * Locale Audit Script
 *
 * Checks all locale files for:
 * 1. Missing keys compared to en.json (the source of truth)
 * 2. Values that are still in English (not translated)
 *
 * Exit codes:
 *   0 - All locales are complete and translated
 *   1 - Issues found (missing keys or untranslated strings)
 */

import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Allowlist of strings that should remain in English (brand names, acronyms, etc.)
const ALLOWLIST_PATTERNS = [
  // Brand names
  /^Stage5$/i,
  /^OpenAI$/i,
  /^Anthropic$/i,
  /^ElevenLabs$/i,
  /^YouTube$/i,
  /^TikTok$/i,
  /^Instagram$/i,
  /^Claude$/i,
  /^Whisper$/i,
  /^Scribe$/i,
  /^GPT-?\d/i,
  /^Opus/i,
  /^Sonnet/i,

  // File formats and technical terms
  /^SRT$/i,
  /^URL$/i,
  /^API$/i,
  /^MP4$/i,
  /^TTS$/i,
  /^BYO$/i,
  /^iCloud$/i,
  /^Finder$/i,

  // Resolution strings
  /^8K$/i,
  /^4K$/i,
  /^2K$/i,
  /^UHD 8K$/i,
  /^HD 4K$/i,
  /^HQ 2K$/i,

  // OS names
  /^macOS$/i,
  /^Windows$/i,

  // Voice names (proper nouns)
  /^Alloy$/i,
  /^Echo$/i,
  /^Fable$/i,
  /^Onyx$/i,
  /^Nova$/i,
  /^Shimmer$/i,
  /^Rachel$/i,
  /^Adam$/i,
  /^Josh$/i,
  /^Sarah$/i,
  /^Charlie$/i,
  /^Emily$/i,
  /^Matilda$/i,
  /^Brian$/i,

  // Symbols and arrows
  /^←$/,
  /^→$/,

  // URLs and domains (these appear in text)
  /platform\.openai\.com/i,
  /console\.anthropic\.com/i,
  /elevenlabs\.io/i,

  // Technical strings that are the same everywhere
  /^sk-/,
  /^sk-ant-/,
  /^\(hq\)$/,
  /^\(deep\)$/,

  // Model identifiers
  /^GPT-5\.1$/i,
  /^Claude Opus$/i,
  /^Claude Sonnet$/i,
  /^Opus 4\.5$/i,
  /^OpenAI Whisper$/i,
  /^ElevenLabs Scribe$/i,
  /^OpenAI TTS$/i,

  // Single characters or very short strings that might be intentionally the same
  /^OK$/i,
  /^OR$/i,
  /^\.\.\.$/, // ellipsis

  // Language names that are often kept as-is internationally
  /^Hindi$/i,
  /^Tamil$/i,
  /^Telugu$/i,
  /^Marathi$/i,
  /^Urdu$/i,
  /^Bengali$/i,
  /^Swahili$/i,
  /^Afrikaans$/i,
  /^Thai$/i,
  /^Tagalog/i,

  // Words that are commonly the same across languages or acceptable as-is
  /^Premium \(ElevenLabs\)$/i,
  /^Standard \(OpenAI TTS\)$/i,
  /^Original:$/i,
  /^Error$/i,
  /^Download$/i,
  /^Upload$/i,
  /^Medium$/i,
  /^Find$/i,
  /^Dubbing$/i,
  /^Optional$/i,
  /^Open \.srt$/i,

  // Credit/time estimate patterns that contain mostly placeholders
  /^~\{\{minutes\}\}m video$/,
  /^\{\{credits\}\} cr \(~\{\{minutes\}\}m\)$/,

  // API key labels (technical terms often kept as-is)
  /API Key$/i,
  /^OpenAI API Key$/i,
  /^Anthropic API Key$/i,
  /^ElevenLabs API Key$/i,

  // Other technical terms commonly kept in English
  /^TTS Quality/i,
  /^Transcription$/i,
  /^Translation \(Draft\)$/i,
  /^Translation \(Review\)$/i,
  /^Highlight$/i,
  /^Section \{\{index\}\}$/i,

  // Common words that are the same or acceptable in many languages
  /^Europe$/i,
  /^File$/i,
  /^credits$/i,
  /^Best$/i,

  // Short technical strings with placeholders
  /^~\{\{minutes\}\}m audio$/,
  /^\{\{credits\}\} credits$/,

  // Debug/technical email subject
  /^Stage5 Debug Logs$/i,
];

// Values that are definitely intentional to keep in English
const EXACT_ALLOWLIST = new Set([
  'App',
  'Video',
  'OK',
  '←',
  '...',
  '(hq)',
  '(deep)',
]);

/**
 * Flatten a nested object into dot-notation keys
 * @param {object} obj - The object to flatten
 * @param {string} prefix - The current key prefix
 * @returns {Map<string, string>} - Map of flattened key -> value
 */
function flattenObject(obj, prefix = '') {
  const result = new Map();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = flattenObject(value, fullKey);
      for (const [k, v] of nested) {
        result.set(k, v);
      }
    } else if (typeof value === 'string') {
      result.set(fullKey, value);
    }
  }

  return result;
}

/**
 * Check if a value is allowed to be the same as English
 * @param {string} value - The string value to check
 * @returns {boolean}
 */
function isAllowlisted(value) {
  if (EXACT_ALLOWLIST.has(value)) {
    return true;
  }

  // Check if the value matches any allowlist pattern
  for (const pattern of ALLOWLIST_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }

  // Allow strings that are mostly placeholders/variables
  const withoutPlaceholders = value.replace(/\{\{[^}]+\}\}/g, '').trim();
  if (withoutPlaceholders.length <= 2) {
    return true;
  }

  // Allow strings that contain mostly non-alphabetic characters
  const alphaOnly = value.replace(/[^a-zA-Z]/g, '');
  if (alphaOnly.length <= 3) {
    return true;
  }

  return false;
}

/**
 * Get locale name from filename
 * @param {string} filename
 * @returns {string}
 */
function getLocaleName(filename) {
  const localeMap = {
    'af': 'Afrikaans',
    'ar': 'Arabic',
    'bn': 'Bengali',
    'cs': 'Czech',
    'da': 'Danish',
    'de': 'German',
    'el': 'Greek',
    'es': 'Spanish',
    'fa': 'Farsi',
    'fi': 'Finnish',
    'fr': 'French',
    'he': 'Hebrew',
    'hi': 'Hindi',
    'hu': 'Hungarian',
    'id': 'Indonesian',
    'it': 'Italian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'mr': 'Marathi',
    'ms': 'Malay',
    'nl': 'Dutch',
    'no': 'Norwegian',
    'pl': 'Polish',
    'pt': 'Portuguese',
    'ro': 'Romanian',
    'ru': 'Russian',
    'sv': 'Swedish',
    'sw': 'Swahili',
    'ta': 'Tamil',
    'te': 'Telugu',
    'th': 'Thai',
    'tl': 'Tagalog',
    'tr': 'Turkish',
    'uk': 'Ukrainian',
    'ur': 'Urdu',
    'vi': 'Vietnamese',
    'zh-CN': 'Chinese (Simplified)',
    'zh-TW': 'Chinese (Traditional)',
  };

  const code = filename.replace('.json', '');
  return localeMap[code] || code;
}

function main() {
  // Load English (source of truth)
  const enPath = join(__dirname, 'en.json');
  const enData = JSON.parse(readFileSync(enPath, 'utf-8'));
  const enKeys = flattenObject(enData);

  console.log(`Source of truth: en.json (${enKeys.size} keys)\n`);

  // Get all locale files
  const files = readdirSync(__dirname)
    .filter(f => f.endsWith('.json') && f !== 'en.json')
    .sort();

  let totalMissing = 0;
  let totalUntranslated = 0;
  const issues = [];

  for (const file of files) {
    const localePath = join(__dirname, file);
    const localeData = JSON.parse(readFileSync(localePath, 'utf-8'));
    const localeKeys = flattenObject(localeData);
    const localeName = getLocaleName(file);

    const missing = [];
    const untranslated = [];

    // Check for missing keys
    for (const [key, enValue] of enKeys) {
      if (!localeKeys.has(key)) {
        missing.push({ key, enValue });
      }
    }

    // Check for untranslated strings (value === English value)
    for (const [key, localeValue] of localeKeys) {
      const enValue = enKeys.get(key);
      if (enValue && localeValue === enValue && !isAllowlisted(enValue)) {
        untranslated.push({ key, value: enValue });
      }
    }

    if (missing.length > 0 || untranslated.length > 0) {
      issues.push({
        file,
        localeName,
        missing,
        untranslated,
      });
      totalMissing += missing.length;
      totalUntranslated += untranslated.length;
    }
  }

  // Output results
  if (issues.length === 0) {
    console.log('All locales are complete and translated!');
    process.exit(0);
  }

  for (const { file, localeName, missing, untranslated } of issues) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`${file} (${localeName})`);
    console.log('='.repeat(60));

    if (missing.length > 0) {
      console.log(`\n  Missing keys (${missing.length}):`);
      for (const { key, enValue } of missing.slice(0, 20)) {
        const preview = enValue.length > 50 ? enValue.slice(0, 47) + '...' : enValue;
        console.log(`    - ${key}: "${preview}"`);
      }
      if (missing.length > 20) {
        console.log(`    ... and ${missing.length - 20} more`);
      }
    }

    if (untranslated.length > 0) {
      console.log(`\n  Untranslated strings (${untranslated.length}):`);
      for (const { key, value } of untranslated.slice(0, 20)) {
        const preview = value.length > 50 ? value.slice(0, 47) + '...' : value;
        console.log(`    - ${key}: "${preview}"`);
      }
      if (untranslated.length > 20) {
        console.log(`    ... and ${untranslated.length - 20} more`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Locales with issues: ${issues.length}/${files.length}`);
  console.log(`Total missing keys: ${totalMissing}`);
  console.log(`Total untranslated strings: ${totalUntranslated}`);

  process.exit(1);
}

main();
