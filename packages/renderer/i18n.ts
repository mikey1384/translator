import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enTranslation from './locales/en.json';
import koTranslation from './locales/ko.json';
import jaTranslation from './locales/ja.json';
import msTranslation from './locales/ms.json';
import plTranslation from './locales/pl.json';
import zhCNTranslation from './locales/zh-CN.json';
import zhTWTranslation from './locales/zh-TW.json';
import esTranslation from './locales/es.json';
import frTranslation from './locales/fr.json';
import deTranslation from './locales/de.json';
import itTranslation from './locales/it.json';
import ptTranslation from './locales/pt.json';
import ruTranslation from './locales/ru.json';
import nlTranslation from './locales/nl.json';
import svTranslation from './locales/sv.json';
import trTranslation from './locales/tr.json';
import noTranslation from './locales/no.json';
import daTranslation from './locales/da.json';
import fiTranslation from './locales/fi.json';
import elTranslation from './locales/el.json';
import csTranslation from './locales/cs.json';
import huTranslation from './locales/hu.json';
import roTranslation from './locales/ro.json';
import ukTranslation from './locales/uk.json';
import hiTranslation from './locales/hi.json';
import idTranslation from './locales/id.json';
import thTranslation from './locales/th.json';
import tlTranslation from './locales/tl.json';
import bnTranslation from './locales/bn.json';
import taTranslation from './locales/ta.json';
import teTranslation from './locales/te.json';
import mrTranslation from './locales/mr.json';
import urTranslation from './locales/ur.json';
import arTranslation from './locales/ar.json';
import heTranslation from './locales/he.json';
import faTranslation from './locales/fa.json';
import swTranslation from './locales/sw.json';
import afTranslation from './locales/af.json';
import viTranslation from './locales/vi.json';

import * as SystemIPC from '@ipc/system';

const LS_KEY = 'app_language_preference';

// Languages bundled in this build (keys must match resource keys below)
const SUPPORTED_LANGS = new Set([
  'en',
  'ko',
  'ja',
  'ms',
  'pl',
  'zh-CN',
  'zh-TW',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'ru',
  'nl',
  'sv',
  'tr',
  'no',
  'da',
  'fi',
  'el',
  'cs',
  'hu',
  'ro',
  'uk',
  'hi',
  'id',
  'th',
  'tl',
  'bn',
  'ta',
  'te',
  'mr',
  'ur',
  'ar',
  'he',
  'fa',
  'sw',
  'af',
  'vi',
]);

function normalizeBrowserLang(input: string | null | undefined): string {
  const raw = (input || 'en').replace('_', '-').trim();
  const ln = raw.toLowerCase();
  // Prefer exact match when we have it (case-sensitive keys later)
  const exactCandidates = [
    raw, // keep original casing first
    raw.toLowerCase(),
    raw.toUpperCase(),
    // common normalized case like en-US
    raw
      .split('-')
      .map((p, i) => (i === 0 ? p.toLowerCase() : p.toUpperCase()))
      .join('-'),
  ];
  for (const c of exactCandidates) {
    if (SUPPORTED_LANGS.has(c as any)) return c;
  }
  // Special-case Chinese
  if (ln.startsWith('zh')) {
    if (
      ln.includes('tw') ||
      ln.includes('hk') ||
      ln.includes('mo') ||
      ln.includes('hant')
    )
      return 'zh-TW';
    return 'zh-CN';
  }
  // Fallback to base language if supported
  const base = ln.split('-')[0] || 'en';
  if (SUPPORTED_LANGS.has(base)) return base;
  return 'en';
}

const getInitialLanguage = async (): Promise<string> => {
  try {
    const storedLang = await SystemIPC.getLanguagePreference();
    if (storedLang) {
      console.log(
        `[i18n] Retrieved language from Electron store: ${storedLang}`
      );
      // If main returned a Chinese base like 'zh', map to zh-CN/zh-TW
      return normalizeBrowserLang(storedLang);
    }
    const storedLangLS = localStorage.getItem(LS_KEY);
    if (storedLangLS) {
      console.log(
        `[i18n] Retrieved language from localStorage fallback: ${storedLangLS}`
      );
      return normalizeBrowserLang(storedLangLS);
    }
  } catch (error) {
    console.error('[i18n] Error retrieving initial language:', error);
  }

  const picked = normalizeBrowserLang(navigator.language || 'en');
  console.log(`[i18n] Using default language: ${picked}`);
  return picked;
};

const initI18nPromise = (async () => {
  const initialLanguage = await getInitialLanguage();
  console.log(`[i18n] Setting initial language to: ${initialLanguage}`);

  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: enTranslation },
      ko: { translation: koTranslation },
      ja: { translation: jaTranslation },
      ms: { translation: msTranslation },
      pl: { translation: plTranslation },
      'zh-CN': { translation: zhCNTranslation },
      'zh-TW': { translation: zhTWTranslation },
      es: { translation: esTranslation },
      fr: { translation: frTranslation },
      de: { translation: deTranslation },
      it: { translation: itTranslation },
      pt: { translation: ptTranslation },
      ru: { translation: ruTranslation },
      nl: { translation: nlTranslation },
      sv: { translation: svTranslation },
      tr: { translation: trTranslation },
      no: { translation: noTranslation },
      da: { translation: daTranslation },
      fi: { translation: fiTranslation },
      el: { translation: elTranslation },
      cs: { translation: csTranslation },
      hu: { translation: huTranslation },
      ro: { translation: roTranslation },
      uk: { translation: ukTranslation },
      hi: { translation: hiTranslation },
      id: { translation: idTranslation },
      th: { translation: thTranslation },
      tl: { translation: tlTranslation },
      bn: { translation: bnTranslation },
      ta: { translation: taTranslation },
      te: { translation: teTranslation },
      mr: { translation: mrTranslation },
      ur: { translation: urTranslation },
      ar: { translation: arTranslation },
      he: { translation: heTranslation },
      fa: { translation: faTranslation },
      sw: { translation: swTranslation },
      af: { translation: afTranslation },
      vi: { translation: viTranslation },
    },
    lng: initialLanguage,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

  return i18n;
})();

initI18nPromise.catch(err => {
  console.error('[i18n] Failed to initialize i18n:', err);
});

export const changeLanguage = async (lng: string) => {
  console.log(`[i18n] changeLanguage called for: ${lng}`);

  try {
    await SystemIPC.setLanguagePreference(lng);
    console.log(`[i18n] Saved language preference via Electron store: ${lng}`);
    localStorage.setItem(LS_KEY, lng);

    if (i18n.hasResourceBundle(lng, 'translation')) {
      console.log(
        `[i18n] Bundle for ${lng} already exists. Changing language.`
      );
      return i18n.changeLanguage(lng);
    }

    console.warn(
      `[i18n] Language ${lng} not found in resources. Falling back to English.`
    );
    return i18n.changeLanguage('en');
  } catch (error) {
    console.error(`[i18n] Error in changeLanguage for ${lng}:`, error);
    return i18n.changeLanguage('en');
  }
};

export { i18n };
export default initI18nPromise;
