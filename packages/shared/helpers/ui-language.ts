/**
 * The interface languages bundled with the app, and how a system or stored
 * language tag maps onto them. Shared by main (first launch, menus, checkout
 * locale) and the renderer (i18n) so both pick the same language.
 */
export const SUPPORTED_UI_LANGUAGES = [
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
] as const;

export type SupportedUiLanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];

const SUPPORTED = new Set<string>(SUPPORTED_UI_LANGUAGES);

// System tags whose base differs from the bundle name.
const BASE_ALIASES: Record<string, SupportedUiLanguage> = {
  nb: 'no',
  nn: 'no',
  fil: 'tl',
  iw: 'he',
  in: 'id',
};

/** A supported UI language for a tag like "pt-BR", "zh_Hant_TW", "nb-NO"; null if none. */
export function matchSupportedUiLanguage(
  input: string | null | undefined
): SupportedUiLanguage | null {
  const raw = String(input || '')
    .replace(/_/g, '-')
    .trim();
  if (!raw) return null;
  const ln = raw.toLowerCase();
  if (ln.startsWith('zh')) {
    return /(^|-)(tw|hk|mo|hant)(-|$)/.test(ln) ? 'zh-TW' : 'zh-CN';
  }
  for (const candidate of SUPPORTED_UI_LANGUAGES) {
    if (candidate.toLowerCase() === ln) return candidate;
  }
  const base = ln.split('-')[0];
  if (SUPPORTED.has(base)) return base as SupportedUiLanguage;
  return BASE_ALIASES[base] ?? null;
}

/** Like matchSupportedUiLanguage, falling back to English. */
export function resolveSupportedUiLanguage(
  input: string | null | undefined
): SupportedUiLanguage {
  return matchSupportedUiLanguage(input) ?? 'en';
}

/**
 * The first of the system's preferred languages the app speaks (a Brazilian
 * Mac with ["pt-BR", "en-US"] gets Portuguese), else English.
 */
export function resolveSystemUiLanguage(
  preferred: ReadonlyArray<string | null | undefined>
): SupportedUiLanguage {
  for (const tag of preferred) {
    const match = matchSupportedUiLanguage(tag);
    if (match) return match;
  }
  return 'en';
}

type LanguageSettingsStore = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
};

export const APP_LANGUAGE_KEY = 'app_language_preference';
export const APP_LANGUAGE_EXPLICIT_KEY = 'app_language_explicit';

/**
 * Until 1.31, 'en' was a store default that conf wrote into every settings
 * file, so a new install never looked at the system language. A stored 'en'
 * that the user never explicitly chose is that default: drop it so the app
 * follows the system language. Any other stored language could only come
 * from the user's own pick, so mark it explicit. Idempotent.
 *
 * Trade-off: someone on a non-English system who deliberately picked
 * English before this version switches to the system language once; picking
 * English again in Settings marks it explicit and it then sticks.
 */
export function migrateUntouchedLanguageDefault(
  store: LanguageSettingsStore
): 'explicit' | 'follow-system' | 'unchanged' {
  if (store.get(APP_LANGUAGE_EXPLICIT_KEY) === true) return 'unchanged';
  const stored = store.get(APP_LANGUAGE_KEY);
  if (typeof stored !== 'string' || !stored.trim()) {
    return 'unchanged';
  }
  if (stored.trim() === 'en') {
    store.delete(APP_LANGUAGE_KEY);
    return 'follow-system';
  }
  store.set(APP_LANGUAGE_EXPLICIT_KEY, true);
  return 'explicit';
}

/** The UI language: the user's explicit choice, else the system's. */
export function resolveAppUiLanguage({
  stored,
  systemPreferred,
}: {
  stored: unknown;
  systemPreferred: ReadonlyArray<string | null | undefined>;
}): SupportedUiLanguage {
  if (typeof stored === 'string' && stored.trim()) {
    const match = matchSupportedUiLanguage(stored);
    if (match) return match;
  }
  return resolveSystemUiLanguage(systemPreferred);
}
