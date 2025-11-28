import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import * as stage5Client from './stage5-client.js';
import { getCachedEntitlements } from './entitlements-manager.js';
import {
  transcribeWithOpenAi,
  translateWithOpenAi,
  synthesizeDubWithOpenAi,
  testOpenAiApiKey,
} from './openai-client.js';
import {
  translateWithAnthropic,
  testAnthropicApiKey,
} from './anthropic-client.js';

export type ProviderKind = 'stage5' | 'openai' | 'anthropic';

function isClaudeModel(model: string | undefined): boolean {
  return Boolean(model && model.startsWith('claude-'));
}

type Stage5TranscribeOptions = Parameters<typeof stage5Client.transcribe>[0];
type Stage5TranslateOptions = Parameters<typeof stage5Client.translate>[0];
type Stage5DubOptions = Parameters<typeof stage5Client.synthesizeDub>[0];

type TestKeyResult = {
  ok: boolean;
  error?: string;
};

let settingsStoreRef: SettingsStoreType | null = null;

export function initAiProvider(settingsStore: SettingsStoreType) {
  settingsStoreRef = settingsStore;
}

function getStoredApiKey(): string | null {
  if (!settingsStoreRef) return null;
  const raw = settingsStoreRef.get('apiKey', null);
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

function getStoredAnthropicApiKey(): string | null {
  if (!settingsStoreRef) {
    log.warn('[ai-provider] settingsStoreRef is null when checking Anthropic key');
    return null;
  }
  const raw = settingsStoreRef.get('anthropicApiKey', null);
  log.debug('[ai-provider] getStoredAnthropicApiKey raw value:', raw ? `[${raw.length} chars]` : 'null');
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

function isByoAnthropicToggleEnabled(): boolean {
  if (!settingsStoreRef) return false;
  try {
    return Boolean(settingsStoreRef.get('useByoAnthropic', false));
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO Anthropic toggle state:', err);
    return false;
  }
}

function isByoToggleEnabled(): boolean {
  if (!settingsStoreRef) return false;
  try {
    return Boolean(settingsStoreRef.get('useByoOpenAi', false));
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO toggle state:', err);
    return false;
  }
}

function mapOpenAiError(error: any): never {
  const status = error?.response?.status;
  if (status === 401 || status === 403) {
    log.error('[ai-provider] OpenAI rejected request with auth error:', status);
    throw new Error('openai-key-invalid');
  }
  if (status === 429) {
    log.warn('[ai-provider] OpenAI rate limit hit.');
    throw new Error('openai-rate-limit');
  }
  throw error;
}

function mapAnthropicError(error: any): never {
  const status = error?.status || error?.response?.status;
  if (status === 401 || status === 403) {
    log.error(
      '[ai-provider] Anthropic rejected request with auth error:',
      status
    );
    throw new Error('anthropic-key-invalid');
  }
  if (status === 429) {
    log.warn('[ai-provider] Anthropic rate limit hit.');
    throw new Error('anthropic-rate-limit');
  }
  throw error;
}

export function hasUserApiKey(): boolean {
  return Boolean(getStoredApiKey());
}

export function hasUserAnthropicApiKey(): boolean {
  return Boolean(getStoredAnthropicApiKey());
}

export function getActiveProvider(): ProviderKind {
  const entitlements = getCachedEntitlements();
  if (entitlements.byoOpenAi && hasUserApiKey() && isByoToggleEnabled()) {
    return 'openai';
  }
  return 'stage5';
}

export function getActiveProviderForModel(model?: string): ProviderKind {
  const entitlements = getCachedEntitlements();

  // For Claude models, check Anthropic BYO key
  if (isClaudeModel(model)) {
    const hasKey = hasUserAnthropicApiKey();
    const toggleEnabled = isByoAnthropicToggleEnabled();
    log.debug(`[ai-provider] Claude model detected. byoAnthropic=${entitlements.byoAnthropic}, hasKey=${hasKey}, toggleEnabled=${toggleEnabled}`);
    if (entitlements.byoAnthropic && hasKey && toggleEnabled) {
      return 'anthropic';
    }
    return 'stage5'; // Stage5 will handle Claude via relay
  }

  // For OpenAI models
  if (entitlements.byoOpenAi && hasUserApiKey() && isByoToggleEnabled()) {
    return 'openai';
  }
  return 'stage5';
}

export function mustUseStage5(): boolean {
  return getActiveProvider() === 'stage5';
}

export async function transcribe(
  options: Stage5TranscribeOptions
): Promise<any> {
  if (getActiveProvider() !== 'openai') {
    return stage5Client.transcribe(options);
  }

  const apiKey = getStoredApiKey();
  if (!apiKey) {
    log.warn(
      '[ai-provider] OpenAI provider selected but API key missing. Falling back to Stage5.'
    );
    return stage5Client.transcribe(options);
  }

  const { filePath, promptContext, signal, model } =
    options as Stage5TranscribeOptions;
  log.debug('[ai-provider] Using OpenAI direct transcription.');
  try {
    return await transcribeWithOpenAi({
      filePath,
      promptContext,
      model,
      apiKey,
      signal,
    });
  } catch (error) {
    mapOpenAiError(error);
  }
}

export async function translate(options: Stage5TranslateOptions): Promise<any> {
  const { messages, model, signal, reasoning } = options as Stage5TranslateOptions;
  const provider = getActiveProviderForModel(model);

  // Handle Anthropic/Claude models with BYO key
  if (provider === 'anthropic') {
    const anthropicKey = getStoredAnthropicApiKey();
    if (!anthropicKey) {
      log.warn(
        '[ai-provider] Anthropic provider selected but API key missing. Falling back to Stage5.'
      );
      return stage5Client.translate(options);
    }

    log.debug('[ai-provider] Using Anthropic direct translation for Claude model.');
    try {
      return await translateWithAnthropic({
        messages,
        model,
        apiKey: anthropicKey,
        signal,
        effort: reasoning?.effort,
      });
    } catch (error) {
      mapAnthropicError(error);
    }
  }

  // Handle OpenAI models with BYO key
  if (provider === 'openai') {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      log.warn(
        '[ai-provider] OpenAI provider selected but API key missing. Falling back to Stage5.'
      );
      return stage5Client.translate(options);
    }

    log.debug('[ai-provider] Using OpenAI direct translation.');
    try {
      return await translateWithOpenAi({
        messages,
        model,
        apiKey,
        signal,
      });
    } catch (error) {
      mapOpenAiError(error);
    }
  }

  // Default: use Stage5 API (handles both OpenAI and Claude via relay)
  return stage5Client.translate(options);
}

export async function synthesizeDub(options: Stage5DubOptions): Promise<any> {
  if (getActiveProvider() !== 'openai') {
    return stage5Client.synthesizeDub(options as any);
  }

  const apiKey = getStoredApiKey();
  if (!apiKey) {
    log.warn(
      '[ai-provider] OpenAI provider selected but API key missing. Falling back to Stage5.'
    );
    return stage5Client.synthesizeDub(options as any);
  }

  const { segments, voice, model, format, signal } = options;
  const chosenModel =
    model || ((options as any).quality === 'high' ? 'tts-1-hd' : 'tts-1');

  log.debug('[ai-provider] Using OpenAI direct TTS.');
  try {
    return await synthesizeDubWithOpenAi({
      segments,
      voice,
      model: chosenModel,
      format,
      apiKey,
      signal,
    });
  } catch (error) {
    mapOpenAiError(error);
  }
}

export async function validateApiKey(apiKey: string): Promise<TestKeyResult> {
  try {
    await testOpenAiApiKey(apiKey);
    return { ok: true };
  } catch (error: any) {
    const message =
      error?.response?.data?.error?.message ||
      error?.message ||
      'Unknown error';
    return { ok: false, error: message };
  }
}

export async function validateAnthropicApiKey(
  apiKey: string
): Promise<TestKeyResult> {
  try {
    await testAnthropicApiKey(apiKey);
    return { ok: true };
  } catch (error: any) {
    const message =
      error?.error?.message || error?.message || 'Unknown error';
    return { ok: false, error: message };
  }
}

export function getCurrentApiKey(): string | null {
  return getStoredApiKey();
}

export function getCurrentAnthropicApiKey(): string | null {
  return getStoredAnthropicApiKey();
}
