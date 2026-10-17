import { app } from 'electron';
import log from 'electron-log';
import { settingsStore } from '../store/settings-store.js';
import { getMainT } from './i18n.js';

export type MainT = Awaited<ReturnType<typeof getMainT>>;

const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);

export function isRtlLanguage(lang: string): boolean {
  return RTL_LANGUAGES.has(
    String(lang || 'en')
      .split('-')[0]
      .toLowerCase()
  );
}

/**
 * The app's UI language as main-process surfaces (menus, native dialogs,
 * the tab strip) should speak it: the saved preference, else the system
 * language, mapped the same way the renderer maps it.
 */
export function getUiLanguage(): string {
  try {
    const saved = settingsStore.get('app_language_preference');
    if (typeof saved === 'string' && saved.trim()) return saved.trim();
  } catch {
    // fall through to the system language
  }
  const raw = (
    app.getPreferredSystemLanguages?.()[0] ||
    app.getLocale?.() ||
    'en'
  )
    .replace('_', '-')
    .trim();
  const ln = raw.toLowerCase();
  if (ln.startsWith('zh')) {
    return /tw|hk|mo|hant/.test(ln) ? 'zh-TW' : 'zh-CN';
  }
  return ln.split('-')[0] || 'en';
}

let lastUiT: MainT | null = null;

/** A translator for the current UI language (reads the renderer locales). */
export async function getUiT(): Promise<MainT> {
  const t = await getMainT(getUiLanguage());
  lastUiT = t;
  return t;
}

/**
 * Synchronous text for places that can't wait for the locale files, like
 * the crash dialogs shown right before quitting: the last loaded UI
 * language (the menu loads it at startup and on every switch), else English.
 */
export function uiTextNow(
  key: string,
  defaultValue: string,
  vars?: Record<string, string | number | null | undefined>
): string {
  if (lastUiT) return lastUiT(key, vars, defaultValue);
  return defaultValue.replace(/\{\{(\w+)\}\}/g, (_m, name) =>
    String(vars?.[name] ?? '')
  );
}

type Listener = (lang: string) => void;
const listeners = new Set<Listener>();

export function onUiLanguageChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyUiLanguageChanged(lang: string): void {
  for (const listener of listeners) {
    try {
      listener(lang);
    } catch (err) {
      log.warn('[ui-language] listener failed:', err);
    }
  }
}
