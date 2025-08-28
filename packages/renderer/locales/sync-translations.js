#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the English translation as template
const enTranslation = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'en.json'), 'utf8')
);

// Helper function to get all keys from an object recursively
function getAllKeys(obj, prefix = '') {
  let keys = {};
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(keys, getAllKeys(obj[key], fullKey));
    } else {
      keys[fullKey] = obj[key];
    }
  }
  return keys;
}

// Helper function to set nested value
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
}

// Helper function to check if nested value exists
function hasNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (!current || !(key in current)) {
      return false;
    }
    current = current[key];
  }

  return true;
}

// Get all keys from English file
const allEnglishKeys = getAllKeys(enTranslation);

// Get all language files
const localesDir = __dirname;
const languageFiles = fs
  .readdirSync(localesDir)
  .filter(
    file => file.endsWith('.json') && file !== 'en.json' && !file.includes('package')
  );

console.log(`Found ${languageFiles.length} language files to update`);
console.log('Language files:', languageFiles.join(', '));

let totalKeysAdded = 0;
const updateSummary = {};

// Update each language file
languageFiles.forEach(filename => {
  const langCode = filename.replace('.json', '');
  const filePath = path.join(localesDir, filename);

  try {
    const langData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let keysAdded = 0;
    const missingKeys = [];

    // Find and add missing keys with English fallback
    Object.entries(allEnglishKeys).forEach(([keyPath, englishValue]) => {
      if (!hasNestedValue(langData, keyPath)) {
        setNestedValue(langData, keyPath, englishValue);
        keysAdded++;
        missingKeys.push(keyPath);
      }
    });

    if (keysAdded > 0) {
      fs.writeFileSync(filePath, JSON.stringify(langData, null, 2) + '\n');
      console.log(`✅ Updated ${filename}: Added ${keysAdded} missing keys`);
      updateSummary[langCode] = { keysAdded, missingKeys };
      totalKeysAdded += keysAdded;
    } else {
      console.log(`✓  ${filename} is already complete`);
      updateSummary[langCode] = { keysAdded: 0, missingKeys: [] };
    }
  } catch (error) {
    console.error(`❌ Error updating ${filename}:`, error.message);
  }
});

console.log('\n========================================');
console.log('🎉 Translation sync complete!');
console.log(`📊 Total keys added across all files: ${totalKeysAdded}`);

// Show details of what was added
if (totalKeysAdded > 0) {
  console.log('\n📝 Missing keys that were added (with English fallbacks):');
  
  // Get unique list of all missing keys
  const allMissingKeys = new Set();
  Object.values(updateSummary).forEach(({ missingKeys }) => {
    missingKeys.forEach(key => allMissingKeys.add(key));
  });
  
  Array.from(allMissingKeys).sort().forEach(key => {
    console.log(`  - ${key}`);
  });
  
  console.log('\n⚠️  Note: These keys have been added with English text as fallback.');
  console.log('   Professional translation is recommended for production use.');
}