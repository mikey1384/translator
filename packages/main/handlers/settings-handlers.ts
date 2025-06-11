import { app } from 'electron';
import * as fsPromises from 'fs/promises';
import log from 'electron-log';
import path from 'path';
import { pathToFileURL } from 'url';
import type Store from 'electron-store';

/* ----------------------------------------------------------
 * Types
 * -------------------------------------------------------- */
export type SettingsStoreType = Store<{
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
}>;

/* ----------------------------------------------------------
 * A single factory that returns IPC-ready handlers.
 * No extra "initialize…" call needed.
 * -------------------------------------------------------- */
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
    if (store.has('app_language_preference')) {
      return store.get('app_language_preference', 'en');
    }
    const sysLocale = (
      app.getPreferredSystemLanguages?.()[0] ??
      app.getLocale() ??
      'en'
    )
      .split('-')[0]
      .toLowerCase();

    return sysLocale || 'en';
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

  /* ------------------------------------------------ */
  return {
    getLocaleUrl,
    getLanguagePreference,
    setLanguagePreference,
    getSubtitleTargetLanguage,
    setSubtitleTargetLanguage,
    saveVideoPlaybackPosition,
    getVideoPlaybackPosition,
  };
}
