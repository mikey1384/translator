import { app } from 'electron';
import * as fsPromises from 'fs/promises';
import log from 'electron-log';
import path from 'path';
import { pathToFileURL } from 'url';
import type Store from 'electron-store';
import { browserCookiesAvailable } from '../services/url-processor/utils.js';

/* ----------------------------------------------------------
 * Types
 * -------------------------------------------------------- */
export type SettingsStoreType = Store<{
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  anthropicApiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
  byoOpenAiUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  useByoOpenAi: boolean;
  useByoAnthropic: boolean;
  preferredCookiesBrowser?: string; // 'chrome' | 'safari' | 'firefox' | 'edge' | 'chromium'
}>;

export function buildSettingsHandlers(opts: {
  store: SettingsStoreType;
  isDev: boolean;
}) {
  const { store, isDev } = opts;

  /* ─────────── get-locale-url ─────────── */
  async function getLocaleUrl(_evt: any, lang: string): Promise<string | null> {
    try {
      const localeDirPath = isDev
        ? path.join(app.getAppPath(), '..', 'src', 'renderer', 'locales')
        : path.join(
            app.getAppPath(),
            'packages',
            'renderer',
            'dist',
            'locales'
          );

      const localePath = path.join(localeDirPath, `${lang}.json`);
      const localeUrl = pathToFileURL(localePath).toString();

      await fsPromises.access(localePath, fsPromises.constants.R_OK);
      log.info(`[settings] Using locale file: ${localePath}`);
      return localeUrl;
    } catch (err: any) {
      log.error('[settings] Cannot access locale file:', err);
      return null;
    }
  }

  /* ─────────── language preference ─────────── */
  function getLanguagePreference() {
    // 1) Respect saved preference
    if (store.has('app_language_preference')) {
      return store.get('app_language_preference', 'en');
    }

    // 2) Detect system locale (keep region)
    const raw = (
      app.getPreferredSystemLanguages?.()[0] ||
      app.getLocale() ||
      'en'
    )
      .replace('_', '-')
      .trim();
    const ln = raw.toLowerCase();

    // 3) Special handling for Chinese so we don't lose the script/region
    if (ln.startsWith('zh')) {
      // Map traditional locales to zh-TW; default to zh-CN otherwise
      if (
        ln.includes('tw') ||
        ln.includes('hk') ||
        ln.includes('mo') ||
        ln.includes('hant')
      ) {
        return 'zh-TW';
      }
      return 'zh-CN';
    }

    // 4) Fall back to base language (en, es, fr, etc.)
    const base = ln.split('-')[0];
    // Capitalization for i18n keys isn't strictly needed here (renderer normalizes),
    // but we keep the simple base code for non-Chinese languages.
    return base || 'en';
  }

  async function setLanguagePreference(
    _evt: any,
    lang: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      store.set('app_language_preference', lang);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /* ─────────── subtitle target language ─────────── */
  async function getSubtitleTargetLanguage() {
    return store.get('subtitleTargetLanguage', 'original');
  }

  async function setSubtitleTargetLanguage(
    _evt: any,
    lang: string
  ): Promise<{ success: boolean; error?: string }> {
    if (typeof lang !== 'string') {
      return { success: false, error: 'Invalid language type' };
    }
    try {
      store.set('subtitleTargetLanguage', lang);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /* ─────────── video playback positions ─────────── */
  function saveVideoPlaybackPosition(
    _evt: any,
    filePath: string,
    position: number
  ) {
    if (!filePath || position < 0) return;
    const current = store.get('videoPlaybackPositions', {}) as Record<
      string,
      number
    >;
    store.set('videoPlaybackPositions', { ...current, [filePath]: position });
  }

  async function getVideoPlaybackPosition(
    _evt: any,
    filePath: string
  ): Promise<number | null> {
    if (!filePath) return null;
    const current = store.get('videoPlaybackPositions', {}) as Record<
      string,
      number
    >;
    const pos = current[filePath];
    return typeof pos === 'number' && pos >= 0 ? pos : null;
  }

  function getApiKey(): string | null {
    try {
      const key = store.get('apiKey', null);
      return typeof key === 'string' && key.length > 0 ? key : null;
    } catch (err) {
      log.error('[settings] Failed to read stored API key:', err);
      return null;
    }
  }

  async function setApiKey(
    _evt: any,
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        store.set('apiKey', null);
        return { success: true };
      }
      const trimmed = apiKey.trim();
      store.set('apiKey', trimmed);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist API key:', err);
      return { success: false, error: err?.message || 'Failed to save key' };
    }
  }

  async function clearApiKey(): Promise<{ success: boolean; error?: string }> {
    try {
      store.set('apiKey', null);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to clear API key:', err);
      return { success: false, error: err?.message || 'Failed to clear key' };
    }
  }

  /* ─────────── Anthropic API key ─────────── */
  function getAnthropicApiKey(): string | null {
    try {
      const key = store.get('anthropicApiKey', null);
      return typeof key === 'string' && key.length > 0 ? key : null;
    } catch (err) {
      log.error('[settings] Failed to read stored Anthropic API key:', err);
      return null;
    }
  }

  async function setAnthropicApiKey(
    _evt: any,
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        store.set('anthropicApiKey', null);
        return { success: true };
      }
      const trimmed = apiKey.trim();
      store.set('anthropicApiKey', trimmed);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist Anthropic API key:', err);
      return { success: false, error: err?.message || 'Failed to save key' };
    }
  }

  async function clearAnthropicApiKey(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      store.set('anthropicApiKey', null);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to clear Anthropic API key:', err);
      return { success: false, error: err?.message || 'Failed to clear key' };
    }
  }

  function getUseByoAnthropic(): boolean {
    try {
      return Boolean(store.get('useByoAnthropic', false));
    } catch (err) {
      log.error('[settings] Failed to read BYO Anthropic toggle:', err);
      return false;
    }
  }

  function setUseByoAnthropic(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('useByoAnthropic', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist BYO Anthropic toggle:', err);
      return { success: false, error: err?.message || 'Failed to save toggle' };
    }
  }

  function getUseByoOpenAi(): boolean {
    try {
      return Boolean(store.get('useByoOpenAi', false));
    } catch (err) {
      log.error('[settings] Failed to read BYO toggle:', err);
      return false;
    }
  }

  function setUseByoOpenAi(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('useByoOpenAi', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist BYO toggle:', err);
      return { success: false, error: err?.message || 'Failed to save toggle' };
    }
  }

  /* ------------------------------------------------ */
  return {
    getLocaleUrl,
    getLanguagePreference,
    setLanguagePreference,
    getSubtitleTargetLanguage,
    setSubtitleTargetLanguage,
    saveVideoPlaybackPosition,
    getVideoPlaybackPosition,
    getApiKey,
    setApiKey,
    clearApiKey,
    getAnthropicApiKey,
    setAnthropicApiKey,
    clearAnthropicApiKey,
    getUseByoOpenAi,
    setUseByoOpenAi,
    getUseByoAnthropic,
    setUseByoAnthropic,
    // yt-dlp auto update is always on

    // Persisted cookie browser preference
    getPreferredCookiesBrowser: () => {
      const stored =
        (store.get('preferredCookiesBrowser') as string | undefined) || '';
      if (stored && !browserCookiesAvailable(stored)) {
        log.warn(
          `[settings] Stored cookie browser '${stored}' no longer available; clearing preference.`
        );
        store.delete('preferredCookiesBrowser');
        return '';
      }
      return stored;
    },
    setPreferredCookiesBrowser: (_evt: any, v: string) => {
      try {
        if (typeof v !== 'string') throw new Error('Invalid browser value');
        if (!v || v === 'auto') {
          store.delete('preferredCookiesBrowser');
          return { success: true };
        }
        if (!browserCookiesAvailable(v)) {
          throw new Error(
            'Selected browser cookies not found on this system. Open YouTube in that browser once or pick another.'
          );
        }
        store.set('preferredCookiesBrowser', v);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  };
}
