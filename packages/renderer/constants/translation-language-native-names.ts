import { TRANSLATION_LANGUAGE_GROUPS } from './translation-languages';

// Each output language in its own script, so people recognize theirs in any
// UI language. Keys are the pipeline values in translation-languages.ts.
export const TRANSLATION_LANGUAGE_NATIVE_NAMES: Record<string, string> = {
  english: 'English',
  korean: '한국어',
  japanese: '日本語',
  chinese_simplified: '简体中文',
  chinese_traditional: '繁體中文',
  vietnamese: 'Tiếng Việt',
  spanish: 'Español',
  french: 'Français',
  german: 'Deutsch',
  italian: 'Italiano',
  portuguese: 'Português',
  russian: 'Русский',
  dutch: 'Nederlands',
  polish: 'Polski',
  swedish: 'Svenska',
  turkish: 'Türkçe',
  norwegian: 'Norsk',
  danish: 'Dansk',
  finnish: 'Suomi',
  greek: 'Ελληνικά',
  czech: 'Čeština',
  hungarian: 'Magyar',
  romanian: 'Română',
  ukrainian: 'Українська',
  hindi: 'हिन्दी',
  indonesian: 'Bahasa Indonesia',
  thai: 'ไทย',
  malay: 'Bahasa Melayu',
  tagalog: 'Tagalog',
  bengali: 'বাংলা',
  tamil: 'தமிழ்',
  telugu: 'తెలుగు',
  marathi: 'मराठी',
  urdu: 'اردو',
  arabic: 'العربية',
  hebrew: 'עברית',
  farsi: 'فارسی',
  swahili: 'Kiswahili',
  afrikaans: 'Afrikaans',
};

export function nativeLanguageName(value: string): string {
  return TRANSLATION_LANGUAGE_NATIVE_NAMES[value] ?? value;
}

/** Every distinct output language value, in group order. */
export function allTranslationLanguageValues(): string[] {
  const seen = new Set<string>(['english']);
  for (const group of TRANSLATION_LANGUAGE_GROUPS) {
    for (const option of group.options) seen.add(option.value);
  }
  return [...seen];
}

const RECENT_TARGETS_KEY = 'recentTargetLanguages';
const MAX_RECENT_TARGETS = 6;

export function readRecentTargetLanguages(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_TARGETS_KEY) || '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (value): value is string =>
            typeof value === 'string' &&
            value in TRANSLATION_LANGUAGE_NATIVE_NAMES
        )
      : [];
  } catch {
    return [];
  }
}

export function rememberRecentTargetLanguage(value: string): void {
  if (!(value in TRANSLATION_LANGUAGE_NATIVE_NAMES)) return;
  const next = [
    value,
    ...readRecentTargetLanguages().filter(item => item !== value),
  ].slice(0, MAX_RECENT_TARGETS);
  try {
    localStorage.setItem(RECENT_TARGETS_KEY, JSON.stringify(next));
  } catch {
    // Recent languages are a convenience; ignore storage failures.
  }
}

/**
 * Up to three quick-pick languages: the current choice, the UI language's
 * match, then recently used ones.
 */
export function quickPickTargetLanguages({
  current,
  uiLanguageTarget,
  recent,
}: {
  current: string;
  uiLanguageTarget: string;
  recent: string[];
}): string[] {
  const picks: string[] = [];
  for (const value of [current, uiLanguageTarget, ...recent]) {
    if (
      value &&
      value !== 'original' &&
      value in TRANSLATION_LANGUAGE_NATIVE_NAMES &&
      !picks.includes(value)
    ) {
      picks.push(value);
    }
    if (picks.length === 3) break;
  }
  return picks;
}
