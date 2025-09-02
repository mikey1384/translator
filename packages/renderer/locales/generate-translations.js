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

  try {
    // Read existing translation
    const existingTranslation = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

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
    console.log(`Created new translation file for ${lang.label} (${isoCode})`);
  }
});

// New translation keys that need to be added to all languages
const newKeys = {
  // New translate button label used across Edit and Generate panels
  'subtitles.translate': 'Translate',
  'common.error.missingVideoMetadata': 'Missing video metadata ({{missing}})',
  'common.error.noSourceVideo': 'No source video',
  'common.error.noSubtitlesLoaded': 'No subtitles loaded',
  'common.error.failedToLoadSRT': 'Failed to load SRT file',
  'common.fileFilters.srtFiles': 'SRT Files',
  'common.fileFilters.mediaFiles': 'Media Files',
  'common.fileFilters.videoFiles': 'Video Files',
  'dialogs.saveSrtFileAs': 'Save SRT File As',
  'dialogs.saveDownloadedVideoAs': 'Save Downloaded Video As',
  'dialogs.downloadInProgress': 'Download in Progress',
  'dialogs.saveDownloadedFile': 'Save the downloaded file: {{path}}',
  'dialogs.transcriptionInProgress': 'Transcription in Progress',
  'dialogs.translationInProgress': 'Translation in Progress',
  'videoPlayer.scrollToCurrentSubtitle': 'Scroll to current subtitle',
  'videoPlayer.changeVideo': 'Change Video',
  'videoPlayer.mountSrt': 'Mount SRT',
  'videoPlayer.changeSrt': 'Change SRT',
  // New: Unsaved SRT confirmation on transcribe
  'dialogs.unsavedSrtOnTranscribe.title':
    'Save current subtitles before transcribing?',
  'dialogs.unsavedSrtOnTranscribe.message':
    'You already have subtitles mounted. Transcribing will replace them. What would you like to do?',
  'dialogs.unsavedSrtOnTranscribe.saveAndTranscribe': 'Save and Transcribe',
  'dialogs.unsavedSrtOnTranscribe.discardAndTranscribe':
    'Discard and Transcribe',
  'dialogs.unsavedSrtOnTranscribe.cancel': 'Cancel',
  'input.srtFileLoaded': 'SRT Loaded',
  'dialogs.cancelTranslationConfirm':
    "Cancel translation? Progress will be lost and you'll need to start again.",
  'progress.transcribedChunks':
    'Transcribed & scrubbed {{done}}/{{total}} chunks',
  'progress.gapRepair': 'Gap repair #{{iteration}} ({{done}}/{{total}})',
  'progress.repairingCaptions':
    'Repairing missing captions (Iteration {{iteration}}/{{maxIterations}}) {{done}} / {{total}}',
  'messages.fileSaved': 'File saved:\n{{path}}',
  'messages.videoSaved': 'Video saved to:\n{{path}}',
  'videoPlayer.enterFullscreen': 'Enter Fullscreen',
  'videoPlayer.exitFullscreen': 'Exit Fullscreen',
  'generateSubtitles.calculatingCost': 'Calculating cost...',
  'generateSubtitles.notEnoughCredits': 'Not enough credits available',
  'findBar.findPlaceholder': 'Find in subtitles...',
  'findBar.replacePlaceholder': 'Replace with...',
  'findBar.replaceAll': 'Replace All',
  'findBar.nextMatch': 'Next Match (Enter)',
  'findBar.previousMatch': 'Previous Match (Shift+Enter)',
  'findBar.replaceAllTitle': 'Replace All Occurrences',
  'findBar.closeTitle': 'Close (Esc)',
  'findBar.nextMatchAria': 'Next match',
  'findBar.previousMatchAria': 'Previous match',
  'findBar.replaceAllAria': 'Replace all',
  'findBar.closeAria': 'Close find bar',
};

// Read the English file as reference
const enFile = path.join(__dirname, 'en.json');
const enData = JSON.parse(fs.readFileSync(enFile, 'utf8'));

// Get all language files
const localesDir = __dirname;
const languageFiles = fs
  .readdirSync(localesDir)
  .filter(
    file => file.endsWith('.json') && file !== 'en.json' && file !== 'ko.json'
  );

console.log(
  `Found ${languageFiles.length} language files to update:`,
  languageFiles
);

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

function hasNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (!current || !current[key]) {
      return false;
    }
    current = current[key];
  }

  return true;
}

// Update each language file
languageFiles.forEach(filename => {
  const langCode = filename.replace('.json', '');
  const filePath = path.join(localesDir, filename);

  try {
    const langData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    let hasChanges = false;

    // Add missing keys with English fallback
    Object.entries(newKeys).forEach(([keyPath, englishValue]) => {
      if (!hasNestedValue(langData, keyPath)) {
        setNestedValue(langData, keyPath, englishValue);
        hasChanges = true;
        console.log(`Added ${keyPath} to ${langCode}`);
      }
    });

    if (hasChanges) {
      fs.writeFileSync(filePath, JSON.stringify(langData, null, 2) + '\n');
      console.log(`✅ Updated ${filename}`);
    } else {
      console.log(`ℹ️  ${filename} already up to date`);
    }
  } catch (error) {
    console.error(`❌ Error updating ${filename}:`, error.message);
  }
});

console.log('\n🎉 Translation update complete!');
console.log('📝 Note: New keys have been added with English fallbacks.');
console.log('🔄 Consider running professional translation for production use.');
