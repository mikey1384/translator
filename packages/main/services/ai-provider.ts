import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import { decryptString } from './secure-storage.js';
import * as stage5Client from './stage5-client.js';
import {
  transcribeViaR2,
  translateViaDirect,
  dubViaDirect,
} from './stage5-client.js';
import { getCachedEntitlements } from './entitlements-manager.js';
import {
  translateWithOpenAi,
  respondWithOpenAiWebSearch,
  testOpenAiApiKey,
} from './openai-client.js';
import {
  translateWithAnthropic,
  respondWithAnthropicWebSearch,
  testAnthropicApiKey,
} from './anthropic-client.js';
import {
  transcribeWithElevenLabs,
  synthesizeDubWithElevenLabs,
  testElevenLabsApiKey,
} from './elevenlabs-client.js';
import {
  AI_MODELS,
  ERROR_CODES,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  normalizeAiModelId,
  normalizeDubVoice,
} from '@shared/constants';
import {
  API_KEY_MODE_DUBBING_BLOCKER_MESSAGES,
  getApiKeyModeDubbingBlocker,
  resolveDubbingRoute,
} from './dubbing-provider-routing.js';
import {
  API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES,
  getApiKeyModeTranscriptionBlocker,
  resolveTranscriptionRoute,
} from './transcription-provider-routing.js';
import {
  normalizeVideoSuggestionModelPreference,
  resolveEffectiveVideoSuggestionModel,
  resolveVideoSuggestionPreferenceForMode,
  type VideoSuggestionModelPreferenceValue,
} from './video-suggestion-model-preference.js';
import {
  getStage5TranslationReasoning,
  resolveByoTranslationReviewModelConfig,
  resolveStage5TranslationReviewModelConfig,
} from '../utils/review-model-routing.js';
import {
  resolveTranslationModelFamilyHint,
  type TranslationModelFamilyHintSource,
} from '../utils/translation-model-family-hint.js';
import {
  resolveSummaryModelConfig,
  type SummaryModelConfig,
} from '../utils/summary-model-routing.js';
import {
  APP_SETTINGS_DEFAULTS,
  normalizeByoVideoSuggestionModelSetting,
  normalizeDubbingProviderSetting,
  normalizeStage5VideoSuggestionModeSetting,
  normalizeStage5DubbingTtsProviderSetting,
  normalizeTranscriptionProviderSetting,
  normalizeVideoSuggestionModelPreferenceSetting,
  type DubbingProviderPreference,
  type Stage5DubbingTtsProviderPreference,
  type TranscriptionProviderPreference,
} from '../store/settings-schema.js';

export type ProviderKind = 'stage5' | 'openai' | 'anthropic' | 'elevenlabs';
export type VideoSuggestionModelPreference =
  VideoSuggestionModelPreferenceValue;

function isClaudeModel(model: string | undefined): boolean {
  const normalizedModel = normalizeAiModelId(model);
  return Boolean(normalizedModel && normalizedModel.startsWith('claude-'));
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

// Generic helper to get a stored API key with validation and decryption
function createApiKeyGetter(
  keyName: string,
  providerName: string
): () => string | null {
  return () => {
    if (!settingsStoreRef) {
      log.warn(
        `[ai-provider] settingsStoreRef is null when checking ${providerName} key`
      );
      return null;
    }
    const raw = settingsStoreRef.get(keyName as any, null);
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }
    // Decrypt the stored key (handles both encrypted and legacy plain text)
    const decrypted = decryptString(raw);
    log.debug(
      `[ai-provider] getStored${providerName}ApiKey:`,
      decrypted ? `[${decrypted.length} chars]` : 'null'
    );
    return decrypted || null;
  };
}

// Generic helper to check if a BYO toggle is enabled (respects API key mode)
function createByoToggleChecker(
  toggleKey: string,
  providerName: string,
  requiresApiKeyMode = true
): () => boolean {
  return () => {
    const fallback =
      toggleKey === 'useByoAnthropic'
        ? APP_SETTINGS_DEFAULTS.useByoAnthropic
        : toggleKey === 'useByoElevenLabs'
          ? APP_SETTINGS_DEFAULTS.useByoElevenLabs
          : false;
    if (!settingsStoreRef) return fallback;
    if (requiresApiKeyMode && !isApiKeyModeEnabled()) return false;
    try {
      return Boolean(settingsStoreRef.get(toggleKey as any, fallback));
    } catch (err) {
      log.error(
        `[ai-provider] Failed to load BYO ${providerName} toggle state:`,
        err
      );
      return fallback;
    }
  };
}

const getStoredApiKey = createApiKeyGetter('apiKey', 'OpenAI');
const getStoredAnthropicApiKey = createApiKeyGetter(
  'anthropicApiKey',
  'Anthropic'
);
const getStoredElevenLabsApiKey = createApiKeyGetter(
  'elevenLabsApiKey',
  'ElevenLabs'
);

const isByoAnthropicToggleEnabled = createByoToggleChecker(
  'useByoAnthropic',
  'Anthropic'
);
const isByoElevenLabsToggleEnabled = createByoToggleChecker(
  'useByoElevenLabs',
  'ElevenLabs'
);

function isApiKeyModeEnabled(): boolean {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.useByoMaster;
  try {
    return Boolean(
      settingsStoreRef.get('useByoMaster', APP_SETTINGS_DEFAULTS.useByoMaster)
    );
  } catch (err) {
    log.error('[ai-provider] Failed to load API key mode state:', err);
    return APP_SETTINGS_DEFAULTS.useByoMaster;
  }
}

export function prefersClaudeTranslation(): boolean {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.preferClaudeTranslation;
  try {
    return Boolean(
      settingsStoreRef.get(
        'preferClaudeTranslation',
        APP_SETTINGS_DEFAULTS.preferClaudeTranslation
      )
    );
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load Claude translation preference:',
      err
    );
    return APP_SETTINGS_DEFAULTS.preferClaudeTranslation;
  }
}

export function prefersClaudeReview(): boolean {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.preferClaudeReview;
  try {
    return Boolean(
      settingsStoreRef.get(
        'preferClaudeReview',
        APP_SETTINGS_DEFAULTS.preferClaudeReview
      )
    );
  } catch (err) {
    log.error('[ai-provider] Failed to load Claude review preference:', err);
    return APP_SETTINGS_DEFAULTS.preferClaudeReview;
  }
}

export function prefersClaudeSummary(): boolean {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.preferClaudeSummary;
  try {
    return Boolean(
      settingsStoreRef.get(
        'preferClaudeSummary',
        APP_SETTINGS_DEFAULTS.preferClaudeSummary
      )
    );
  } catch (err) {
    log.error('[ai-provider] Failed to load Claude summary preference:', err);
    return APP_SETTINGS_DEFAULTS.preferClaudeSummary;
  }
}

export function resolveTranslationDraftModel(): string {
  const prefersClaude = prefersClaudeTranslation();
  const canUseAnthropicByo =
    getActiveProviderForModel(AI_MODELS.CLAUDE_SONNET) === 'anthropic';
  const canUseOpenAiByo = getActiveProviderForModel(AI_MODELS.GPT) === 'openai';

  if (prefersClaude && canUseAnthropicByo) {
    return AI_MODELS.CLAUDE_SONNET;
  }
  if (canUseOpenAiByo) {
    return AI_MODELS.GPT;
  }
  if (canUseAnthropicByo) {
    return AI_MODELS.CLAUDE_SONNET;
  }
  return AI_MODELS.GPT;
}

export function resolveTranslationReviewModel(): {
  model: string;
  reasoning?: { effort: 'high' };
} {
  const canUseAnthropicByo =
    getActiveProviderForModel(AI_MODELS.CLAUDE_OPUS) === 'anthropic';
  const canUseOpenAiByo = getActiveProviderForModel(AI_MODELS.GPT) === 'openai';
  const prefersClaude = prefersClaudeReview();

  if (prefersClaude && canUseAnthropicByo) {
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  if (!prefersClaude && canUseOpenAiByo) {
    return { model: STAGE5_REVIEW_TRANSLATION_MODEL };
  }

  if (isApiKeyModeEnabled()) {
    return resolveByoTranslationReviewModelConfig({
      prefersClaude,
      canUseAnthropicByo,
      canUseOpenAiByo,
    });
  }

  return resolveStage5TranslationReviewModelConfig({
    prefersClaude,
  });
}

function getLegacyVideoSuggestionModelPreferenceSetting(): VideoSuggestionModelPreference {
  if (!settingsStoreRef) {
    return APP_SETTINGS_DEFAULTS.videoSuggestionModelPreference;
  }
  try {
    const rawValue = settingsStoreRef.get(
      'videoSuggestionModelPreference',
      APP_SETTINGS_DEFAULTS.videoSuggestionModelPreference
    );
    return normalizeVideoSuggestionModelPreferenceSetting(rawValue);
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load legacy video suggestion model preference:',
      err
    );
    return APP_SETTINGS_DEFAULTS.videoSuggestionModelPreference;
  }
}

function getStage5VideoSuggestionModeSetting() {
  if (!settingsStoreRef) {
    return APP_SETTINGS_DEFAULTS.stage5VideoSuggestionMode;
  }
  try {
    const rawValue = settingsStoreRef.get(
      'stage5VideoSuggestionMode',
      getLegacyVideoSuggestionModelPreferenceSetting()
    );
    return normalizeStage5VideoSuggestionModeSetting(rawValue);
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load Stage5 video suggestion mode setting:',
      err
    );
    return APP_SETTINGS_DEFAULTS.stage5VideoSuggestionMode;
  }
}

function getByoVideoSuggestionModelSetting() {
  if (!settingsStoreRef) {
    return APP_SETTINGS_DEFAULTS.byoVideoSuggestionModel;
  }
  try {
    const rawValue = settingsStoreRef.get(
      'byoVideoSuggestionModel',
      getLegacyVideoSuggestionModelPreferenceSetting()
    );
    return normalizeByoVideoSuggestionModelSetting(rawValue);
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load BYO video suggestion model setting:',
      err
    );
    return APP_SETTINGS_DEFAULTS.byoVideoSuggestionModel;
  }
}

export function getVideoSuggestionModelPreference(): VideoSuggestionModelPreference {
  return resolveVideoSuggestionPreferenceForMode({
    apiKeyModeEnabled: isApiKeyModeEnabled(),
    stage5Mode: getStage5VideoSuggestionModeSetting(),
    byoModel: getByoVideoSuggestionModelSetting(),
  });
}

function getAvailableByoVideoSuggestionModels(): string[] {
  const availableModels: string[] = [];

  if (getActiveProviderForModel(AI_MODELS.GPT) === 'openai') {
    availableModels.push(AI_MODELS.GPT);
    availableModels.push(STAGE5_REVIEW_TRANSLATION_MODEL);
  }
  if (getActiveProviderForModel(AI_MODELS.CLAUDE_SONNET) === 'anthropic') {
    availableModels.push(AI_MODELS.CLAUDE_SONNET);
  }
  if (getActiveProviderForModel(AI_MODELS.CLAUDE_OPUS) === 'anthropic') {
    availableModels.push(AI_MODELS.CLAUDE_OPUS);
  }

  return availableModels;
}

export function resolveVideoSuggestionModel(
  preference?: VideoSuggestionModelPreference
): string {
  return resolveEffectiveVideoSuggestionModel({
    preference: normalizeVideoSuggestionModelPreference(
      preference ?? getVideoSuggestionModelPreference()
    ),
    apiKeyModeEnabled: isApiKeyModeEnabled(),
    translationDraftModel: resolveTranslationDraftModel(),
    translationReviewModel: resolveTranslationReviewModel().model,
    availableByoModels: getAvailableByoVideoSuggestionModels(),
  });
}

export function resolveVideoSuggestionTranslationPhase(
  preference?: VideoSuggestionModelPreference
): 'draft' | 'review' {
  const selected = normalizeVideoSuggestionModelPreference(
    preference ?? getVideoSuggestionModelPreference()
  );
  return selected === 'quality' ||
    selected === STAGE5_REVIEW_TRANSLATION_MODEL ||
    selected === AI_MODELS.CLAUDE_OPUS
    ? 'review'
    : 'draft';
}

export type TranscriptionProviderPref = TranscriptionProviderPreference;

export function getPreferredTranscriptionProvider(): TranscriptionProviderPref {
  if (!settingsStoreRef) {
    return APP_SETTINGS_DEFAULTS.preferredTranscriptionProvider;
  }
  try {
    const value = settingsStoreRef.get(
      'preferredTranscriptionProvider',
      APP_SETTINGS_DEFAULTS.preferredTranscriptionProvider
    );
    return normalizeTranscriptionProviderSetting(value);
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load transcription provider preference:',
      err
    );
    return APP_SETTINGS_DEFAULTS.preferredTranscriptionProvider;
  }
}

export type DubbingProviderPref = DubbingProviderPreference;

export function getPreferredDubbingProvider(): DubbingProviderPref {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.preferredDubbingProvider;
  try {
    const value = settingsStoreRef.get(
      'preferredDubbingProvider',
      APP_SETTINGS_DEFAULTS.preferredDubbingProvider
    );
    return normalizeDubbingProviderSetting(value);
  } catch (err) {
    log.error('[ai-provider] Failed to load dubbing provider preference:', err);
    return APP_SETTINGS_DEFAULTS.preferredDubbingProvider;
  }
}

export type Stage5TtsProviderPref = Stage5DubbingTtsProviderPreference;

/**
 * Get the TTS provider to use when dubbing via Stage5 API. Always
 * 'elevenlabs' (eleven_v4); OpenAI TTS is retired.
 */
export function getStage5DubbingTtsProvider(): Stage5TtsProviderPref {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.stage5DubbingTtsProvider;
  try {
    const value = settingsStoreRef.get(
      'stage5DubbingTtsProvider',
      APP_SETTINGS_DEFAULTS.stage5DubbingTtsProvider
    );
    return normalizeStage5DubbingTtsProviderSetting(value);
  } catch (err) {
    log.error('[ai-provider] Failed to load Stage5 dubbing TTS provider:', err);
    return APP_SETTINGS_DEFAULTS.stage5DubbingTtsProvider;
  }
}

function isByoToggleEnabled(): boolean {
  if (!settingsStoreRef) return APP_SETTINGS_DEFAULTS.useByoOpenAi;
  // API key mode overrides individual toggles.
  if (!isApiKeyModeEnabled()) return false;
  try {
    return Boolean(
      settingsStoreRef.get('useByoOpenAi', APP_SETTINGS_DEFAULTS.useByoOpenAi)
    );
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO toggle state:', err);
    return APP_SETTINGS_DEFAULTS.useByoOpenAi;
  }
}

// Provider-specific error codes mapping
const PROVIDER_ERROR_CODES = {
  openai: {
    authInvalid: ERROR_CODES.OPENAI_KEY_INVALID,
    rateLimit: ERROR_CODES.OPENAI_RATE_LIMIT,
    insufficientQuota: ERROR_CODES.OPENAI_INSUFFICIENT_QUOTA,
  },
  anthropic: {
    authInvalid: ERROR_CODES.ANTHROPIC_KEY_INVALID,
    rateLimit: ERROR_CODES.ANTHROPIC_RATE_LIMIT,
    insufficientQuota: ERROR_CODES.ANTHROPIC_INSUFFICIENT_QUOTA,
  },
  elevenlabs: {
    authInvalid: ERROR_CODES.ELEVENLABS_KEY_INVALID,
    rateLimit: ERROR_CODES.ELEVENLABS_RATE_LIMIT,
    insufficientQuota: ERROR_CODES.ELEVENLABS_INSUFFICIENT_QUOTA,
  },
} as const;

type ErrorMappableProvider = keyof typeof PROVIDER_ERROR_CODES;

function isInsufficientQuotaError(error: any): boolean {
  const details = [
    error?.message,
    error?.response?.data?.error?.message,
    error?.response?.data?.error?.code,
    error?.response?.data?.error?.type,
    error?.response?.data?.message,
  ]
    .map(v => String(v ?? '').toLowerCase())
    .join(' ');
  return (
    details.includes('insufficient_quota') ||
    details.includes('insufficient quota') ||
    details.includes('insufficient credits')
  );
}

/**
 * Maps API errors to standardized error codes for a given provider.
 * Extracts status from error.status or error.response.status.
 */
function mapProviderError(provider: ErrorMappableProvider, error: any): never {
  const status = error?.status || error?.response?.status;
  const codes = PROVIDER_ERROR_CODES[provider];

  if (status === 401 || status === 403) {
    log.error(
      `[ai-provider] ${provider} rejected request with auth error:`,
      status
    );
    throw new Error(codes.authInvalid);
  }
  if (status === 429) {
    if (isInsufficientQuotaError(error)) {
      log.warn(`[ai-provider] ${provider} insufficient quota.`);
      throw new Error(codes.insufficientQuota);
    }
    log.warn(`[ai-provider] ${provider} rate limit hit.`);
    throw new Error(codes.rateLimit);
  }
  throw error;
}

// Convenience wrappers for backwards compatibility
function mapOpenAiError(error: any): never {
  return mapProviderError('openai', error);
}

function mapAnthropicError(error: any): never {
  return mapProviderError('anthropic', error);
}

function mapElevenLabsError(error: any): never {
  return mapProviderError('elevenlabs', error);
}

export function hasUserApiKey(): boolean {
  return Boolean(getStoredApiKey());
}

export function hasUserAnthropicApiKey(): boolean {
  return Boolean(getStoredAnthropicApiKey());
}

export function hasUserElevenLabsApiKey(): boolean {
  return Boolean(getStoredElevenLabsApiKey());
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
    log.debug(
      `[ai-provider] Claude model detected. byoAnthropic=${entitlements.byoAnthropic}, hasKey=${hasKey}, toggleEnabled=${toggleEnabled}`
    );
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

function hasElevenLabsByoAvailable(): boolean {
  return (
    getCachedEntitlements().byoElevenLabs &&
    hasUserElevenLabsApiKey() &&
    isByoElevenLabsToggleEnabled()
  );
}

/**
 * Get the active provider for transcription. Transcription is ElevenLabs
 * Scribe only: BYO ElevenLabs when available, otherwise Stage5 credits
 * (Scribe). An OpenAI key never routes transcription (whisper-1 retires
 * 2027-02-26).
 */
export function getActiveProviderForAudio(): 'elevenlabs' | 'stage5' {
  return resolveTranscriptionRoute({
    preference: getPreferredTranscriptionProvider(),
    apiKeyMode: isApiKeyModeEnabled(),
    hasElevenLabsByo: hasElevenLabsByoAvailable(),
  });
}

/**
 * English reason transcription cannot run, or null when it can. API key mode
 * never spends Stage5 credits, so it needs a usable BYO ElevenLabs key.
 */
export function getTranscriptionBlockerMessage(): string | null {
  if (!isApiKeyModeEnabled()) return null;
  if (getActiveProviderForAudio() === 'elevenlabs') return null;
  const blocker =
    getApiKeyModeTranscriptionBlocker({
      elevenLabsUnlocked: Boolean(getCachedEntitlements().byoElevenLabs),
      elevenLabsToggleEnabled: isByoElevenLabsToggleEnabled(),
      elevenLabsKeyPresent: hasUserElevenLabsApiKey(),
    }) ?? 'elevenlabs-key-missing';
  return API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES[blocker];
}

/** Throws the blocker message before any audio work starts. */
export function assertTranscriptionAvailable(): void {
  const message = getTranscriptionBlockerMessage();
  if (message) throw new Error(message);
}

/**
 * Get the active provider for dubbing/TTS. Dubbing is ElevenLabs-only:
 * BYO ElevenLabs when available, otherwise Stage5 credits (ElevenLabs).
 * An OpenAI key never routes dubbing.
 */
export function getActiveProviderForDubbing(): ProviderKind {
  return resolveDubbingRoute({
    preference: getPreferredDubbingProvider(),
    apiKeyMode: isApiKeyModeEnabled(),
    hasElevenLabsByo: hasElevenLabsByoAvailable(),
  });
}

export async function transcribe(
  options: Stage5TranscribeOptions
): Promise<any> {
  const audioProvider = getActiveProviderForAudio();
  const apiKeyModeEnabled = isApiKeyModeEnabled();

  // BYO ElevenLabs Scribe
  if (audioProvider === 'elevenlabs') {
    const elevenLabsKey = getStoredElevenLabsApiKey();
    if (!elevenLabsKey) {
      if (apiKeyModeEnabled) {
        throw new Error(ERROR_CODES.ELEVENLABS_KEY_INVALID);
      }
      log.warn(
        '[ai-provider] ElevenLabs provider selected but API key missing. Falling back to Stage5.'
      );
      // Fall through to Stage5
    } else {
      const { filePath, signal, idempotencyKey } =
        options as Stage5TranscribeOptions;
      log.debug('[ai-provider] Using ElevenLabs Scribe for transcription.');
      try {
        const result = await transcribeWithElevenLabs({
          filePath,
          apiKey: elevenLabsKey,
          idempotencyKey,
          signal,
        });
        // Convert the ElevenLabs result to the app's segment format
        // ElevenLabs returns `words` with `speaker_id` - we need to build segments
        const words = (result.words || []).filter(w => w.type === 'word');

        // Build segments by grouping words on speaker changes and sentence-ending punctuation
        const segments: Array<{
          speaker_id?: string;
          id: number;
          start: number;
          end: number;
          text: string;
          words: Array<{ word: string; start: number; end: number }>;
        }> = [];

        let currentSegment: {
          words: typeof words;
          speakerId: string | undefined;
        } = { words: [], speakerId: undefined };

        const SENTENCE_ENDERS = /[.!?。！？]/;
        const MAX_SEGMENT_DURATION = 8; // seconds - keep cues short

        for (const word of words) {
          const speakerChanged =
            currentSegment.speakerId !== undefined &&
            word.speaker_id !== currentSegment.speakerId;
          const sentenceEnded =
            currentSegment.words.length > 0 &&
            SENTENCE_ENDERS.test(
              currentSegment.words[currentSegment.words.length - 1]?.text || ''
            );
          const tooLong =
            currentSegment.words.length > 0 &&
            word.end - currentSegment.words[0].start > MAX_SEGMENT_DURATION;

          // Start new segment on speaker change, sentence end, or if too long
          if (
            (speakerChanged || sentenceEnded || tooLong) &&
            currentSegment.words.length > 0
          ) {
            const segWords = currentSegment.words;
            segments.push({
              speaker_id: currentSegment.speakerId,
              id: segments.length,
              start: segWords[0].start,
              end: segWords[segWords.length - 1].end,
              text: segWords.map(w => w.text).join(' '),
              words: segWords.map(w => ({
                word: w.text,
                start: w.start,
                end: w.end,
              })),
            });
            currentSegment = { words: [], speakerId: word.speaker_id };
          }

          currentSegment.words.push(word);
          currentSegment.speakerId = word.speaker_id;
        }

        // Don't forget the last segment
        if (currentSegment.words.length > 0) {
          const segWords = currentSegment.words;
          segments.push({
            speaker_id: currentSegment.speakerId,
            id: segments.length,
            start: segWords[0].start,
            end: segWords[segWords.length - 1].end,
            text: segWords.map(w => w.text).join(' '),
            words: segWords.map(w => ({
              word: w.text,
              start: w.start,
              end: w.end,
            })),
          });
        }

        return {
          text: result.text,
          segments,
          words: words.map(w => ({
            word: w.text,
            start: w.start,
            end: w.end,
          })),
          language: result.language_code,
        };
      } catch (error) {
        mapElevenLabsError(error);
      }
    }
  }

  if (apiKeyModeEnabled) {
    // API key mode never spends Stage5 credits, and transcription needs
    // ElevenLabs Scribe (an OpenAI key cannot transcribe). Explain what is
    // missing.
    throw new Error(
      getTranscriptionBlockerMessage() ??
        API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES['elevenlabs-key-missing']
    );
  }

  // Default: Stage5 credits, transcribed with ElevenLabs Scribe.
  return stage5Client.transcribe(options);
}

/**
 * Transcribe a large file via the durable R2 upload + worker processing flow.
 */
export async function transcribeLargeFileViaR2(options: {
  filePath: string;
  language?: string;
  signal?: AbortSignal;
  durationSec?: number;
  onProgress?: (stage: string, percent?: number) => void;
  /** Prevent double-charges on client retries / disconnects. */
  idempotencyKey?: string;
  /** Stable identifier used to reconnect to an already-started durable job. */
  recoverySeed?: string;
  /** Stable source path used to reconnect to an already-started durable job. */
  recoverySourcePath?: string;
}): Promise<any> {
  if (isApiKeyModeEnabled()) {
    // API key mode never spends Stage5 credits.
    throw new Error(
      getTranscriptionBlockerMessage() ??
        API_KEY_MODE_TRANSCRIPTION_BLOCKER_MESSAGES['elevenlabs-key-missing']
    );
  }
  return transcribeViaR2(options);
}

export async function translate(
  options: Stage5TranslateOptions & {
    modelFamilyHintSource?: TranslationModelFamilyHintSource;
  }
): Promise<any> {
  const {
    messages,
    model,
    signal,
    reasoning,
    translationPhase,
    modelFamilyHintSource = 'preference',
    tools,
    toolChoice,
    ...stage5RestOptions
  } = options;
  const normalizedModel = normalizeAiModelId(model);
  const provider = getActiveProviderForModel(normalizedModel);
  const apiKeyModeEnabled = isApiKeyModeEnabled();
  // hintSource 'model' means the caller pinned a concrete model (e.g. the
  // video-suggestion agent); send it explicitly instead of deferring to
  // backend-authoritative translation-model routing.
  const useServerModelAuthority =
    (translationPhase === 'draft' || translationPhase === 'review') &&
    modelFamilyHintSource !== 'model';
  const modelFamilyHint = resolveTranslationModelFamilyHint({
    translationPhase,
    model: normalizedModel,
    hintSource: modelFamilyHintSource,
    prefersClaudeDraft: prefersClaudeTranslation(),
    prefersClaudeReview: prefersClaudeReview(),
  });
  const effectiveReasoning = getStage5TranslationReasoning({
    translationPhase,
    reasoning,
  });
  const stage5Options: Stage5TranslateOptions = {
    ...stage5RestOptions,
    messages,
    signal,
    translationPhase,
    reasoning: effectiveReasoning,
    tools,
    toolChoice,
    // Subtitle translation phases use backend-authoritative model routing in Stage5 mode.
    model: useServerModelAuthority ? undefined : normalizedModel,
    // Preserve user/provider family intent without pinning concrete model versions.
    modelFamily: useServerModelAuthority ? modelFamilyHint : undefined,
  };

  // Handle Anthropic/Claude models with BYO key
  if (provider === 'anthropic') {
    const anthropicKey = getStoredAnthropicApiKey();
    if (!anthropicKey) {
      if (apiKeyModeEnabled) {
        throw new Error(ERROR_CODES.ANTHROPIC_KEY_INVALID);
      }
      log.warn(
        '[ai-provider] Anthropic provider selected but API key missing. Falling back to Stage5.'
      );
      return stage5Client.translate(stage5Options);
    }

    log.debug(
      '[ai-provider] Using Anthropic direct translation for Claude model.'
    );
    try {
      return await translateWithAnthropic({
        messages,
        model: normalizedModel,
        apiKey: anthropicKey,
        signal,
        effort: effectiveReasoning?.effort,
        tools,
        toolChoice,
      });
    } catch (error) {
      mapAnthropicError(error);
    }
  }

  // Handle OpenAI models with BYO key
  if (provider === 'openai') {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      if (apiKeyModeEnabled) {
        throw new Error(ERROR_CODES.OPENAI_KEY_INVALID);
      }
      log.warn(
        '[ai-provider] OpenAI provider selected but API key missing. Falling back to Stage5.'
      );
      return stage5Client.translate(stage5Options);
    }

    log.debug('[ai-provider] Using OpenAI direct translation.');
    try {
      return await translateWithOpenAi({
        messages,
        model: normalizedModel,
        apiKey,
        signal,
        reasoning: effectiveReasoning,
        tools,
        toolChoice,
      });
    } catch (error) {
      mapOpenAiError(error);
    }
  }

  if (apiKeyModeEnabled) {
    const entitlements = getCachedEntitlements();
    if (isClaudeModel(normalizedModel)) {
      if (!entitlements.byoAnthropic) {
        throw new Error(
          'BYO Anthropic is not unlocked for this account. Switch to Stage5 credits or unlock Anthropic BYO to continue.'
        );
      }
      if (!isByoAnthropicToggleEnabled()) {
        throw new Error(
          'BYO Anthropic is disabled in Settings. Enable it to use Claude models with your own API keys.'
        );
      }
      if (!hasUserAnthropicApiKey()) {
        throw new Error(ERROR_CODES.ANTHROPIC_KEY_INVALID);
      }
      throw new Error(
        'Using your API keys is on, but Anthropic translation is currently unavailable.'
      );
    }

    if (!entitlements.byoOpenAi) {
      throw new Error(
        'BYO OpenAI is not unlocked for this account. Switch to Stage5 credits or unlock OpenAI BYO to continue.'
      );
    }
    if (!isByoToggleEnabled()) {
      throw new Error(
        'BYO OpenAI is disabled in Settings. Enable it to use OpenAI models with your own API keys.'
      );
    }
    if (!hasUserApiKey()) {
      throw new Error(ERROR_CODES.OPENAI_KEY_INVALID);
    }
    throw new Error(
      'Using your API keys is on, but OpenAI translation is currently unavailable.'
    );
  }

  // Default: use Stage5 via direct relay (simplified flow)
  log.debug('[ai-provider] Using Stage5 direct relay for translation.');
  return translateViaDirect(stage5Options);
}

export async function translateWithWebSearch(
  options: Stage5TranslateOptions & {
    onTextDelta?: (delta: string) => void;
    modelFamilyHintSource?: TranslationModelFamilyHintSource;
  }
): Promise<any> {
  const {
    messages,
    model,
    signal,
    reasoning,
    translationPhase,
    onTextDelta,
    modelFamilyHintSource = 'preference',
    ...stage5Options
  } = options;
  const normalizedModel = normalizeAiModelId(model);
  const preferredModel = normalizedModel || AI_MODELS.GPT;
  const provider = getActiveProviderForModel(preferredModel);
  const apiKeyModeEnabled = isApiKeyModeEnabled();
  const useServerModelAuthority =
    translationPhase === 'draft' || translationPhase === 'review';
  const modelFamilyHint = resolveTranslationModelFamilyHint({
    translationPhase,
    model: normalizedModel,
    hintSource: modelFamilyHintSource,
    prefersClaudeDraft: prefersClaudeTranslation(),
    prefersClaudeReview: prefersClaudeReview(),
  });
  const effectiveReasoning = getStage5TranslationReasoning({
    translationPhase,
    reasoning,
  });

  // Respect active BYO provider and surface BYO budget/auth/rate errors directly.
  // Do not silently spend Stage5 credits when API key mode is active.
  if (provider === 'openai') {
    const apiKey = getStoredApiKey();
    if (!apiKey) {
      throw new Error(ERROR_CODES.OPENAI_KEY_INVALID);
    }
    log.debug(
      `[ai-provider] Using OpenAI web search via Responses API (model=${preferredModel}).`
    );
    try {
      return await respondWithOpenAiWebSearch({
        messages,
        model: preferredModel,
        apiKey,
        signal,
        reasoning: effectiveReasoning,
        onTextDelta,
      });
    } catch (error) {
      mapOpenAiError(error);
    }
  }

  if (provider === 'anthropic') {
    const apiKey = getStoredAnthropicApiKey();
    if (!apiKey) {
      throw new Error(ERROR_CODES.ANTHROPIC_KEY_INVALID);
    }
    log.debug(
      `[ai-provider] Using Anthropic web search (model=${preferredModel}).`
    );
    try {
      return await respondWithAnthropicWebSearch({
        messages,
        model: preferredModel,
        apiKey,
        signal,
        effort: effectiveReasoning?.effort,
        onTextDelta,
      });
    } catch (error) {
      mapAnthropicError(error);
    }
  }

  // In API key mode, never silently spend Stage5 credits.
  if (apiKeyModeEnabled) {
    const entitlements = getCachedEntitlements();
    if (isClaudeModel(preferredModel)) {
      if (!entitlements.byoAnthropic) {
        throw new Error(
          'BYO Anthropic is not unlocked for this account. Switch to Stage5 credits or unlock Anthropic BYO to continue.'
        );
      }
      if (!isByoAnthropicToggleEnabled()) {
        throw new Error(
          'BYO Anthropic is disabled in Settings. Enable it to use Claude video search.'
        );
      }
      if (!hasUserAnthropicApiKey()) {
        throw new Error(ERROR_CODES.ANTHROPIC_KEY_INVALID);
      }
      throw new Error(
        'BYO Anthropic is enabled but unavailable for web search. Please verify your model and API settings.'
      );
    }

    if (!entitlements.byoOpenAi) {
      throw new Error(
        'BYO OpenAI is not unlocked for this account. Switch to Stage5 credits or unlock OpenAI BYO to continue.'
      );
    }
    if (!isByoToggleEnabled()) {
      throw new Error(
        'BYO OpenAI is disabled in Settings. Enable it to use video search with OpenAI models.'
      );
    }
    if (!hasUserApiKey()) {
      throw new Error(ERROR_CODES.OPENAI_KEY_INVALID);
    }
    throw new Error(
      'BYO OpenAI is enabled but unavailable for web search. Please verify your model and API settings.'
    );
  }

  // Stage5 credit mode: mirror normal translation model resolution.
  log.debug(
    '[ai-provider] Using Stage5 relay for web-search call path (credits mode).'
  );
  return translateViaDirect({
    ...stage5Options,
    messages,
    model: useServerModelAuthority ? undefined : normalizedModel,
    modelFamily: useServerModelAuthority ? modelFamilyHint : undefined,
    translationPhase,
    webSearch: true,
    reasoning: effectiveReasoning,
    signal,
  });
}

export async function synthesizeDub(
  rawOptions: Stage5DubOptions
): Promise<any> {
  // Legacy OpenAI voice names map to their ElevenLabs replacements.
  const normalizedVoice = normalizeDubVoice(rawOptions.voice);
  const options: Stage5DubOptions = {
    ...rawOptions,
    voice: normalizedVoice || undefined,
    // Only ElevenLabs models are valid; anything else (e.g. a legacy
    // 'tts-1') falls back to the eleven_v4 default downstream.
    model: rawOptions.model?.startsWith('eleven_')
      ? rawOptions.model
      : undefined,
  };
  const audioProvider = getActiveProviderForDubbing();
  const apiKeyModeEnabled = isApiKeyModeEnabled();

  // BYO ElevenLabs TTS
  if (audioProvider === 'elevenlabs') {
    const elevenLabsKey = getStoredElevenLabsApiKey();
    if (!elevenLabsKey) {
      if (apiKeyModeEnabled) {
        throw new Error(ERROR_CODES.ELEVENLABS_KEY_INVALID);
      }
      log.warn(
        '[ai-provider] ElevenLabs provider selected but API key missing. Falling back to Stage5.'
      );
      // Fall through to Stage5
    } else {
      const { segments, voice, signal, format } = options;
      log.debug('[ai-provider] Using ElevenLabs TTS for dubbing.');
      try {
        const result = await synthesizeDubWithElevenLabs({
          segments: segments.map((s, idx) => ({
            index: s.index ?? idx,
            translation: s.translation || s.original || '',
            original: s.original || '',
            targetDuration:
              s.start !== undefined && s.end !== undefined
                ? s.end - s.start
                : undefined,
          })),
          voice: voice || 'adam',
          format,
          apiKey: elevenLabsKey,
          modelId: options.model?.startsWith('eleven_')
            ? options.model
            : undefined,
          signal,
        });
        // Convert to the expected format
        return {
          format: result.format,
          voice: result.voice,
          model: result.model,
          segments: result.segments,
          segmentCount: result.segments?.length ?? 0,
        };
      } catch (error) {
        mapElevenLabsError(error);
      }
    }
  }

  if (apiKeyModeEnabled) {
    // API key mode never spends Stage5 credits, and dubbing needs ElevenLabs
    // (an OpenAI key cannot dub). Explain what is missing.
    const blocker = getApiKeyModeDubbingBlocker({
      elevenLabsUnlocked: Boolean(getCachedEntitlements().byoElevenLabs),
      elevenLabsToggleEnabled: isByoElevenLabsToggleEnabled(),
      elevenLabsKeyPresent: hasUserElevenLabsApiKey(),
    });
    if (
      blocker === 'elevenlabs-not-unlocked' ||
      blocker === 'elevenlabs-disabled'
    ) {
      throw new Error(API_KEY_MODE_DUBBING_BLOCKER_MESSAGES[blocker]);
    }
    if (blocker === 'elevenlabs-key-missing') {
      throw new Error(ERROR_CODES.ELEVENLABS_KEY_INVALID);
    }
    throw new Error(
      'Using your API keys is on, but no BYO dubbing provider is currently available. Dubbing needs an ElevenLabs API key.'
    );
  }

  // Default: Stage5 credits via the direct relay, synthesized with
  // ElevenLabs eleven_v4 (OpenAI TTS is retired).
  const stage5TtsProvider = getStage5DubbingTtsProvider();
  log.debug(
    `[ai-provider] Using Stage5 direct relay with ${stage5TtsProvider} TTS provider`
  );
  return dubViaDirect({
    ...options,
    ttsProvider: stage5TtsProvider,
  } as any);
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
    const message = error?.error?.message || error?.message || 'Unknown error';
    return { ok: false, error: message };
  }
}

export function getCurrentApiKey(): string | null {
  return getStoredApiKey();
}

export function getCurrentAnthropicApiKey(): string | null {
  return getStoredAnthropicApiKey();
}

export async function validateElevenLabsApiKey(
  apiKey: string
): Promise<TestKeyResult> {
  try {
    await testElevenLabsApiKey(apiKey);
    return { ok: true };
  } catch (error: any) {
    const message = error?.message || 'Unknown error';
    return { ok: false, error: message };
  }
}

export function getCurrentElevenLabsApiKey(): string | null {
  return getStoredElevenLabsApiKey();
}

/**
 * Get the model configuration for summary based on effort level and BYO settings.
 *
 * For Stage5 (non-BYO):
 *   - Standard: GPT-5.1
 *   - High: GPT-5.5
 *
 * For BYO users:
 *   - If prefers Claude (or only has Anthropic key):
 *     - Standard: Claude Sonnet 4.6
 *     - High: Claude Opus 4.8
 *   - If prefers OpenAI (or only has OpenAI key):
 *     - Standard: GPT-5.1
 *     - High: GPT-5.5
 */
export function getSummaryModelConfig(
  effortLevel: 'standard' | 'high'
): SummaryModelConfig {
  const entitlements = getCachedEntitlements();

  // Check BYO availability
  const hasOpenAiByo =
    entitlements.byoOpenAi && hasUserApiKey() && isByoToggleEnabled();
  const hasAnthropicByo =
    entitlements.byoAnthropic &&
    hasUserAnthropicApiKey() &&
    isByoAnthropicToggleEnabled();

  return resolveSummaryModelConfig({
    effortLevel,
    prefersClaude: prefersClaudeSummary(),
    canUseAnthropicByo: hasAnthropicByo,
    canUseOpenAiByo: hasOpenAiByo,
  });
}
