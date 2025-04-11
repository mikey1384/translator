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

// All language codes from LanguageSelection.tsx
const languages = [
  // Base languages
  { value: 'original', label: 'Same as Audio' },
  { value: 'english', label: 'English' },

  // East Asia
  { value: 'korean', label: 'Korean' },
  { value: 'japanese', label: 'Japanese' },
  { value: 'chinese_simplified', label: 'Chinese (Simplified)' },
  { value: 'chinese_traditional', label: 'Chinese (Traditional)' },
  { value: 'vietnamese', label: 'Vietnamese' },

  // Europe
  { value: 'spanish', label: 'Spanish' },
  { value: 'french', label: 'French' },
  { value: 'german', label: 'German' },
  { value: 'italian', label: 'Italian' },
  { value: 'portuguese', label: 'Portuguese' },
  { value: 'russian', label: 'Russian' },
  { value: 'dutch', label: 'Dutch' },
  { value: 'polish', label: 'Polish' },
  { value: 'swedish', label: 'Swedish' },
  { value: 'turkish', label: 'Turkish' },
  { value: 'norwegian', label: 'Norwegian' },
  { value: 'danish', label: 'Danish' },
  { value: 'finnish', label: 'Finnish' },
  { value: 'greek', label: 'Greek' },
  { value: 'czech', label: 'Czech' },
  { value: 'hungarian', label: 'Hungarian' },
  { value: 'romanian', label: 'Romanian' },
  { value: 'ukrainian', label: 'Ukrainian' },

  // South / Southeast Asia
  { value: 'hindi', label: 'Hindi' },
  { value: 'indonesian', label: 'Indonesian' },
  { value: 'thai', label: 'Thai' },
  { value: 'malay', label: 'Malay' },
  { value: 'tagalog', label: 'Tagalog (Filipino)' },
  { value: 'bengali', label: 'Bengali' },
  { value: 'tamil', label: 'Tamil' },
  { value: 'telugu', label: 'Telugu' },
  { value: 'marathi', label: 'Marathi' },
  { value: 'urdu', label: 'Urdu' },

  // Middle East / Africa
  { value: 'arabic', label: 'Arabic' },
  { value: 'hebrew', label: 'Hebrew' },
  { value: 'farsi', label: 'Farsi (Persian)' },
  { value: 'swahili', label: 'Swahili' },
  { value: 'afrikaans', label: 'Afrikaans' },
];

// Map languages to ISO codes for file naming
const languageToIsoCode = {
  english: 'en',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  japanese: 'ja',
  korean: 'ko',
  chinese_simplified: 'zh-CN',
  chinese_traditional: 'zh-TW',
  arabic: 'ar',
  hindi: 'hi',
  vietnamese: 'vi',
  dutch: 'nl',
  polish: 'pl',
  swedish: 'sv',
  turkish: 'tr',
  norwegian: 'no',
  danish: 'da',
  finnish: 'fi',
  greek: 'el',
  czech: 'cs',
  hungarian: 'hu',
  romanian: 'ro',
  ukrainian: 'uk',
  indonesian: 'id',
  thai: 'th',
  malay: 'ms',
  tagalog: 'tl',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  marathi: 'mr',
  urdu: 'ur',
  hebrew: 'he',
  farsi: 'fa',
  swahili: 'sw',
  afrikaans: 'af',
};

// List of languages that have already been manually translated
const manuallyTranslatedLanguages = ['es', 'ko']; // Spanish, Korean

// English is already created, so we'll skip it
const languagesToCreate = languages.filter(
  lang => lang.value !== 'english' && lang.value !== 'original'
);

// Helper function to deep merge objects while preserving existing translations
const deepMerge = (target, source) => {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (
        source[key] instanceof Object &&
        key in target &&
        target[key] instanceof Object
      ) {
        deepMerge(target[key], source[key]);
      } else if (!(key in target)) {
        // Only add keys that don't exist in the target
        target[key] = source[key];
      }
    }
  }
  return target;
};

languagesToCreate.forEach(lang => {
  if (!languageToIsoCode[lang.value]) {
    console.log(`Warning: No ISO code mapping for ${lang.value}, skipping...`);
    return;
  }

  const isoCode = languageToIsoCode[lang.value];
  const outputPath = path.join(__dirname, `${isoCode}.json`);

  // Check if this is a manually translated language
  if (manuallyTranslatedLanguages.includes(isoCode)) {
    try {
      // Read existing translation
      const existingTranslation = JSON.parse(
        fs.readFileSync(outputPath, 'utf8')
      );

      // Merge new keys from English while preserving existing translations
      const mergedTranslation = deepMerge(
        JSON.parse(JSON.stringify(existingTranslation)),
        enTranslation
      );

      // Write the merged translation back
      fs.writeFileSync(outputPath, JSON.stringify(mergedTranslation, null, 2));
      console.log(
        `Updated translation file for ${lang.label} (${isoCode}) while preserving existing translations`
      );
    } catch (error) {
      console.error(`Error updating ${isoCode}.json:`, error);
      // Fallback to creating a new file
      fs.writeFileSync(outputPath, JSON.stringify(enTranslation, null, 2));
      console.log(
        `Created new translation file for ${lang.label} (${isoCode})`
      );
    }
  } else {
    // For non-manually translated languages, just create a clean file from the template
    fs.writeFileSync(outputPath, JSON.stringify(enTranslation, null, 2));
    console.log(
      `Created empty translation file for ${lang.label} (${isoCode})`
    );
  }
});

console.log('All translation files generated successfully!');
