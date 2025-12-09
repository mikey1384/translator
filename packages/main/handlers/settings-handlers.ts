import { app } from 'electron';
import * as fsPromises from 'fs/promises';
import log from 'electron-log';
import path from 'path';
import { pathToFileURL } from 'url';
import type Store from 'electron-store';
import { browserCookiesAvailable } from '../services/url-processor/utils.js';
import {
  encryptString,
  decryptString,
  isEncrypted,
  isEncryptionAvailable,
  isV2Encrypted,
} from '../services/secure-storage.js';

/* ----------------------------------------------------------
 * Types
 * -------------------------------------------------------- */

/**
 * All BYO-related settings returned in a single batched call
 * NOTE: Keys are NOT decrypted here to avoid Keychain prompts on startup.
 * Only presence is checked. Decryption happens lazily in ai-provider.ts when needed.
 */
export interface AllByoSettings {
  // API key presence flags (NOT decrypted values - avoids Keychain prompt)
  openAiKeyPresent: boolean;
  anthropicKeyPresent: boolean;
  elevenLabsKeyPresent: boolean;
  // Individual provider toggles
  useByoOpenAi: boolean;
  useByoAnthropic: boolean;
  useByoElevenLabs: boolean;
  // Master toggle
  useByoMaster: boolean;
  // Claude preferences
  preferClaudeTranslation: boolean;
  preferClaudeReview: boolean;
  preferClaudeSummary: boolean;
  // Provider preferences
  preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5';
  preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5';
  stage5DubbingTtsProvider: 'openai' | 'elevenlabs';
}

export type SettingsStoreType = Store<{
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  anthropicApiKey: string | null;
  elevenLabsApiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
  byoOpenAiUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  useByoOpenAi: boolean;
  useByoAnthropic: boolean;
  useByoElevenLabs: boolean;
  useByoMaster: boolean; // Master toggle to enable/disable all BYO keys at once
  preferClaudeTranslation: boolean; // When true, use Claude (Sonnet) for draft instead of GPT
  preferClaudeReview: boolean; // When true (default), use Claude Opus for review; false = GPT-5.1 with high reasoning
  preferClaudeSummary: boolean; // When true (default), use Claude Opus for video summary
  preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5'; // Which provider to use for transcription
  preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5'; // Which provider to use for dubbing/TTS
  stage5DubbingTtsProvider: 'openai' | 'elevenlabs'; // TTS provider when using Stage5 API for dubbing
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
      const stored = store.get('apiKey', null);
      if (typeof stored !== 'string' || stored.length === 0) return null;
      // Only encrypted values are supported - silently clear legacy values
      if (!isEncrypted(stored)) {
        store.set('apiKey', null);
        return null;
      }
      return decryptString(stored) || null;
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
      // Encrypt before storing
      const encrypted = encryptString(trimmed);
      store.set('apiKey', encrypted);
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
      const stored = store.get('anthropicApiKey', null);
      if (typeof stored !== 'string' || stored.length === 0) return null;
      // Only encrypted values are supported - silently clear legacy values
      if (!isEncrypted(stored)) {
        store.set('anthropicApiKey', null);
        return null;
      }
      return decryptString(stored) || null;
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
      // Encrypt before storing
      const encrypted = encryptString(trimmed);
      store.set('anthropicApiKey', encrypted);
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

  /* ─────────── ElevenLabs API key ─────────── */
  function getElevenLabsApiKey(): string | null {
    try {
      const stored = store.get('elevenLabsApiKey', null);
      if (typeof stored !== 'string' || stored.length === 0) return null;
      // Only encrypted values are supported - silently clear legacy values
      if (!isEncrypted(stored)) {
        store.set('elevenLabsApiKey', null);
        return null;
      }
      return decryptString(stored) || null;
    } catch (err) {
      log.error('[settings] Failed to read stored ElevenLabs API key:', err);
      return null;
    }
  }

  async function setElevenLabsApiKey(
    _evt: any,
    apiKey: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (typeof apiKey !== 'string' || !apiKey.trim()) {
        store.set('elevenLabsApiKey', null);
        return { success: true };
      }
      const trimmed = apiKey.trim();
      // Encrypt before storing
      const encrypted = encryptString(trimmed);
      store.set('elevenLabsApiKey', encrypted);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist ElevenLabs API key:', err);
      return { success: false, error: err?.message || 'Failed to save key' };
    }
  }

  async function clearElevenLabsApiKey(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      store.set('elevenLabsApiKey', null);
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to clear ElevenLabs API key:', err);
      return { success: false, error: err?.message || 'Failed to clear key' };
    }
  }

  function getUseByoElevenLabs(): boolean {
    try {
      return Boolean(store.get('useByoElevenLabs', false));
    } catch (err) {
      log.error('[settings] Failed to read BYO ElevenLabs toggle:', err);
      return false;
    }
  }

  function setUseByoElevenLabs(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('useByoElevenLabs', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist BYO ElevenLabs toggle:', err);
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

  /* ─────────── Master BYO toggle ─────────── */
  function getUseByoMaster(): boolean {
    try {
      // Default to false - user must explicitly enable BYO after entering keys
      return Boolean(store.get('useByoMaster', false));
    } catch (err) {
      log.error('[settings] Failed to read BYO master toggle:', err);
      return false;
    }
  }

  function setUseByoMaster(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('useByoMaster', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist BYO master toggle:', err);
      return { success: false, error: err?.message || 'Failed to save toggle' };
    }
  }

  /* ─────────── Claude translation preference ─────────── */
  function getPreferClaudeTranslation(): boolean {
    try {
      // Default to false (use GPT for draft, which is cheaper)
      return Boolean(store.get('preferClaudeTranslation', false));
    } catch (err) {
      log.error(
        '[settings] Failed to read Claude translation preference:',
        err
      );
      return false;
    }
  }

  function setPreferClaudeTranslation(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('preferClaudeTranslation', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error(
        '[settings] Failed to persist Claude translation preference:',
        err
      );
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Claude review preference ─────────── */
  function getPreferClaudeReview(): boolean {
    try {
      // Default to true (use Claude Opus for review, which is higher quality)
      return Boolean(store.get('preferClaudeReview', true));
    } catch (err) {
      log.error('[settings] Failed to read Claude review preference:', err);
      return true;
    }
  }

  function setPreferClaudeReview(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('preferClaudeReview', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist Claude review preference:', err);
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Claude summary preference ─────────── */
  function getPreferClaudeSummary(): boolean {
    try {
      // Default to true (use Claude Opus for summary, which is higher quality)
      return Boolean(store.get('preferClaudeSummary', true));
    } catch (err) {
      log.error('[settings] Failed to read Claude summary preference:', err);
      return true;
    }
  }

  function setPreferClaudeSummary(value: boolean): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('preferClaudeSummary', Boolean(value));
      return { success: true };
    } catch (err: any) {
      log.error('[settings] Failed to persist Claude summary preference:', err);
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Transcription provider preference ─────────── */
  function getPreferredTranscriptionProvider():
    | 'elevenlabs'
    | 'openai'
    | 'stage5' {
    try {
      const value = store.get('preferredTranscriptionProvider', 'elevenlabs');
      log.info(
        `[settings] getPreferredTranscriptionProvider: stored="${value}"`
      );
      if (value === 'elevenlabs' || value === 'openai' || value === 'stage5') {
        return value;
      }
      return 'elevenlabs'; // Default to ElevenLabs (highest quality)
    } catch (err) {
      log.error(
        '[settings] Failed to read transcription provider preference:',
        err
      );
      return 'elevenlabs';
    }
  }

  function setPreferredTranscriptionProvider(
    value: 'elevenlabs' | 'openai' | 'stage5'
  ): { success: boolean; error?: string } {
    try {
      log.info(
        `[settings] setPreferredTranscriptionProvider: saving "${value}"`
      );
      store.set('preferredTranscriptionProvider', value);
      log.info(`[settings] setPreferredTranscriptionProvider: saved OK`);
      return { success: true };
    } catch (err: any) {
      log.error(
        '[settings] Failed to persist transcription provider preference:',
        err
      );
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Dubbing provider preference ─────────── */
  function getPreferredDubbingProvider(): 'elevenlabs' | 'openai' | 'stage5' {
    try {
      const value = store.get('preferredDubbingProvider', 'openai');
      if (value === 'elevenlabs' || value === 'openai' || value === 'stage5') {
        return value;
      }
      return 'openai'; // Default to OpenAI TTS (cheaper)
    } catch (err) {
      log.error('[settings] Failed to read dubbing provider preference:', err);
      return 'openai';
    }
  }

  function setPreferredDubbingProvider(
    value: 'elevenlabs' | 'openai' | 'stage5'
  ): { success: boolean; error?: string } {
    try {
      store.set('preferredDubbingProvider', value);
      return { success: true };
    } catch (err: any) {
      log.error(
        '[settings] Failed to persist dubbing provider preference:',
        err
      );
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Stage5 dubbing TTS provider ─────────── */
  function getStage5DubbingTtsProvider(): 'openai' | 'elevenlabs' {
    try {
      const value = store.get('stage5DubbingTtsProvider', 'openai');
      if (value === 'openai' || value === 'elevenlabs') {
        return value;
      }
      return 'openai'; // Default to OpenAI (cheaper)
    } catch (err) {
      log.error('[settings] Failed to read stage5 dubbing TTS provider:', err);
      return 'openai';
    }
  }

  function setStage5DubbingTtsProvider(value: 'openai' | 'elevenlabs'): {
    success: boolean;
    error?: string;
  } {
    try {
      store.set('stage5DubbingTtsProvider', value);
      return { success: true };
    } catch (err: any) {
      log.error(
        '[settings] Failed to persist stage5 dubbing TTS provider:',
        err
      );
      return {
        success: false,
        error: err?.message || 'Failed to save preference',
      };
    }
  }

  /* ─────────── Check if API key is present (without decrypting) ─────────── */
  /**
   * Check if an encrypted API key is stored WITHOUT decrypting it.
   * Only returns true for v2 encrypted keys (app-level encryption).
   * Legacy v1 keys (Keychain-based) are treated as not present.
   */
  function hasApiKeyStored(): boolean {
    try {
      const stored = store.get('apiKey', null);
      return (
        typeof stored === 'string' && stored.length > 0 && isV2Encrypted(stored)
      );
    } catch (err) {
      log.error('[settings] Failed to check if API key is stored:', err);
      return false;
    }
  }

  function hasAnthropicApiKeyStored(): boolean {
    try {
      const stored = store.get('anthropicApiKey', null);
      return (
        typeof stored === 'string' &&
        stored.length > 0 &&
        isV2Encrypted(stored)
      );
    } catch (err) {
      log.error(
        '[settings] Failed to check if Anthropic API key is stored:',
        err
      );
      return false;
    }
  }

  function hasElevenLabsApiKeyStored(): boolean {
    try {
      const stored = store.get('elevenLabsApiKey', null);
      return (
        typeof stored === 'string' &&
        stored.length > 0 &&
        isV2Encrypted(stored)
      );
    } catch (err) {
      log.error(
        '[settings] Failed to check if ElevenLabs API key is stored:',
        err
      );
      return false;
    }
  }

  /* ─────────── Get all BYO settings in single call ─────────── */
  /**
   * Get all BYO settings for the renderer.
   * NOTE: Does NOT decrypt API keys - only checks presence to avoid Keychain prompts.
   * Actual key decryption happens lazily in ai-provider.ts when making API calls.
   */
  function getAllByoSettings(): AllByoSettings {
    return {
      // API key presence (NOT decrypted - avoids Keychain prompt on startup)
      openAiKeyPresent: hasApiKeyStored(),
      anthropicKeyPresent: hasAnthropicApiKeyStored(),
      elevenLabsKeyPresent: hasElevenLabsApiKeyStored(),
      // Individual toggles
      useByoOpenAi: getUseByoOpenAi(),
      useByoAnthropic: getUseByoAnthropic(),
      useByoElevenLabs: getUseByoElevenLabs(),
      // Master toggle
      useByoMaster: getUseByoMaster(),
      // Claude preferences
      preferClaudeTranslation: getPreferClaudeTranslation(),
      preferClaudeReview: getPreferClaudeReview(),
      preferClaudeSummary: getPreferClaudeSummary(),
      // Provider preferences
      preferredTranscriptionProvider: getPreferredTranscriptionProvider(),
      preferredDubbingProvider: getPreferredDubbingProvider(),
      stage5DubbingTtsProvider: getStage5DubbingTtsProvider(),
    };
  }

  /* ─────────── Migration: Handle legacy API key formats ─────────── */
  async function migrateApiKeysToEncrypted(): Promise<void> {
    const keysToMigrate = [
      { key: 'apiKey', name: 'OpenAI' },
      { key: 'anthropicApiKey', name: 'Anthropic' },
      { key: 'elevenLabsApiKey', name: 'ElevenLabs' },
    ] as const;

    for (const { key, name } of keysToMigrate) {
      try {
        const stored = store.get(key, null);
        if (
          typeof stored === 'string' &&
          stored.length > 0 &&
          !isEncrypted(stored)
        ) {
          // Legacy key format found - upgrade or clear
          if (!isEncryptionAvailable()) {
            // Encryption not available - clear key (user will need to re-enter)
            store.set(key, null);
          } else {
            // Upgrade key format
            const encrypted = encryptString(stored);
            store.set(key, encrypted);
            log.info(`[settings] Upgraded ${name} API key storage format`);
          }
        }
      } catch (err) {
        log.error(`[settings] Failed to upgrade ${name} API key format:`, err);
        // Clear the key if upgrade fails (user will need to re-enter)
        store.set(key, null);
      }
    }
  }

  /* ─────────── Check encryption availability ─────────── */
  function checkEncryptionAvailable(): boolean {
    return isEncryptionAvailable();
  }

  /* ------------------------------------------------ */
  return {
    checkEncryptionAvailable,
    getAllByoSettings,
    migrateApiKeysToEncrypted,
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
    getElevenLabsApiKey,
    setElevenLabsApiKey,
    clearElevenLabsApiKey,
    getUseByoElevenLabs,
    setUseByoElevenLabs,
    getUseByoMaster,
    setUseByoMaster,
    getPreferClaudeTranslation,
    setPreferClaudeTranslation,
    getPreferClaudeReview,
    setPreferClaudeReview,
    getPreferClaudeSummary,
    setPreferClaudeSummary,
    getPreferredTranscriptionProvider,
    setPreferredTranscriptionProvider,
    getPreferredDubbingProvider,
    setPreferredDubbingProvider,
    getStage5DubbingTtsProvider,
    setStage5DubbingTtsProvider,
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
