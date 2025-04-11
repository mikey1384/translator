import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import English statically as a fallback
import enTranslation from './locales/en.json' assert { type: 'json' };
// Preload Korean as well
import koTranslation from './locales/ko.json' assert { type: 'json' };

// This function will fetch language files when needed using file URLs from main process
const loadLanguageAsync = async (
  lang: string
): Promise<Record<string, any>> => {
  let localeUrl = ''; // Define outside try block for logging
  try {
    // Get the absolute file:// URL from the main process via preload
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

// Initialize i18next
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Preload English and Korean
    resources: {
      en: {
        translation: enTranslation,
      },
      ko: {
        translation: koTranslation, // Add preloaded Korean
      },
    },
    fallbackLng: 'en',
    debug: process.env.NODE_ENV === 'development', // Enable debug only in dev
    interpolation: {
      escapeValue: false, // React already safes from XSS
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    // Important for Suspense to work correctly
    react: {
      useSuspense: true,
    },
  });

// Function to change language: Explicitly load bundle if needed
export const changeLanguage = async (lng: string) => {
  console.log(`[i18n] changeLanguage called for: ${lng}`);
  if (i18n.hasResourceBundle(lng, 'translation')) {
    console.log(`[i18n] Bundle for ${lng} already exists. Changing language.`);
    return i18n.changeLanguage(lng);
  }

  console.log(`[i18n] Bundle for ${lng} not found. Attempting to load...`);
  try {
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
