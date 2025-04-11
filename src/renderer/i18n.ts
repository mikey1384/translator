import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enTranslation from './locales/en.json' assert { type: 'json' };
import koTranslation from './locales/ko.json' assert { type: 'json' };
import jaTranslation from './locales/ja.json' assert { type: 'json' };
import msTranslation from './locales/ms.json' assert { type: 'json' };
import plTranslation from './locales/pl.json' assert { type: 'json' };
import zhCNTranslation from './locales/zh-CN.json' assert { type: 'json' };
import zhTWTranslation from './locales/zh-TW.json' assert { type: 'json' };
import esTranslation from './locales/es.json' assert { type: 'json' };
import frTranslation from './locales/fr.json' assert { type: 'json' };
import deTranslation from './locales/de.json' assert { type: 'json' };
import itTranslation from './locales/it.json' assert { type: 'json' };
import ptTranslation from './locales/pt.json' assert { type: 'json' };
import ruTranslation from './locales/ru.json' assert { type: 'json' };
import nlTranslation from './locales/nl.json' assert { type: 'json' };
import svTranslation from './locales/sv.json' assert { type: 'json' };
import trTranslation from './locales/tr.json' assert { type: 'json' };
import noTranslation from './locales/no.json' assert { type: 'json' };
import daTranslation from './locales/da.json' assert { type: 'json' };
import fiTranslation from './locales/fi.json' assert { type: 'json' };
import elTranslation from './locales/el.json' assert { type: 'json' };
import csTranslation from './locales/cs.json' assert { type: 'json' };
import huTranslation from './locales/hu.json' assert { type: 'json' };
import roTranslation from './locales/ro.json' assert { type: 'json' };
import ukTranslation from './locales/uk.json' assert { type: 'json' };
import hiTranslation from './locales/hi.json' assert { type: 'json' };
import idTranslation from './locales/id.json' assert { type: 'json' };
import thTranslation from './locales/th.json' assert { type: 'json' };
import tlTranslation from './locales/tl.json' assert { type: 'json' };
import bnTranslation from './locales/bn.json' assert { type: 'json' };
import taTranslation from './locales/ta.json' assert { type: 'json' };
import teTranslation from './locales/te.json' assert { type: 'json' };
import mrTranslation from './locales/mr.json' assert { type: 'json' };
import urTranslation from './locales/ur.json' assert { type: 'json' };
import arTranslation from './locales/ar.json' assert { type: 'json' };
import heTranslation from './locales/he.json' assert { type: 'json' };
import faTranslation from './locales/fa.json' assert { type: 'json' };
import swTranslation from './locales/sw.json' assert { type: 'json' };
import afTranslation from './locales/af.json' assert { type: 'json' };
import viTranslation from './locales/vi.json' assert { type: 'json' };

// Storage keys for Electron app
// const LANGUAGE_PREFERENCE_KEY = 'app_language_preference'; // No longer needed here

// Helper to get initial language from electron storage or localStorage fallback
const getInitialLanguage = async (): Promise<string> => {
  try {
    // Prioritize Electron store via IPC
    if (window.electron?.getLanguagePreference) {
      const storedLang = await window.electron.getLanguagePreference();
      if (storedLang) {
        console.log(
          `[i18n] Retrieved language from Electron store: ${storedLang}`
        );
        return storedLang;
      }
    }
    // Fallback to localStorage if IPC fails or isn't available
    const storedLangLS = localStorage.getItem('app_language_preference'); // Use old key for fallback
    if (storedLangLS) {
      console.log(
        `[i18n] Retrieved language from localStorage fallback: ${storedLangLS}`
      );
      return storedLangLS;
    }
  } catch (error) {
    console.error('[i18n] Error retrieving initial language:', error);
  }

  // Default to browser/system language or English
  const defaultLang = navigator.language.split('-')[0] || 'en';
  console.log(`[i18n] Using default language: ${defaultLang}`);
  return defaultLang;
};

// This function will fetch language files when needed using file URLs from main process
const loadLanguageAsync = async (
  lang: string
): Promise<Record<string, any>> => {
  let localeUrl = ''; // Define outside try block for logging
  try {
    localeUrl = await window.electron.getLocaleUrl(lang);
    if (!localeUrl) {
      throw new Error(
        `[i18n] Failed to get locale URL for ${lang} from main process.`
      );
    }

    console.log(`[i18n] Attempting to fetch locale from: ${localeUrl}`);

    const response = await fetch(localeUrl);
    console.log(`[i18n] Fetch response status for ${lang}: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text(); // Try to get error body
      console.error(`[i18n] Fetch failed response text: ${errorText}`);
      throw new Error(
        `Failed to fetch ${lang}.json from ${localeUrl}: ${response.status} ${response.statusText}`
      );
    }

    // Log raw text before parsing
    const rawText = await response.text();
    console.log(
      `[i18n] Received raw text for ${lang} (length: ${rawText.length})`
    );

    // Reparse from the raw text
    const translations = JSON.parse(rawText);

    if (!translations || Object.keys(translations).length === 0) {
      console.error(
        `[i18n] Parsed translations for ${lang} are empty or invalid.`
      );
      throw new Error(`Parsed translations for ${lang} are empty.`);
    }

    console.log(
      `[i18n] Successfully loaded and parsed translations for ${lang}`
    );
    return translations;
  } catch (error) {
    console.error(
      `[i18n] Failed to load language file for ${lang}. URL: ${localeUrl || '(URL not fetched)'}. Error:`,
      error
    );
    // Fallback to English if loading fails
    return enTranslation;
  }
};

// Asynchronously get initial language
let initialLanguage = 'en'; // Default before async fetch
getInitialLanguage()
  .then(lang => {
    initialLanguage = lang;
    console.log(`[i18n] Setting initial language to: ${initialLanguage}`);
    // Re-initialize or update language after fetching
    i18n.changeLanguage(initialLanguage).catch(err => {
      console.error(
        `[i18n] Error setting language after initial fetch: ${err}`
      );
    });
  })
  .catch(err => {
    console.error('[i18n] Failed to get initial language:', err);
    // Keep default 'en'
  });

// Initialize i18next
i18n
  .use(LanguageDetector) // Still useful for initial detection before persistence kicks in
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslation,
      },
      ko: {
        translation: koTranslation,
      },
      ja: {
        translation: jaTranslation,
      },
      ms: {
        translation: msTranslation,
      },
      pl: {
        translation: plTranslation,
      },
      ['zh-CN']: {
        translation: zhCNTranslation,
      },
      ['zh-TW']: {
        translation: zhTWTranslation,
      },
      es: {
        translation: esTranslation,
      },
      fr: {
        translation: frTranslation,
      },
      de: {
        translation: deTranslation,
      },
      it: {
        translation: itTranslation,
      },
      pt: {
        translation: ptTranslation,
      },
      ru: {
        translation: ruTranslation,
      },
      nl: {
        translation: nlTranslation,
      },
      sv: {
        translation: svTranslation,
      },
      tr: {
        translation: trTranslation,
      },
      no: {
        translation: noTranslation,
      },
      da: {
        translation: daTranslation,
      },
      fi: {
        translation: fiTranslation,
      },
      el: {
        translation: elTranslation,
      },
      cs: {
        translation: csTranslation,
      },
      hu: {
        translation: huTranslation,
      },
      ro: {
        translation: roTranslation,
      },
      uk: {
        translation: ukTranslation,
      },
      hi: {
        translation: hiTranslation,
      },
      id: {
        translation: idTranslation,
      },
      th: {
        translation: thTranslation,
      },
      tl: {
        translation: tlTranslation,
      },
      bn: {
        translation: bnTranslation,
      },
      ta: {
        translation: taTranslation,
      },
      te: {
        translation: teTranslation,
      },
      mr: {
        translation: mrTranslation,
      },
      ur: {
        translation: urTranslation,
      },
      ar: {
        translation: arTranslation,
      },
      he: {
        translation: heTranslation,
      },
      fa: {
        translation: faTranslation,
      },
      sw: {
        translation: swTranslation,
      },
      af: {
        translation: afTranslation,
      },
      vi: {
        translation: viTranslation,
      },
    },
    lng: initialLanguage, // Set initial language explicitly (will be updated async)
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development', // Enable debug only in dev
    interpolation: {
      escapeValue: false, // React already safes from XSS
    },
    // detection: false, // Disable i18next detector, we handle it manually
    // Important for Suspense to work correctly
    react: {
      useSuspense: true,
    },
  });

// Function to change language: Use IPC to save preference
export const changeLanguage = async (lng: string) => {
  console.log(`[i18n] changeLanguage called for: ${lng}`);

  try {
    // Always store the selection via IPC to electron-store
    if (window.electron?.setLanguagePreference) {
      await window.electron.setLanguagePreference(lng);
      console.log(
        `[i18n] Saved language preference via Electron store: ${lng}`
      );
    } else {
      console.warn(
        '[i18n] setLanguagePreference via IPC not available. Falling back to localStorage.'
      );
      // Fallback to localStorage if IPC isn't available
      localStorage.setItem('app_language_preference', lng);
    }

    // Load bundle if needed and change language
    if (i18n.hasResourceBundle(lng, 'translation')) {
      console.log(
        `[i18n] Bundle for ${lng} already exists. Changing language.`
      );
      return i18n.changeLanguage(lng);
    }

    console.log(`[i18n] Bundle for ${lng} not found. Attempting to load...`);
    const translations = await loadLanguageAsync(lng);
    if (
      translations &&
      Object.keys(translations).length > 0 &&
      translations !== enTranslation
    ) {
      // Check if it's not the fallback
      i18n.addResourceBundle(lng, 'translation', translations);
      console.log(`[i18n] Bundle for ${lng} added. Changing language.`);
      return i18n.changeLanguage(lng);
    } else {
      // loadLanguageAsync might have returned the English fallback
      // or an empty object if fetch/parse failed but didn't throw hard enough
      console.warn(
        `[i18n] Loaded translations for ${lng} were empty or fallback. Not adding bundle. Falling back to English.`
      );
      // Ensure fallback if the loaded data *was* the English fallback
      if (i18n.language !== 'en') {
        return i18n.changeLanguage('en');
      }
      // If already english, no need to change
      return Promise.resolve();
    }
  } catch (error) {
    console.error(
      `[i18n] Error in changeLanguage while loading ${lng}:`,
      error
    );
    // Fallback to English on any error during loading/adding
    return i18n.changeLanguage('en');
  }
};

export default i18n;
