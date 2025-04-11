import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import all the language files here
import enTranslation from './locales/en.json';

// This function will dynamically import language files when needed
const loadLanguageAsync = async (lang: string) => {
  try {
    const module = await import(`./locales/${lang}.json`);
    return module.default;
  } catch (error) {
    console.error(`Failed to load language file for ${lang}:`, error);
    // Fallback to English if loading fails
    return enTranslation;
  }
};

// Initialize i18next
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        translation: enTranslation,
      },
    },
    fallbackLng: 'en',
    debug: false,
    interpolation: {
      escapeValue: false, // React already safes from XSS
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
  });

// Function to change language with dynamic import
export const changeLanguage = async (lng: string) => {
  if (i18n.hasResourceBundle(lng, 'translation')) {
    return i18n.changeLanguage(lng);
  }

  try {
    const translations = await loadLanguageAsync(lng);
    i18n.addResourceBundle(lng, 'translation', translations);
    return i18n.changeLanguage(lng);
  } catch (error) {
    console.error(`Failed to change language to ${lng}:`, error);
    return i18n.changeLanguage('en'); // Fallback to English
  }
};

export default i18n;
