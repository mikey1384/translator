import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import * as stage5Client from './stage5-client.js';
import { transcribeViaR2 } from './stage5-client.js';
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
import {
  transcribeWithElevenLabs,
  synthesizeDubWithElevenLabs,
  testElevenLabsApiKey,
} from './elevenlabs-client.js';
import { AI_MODELS, ERROR_CODES } from '@shared/constants';

export type ProviderKind = 'stage5' | 'openai' | 'anthropic' | 'elevenlabs';

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
    log.warn(
      '[ai-provider] settingsStoreRef is null when checking Anthropic key'
    );
    return null;
  }
  const raw = settingsStoreRef.get('anthropicApiKey', null);
  log.debug(
    '[ai-provider] getStoredAnthropicApiKey raw value:',
    raw ? `[${raw.length} chars]` : 'null'
  );
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

function isByoAnthropicToggleEnabled(): boolean {
  if (!settingsStoreRef) return false;
  // Master toggle overrides individual toggles
  if (!isByoMasterEnabled()) return false;
  try {
    return Boolean(settingsStoreRef.get('useByoAnthropic', false));
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO Anthropic toggle state:', err);
    return false;
  }
}

function getStoredElevenLabsApiKey(): string | null {
  if (!settingsStoreRef) {
    log.warn(
      '[ai-provider] settingsStoreRef is null when checking ElevenLabs key'
    );
    return null;
  }
  const raw = settingsStoreRef.get('elevenLabsApiKey', null);
  log.debug(
    '[ai-provider] getStoredElevenLabsApiKey raw value:',
    raw ? `[${raw.length} chars]` : 'null'
  );
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return null;
}

function isByoElevenLabsToggleEnabled(): boolean {
  if (!settingsStoreRef) return false;
  // Master toggle overrides individual toggles
  if (!isByoMasterEnabled()) return false;
  try {
    return Boolean(settingsStoreRef.get('useByoElevenLabs', false));
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO ElevenLabs toggle state:', err);
    return false;
  }
}

function isByoMasterEnabled(): boolean {
  if (!settingsStoreRef) return false;
  try {
    // Default to true for backwards compatibility
    return Boolean(settingsStoreRef.get('useByoMaster', true));
  } catch (err) {
    log.error('[ai-provider] Failed to load BYO master toggle state:', err);
    return true;
  }
}

export function prefersClaudeTranslation(): boolean {
  if (!settingsStoreRef) return false;
  try {
    return Boolean(settingsStoreRef.get('preferClaudeTranslation', false));
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load Claude translation preference:',
      err
    );
    return false;
  }
}

export function prefersClaudeReview(): boolean {
  if (!settingsStoreRef) return true; // Default to Claude for review
  try {
    return Boolean(settingsStoreRef.get('preferClaudeReview', true));
  } catch (err) {
    log.error('[ai-provider] Failed to load Claude review preference:', err);
    return true;
  }
}

export type TranscriptionProviderPref = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredTranscriptionProvider(): TranscriptionProviderPref {
  if (!settingsStoreRef) return 'elevenlabs';
  try {
    const value = settingsStoreRef.get(
      'preferredTranscriptionProvider',
      'elevenlabs'
    );
    if (value === 'elevenlabs' || value === 'openai' || value === 'stage5') {
      return value;
    }
    return 'elevenlabs';
  } catch (err) {
    log.error(
      '[ai-provider] Failed to load transcription provider preference:',
      err
    );
    return 'elevenlabs';
  }
}

export type DubbingProviderPref = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredDubbingProvider(): DubbingProviderPref {
  if (!settingsStoreRef) return 'elevenlabs';
  try {
    const value = settingsStoreRef.get(
      'preferredDubbingProvider',
      'elevenlabs'
    );
    if (value === 'elevenlabs' || value === 'openai' || value === 'stage5') {
      return value;
    }
    return 'elevenlabs';
  } catch (err) {
    log.error('[ai-provider] Failed to load dubbing provider preference:', err);
    return 'elevenlabs';
  }
}

export type Stage5TtsProviderPref = 'openai' | 'elevenlabs';

/**
 * Get the TTS provider to use when dubbing via Stage5 API.
 * 'openai' = cheaper ($15/1M chars), 'elevenlabs' = premium quality ($200/1M chars)
 */
export function getStage5DubbingTtsProvider(): Stage5TtsProviderPref {
  if (!settingsStoreRef) return 'openai'; // Default to cheaper option
  try {
    const value = settingsStoreRef.get('stage5DubbingTtsProvider', 'openai');
    if (value === 'openai' || value === 'elevenlabs') {
      return value;
    }
    return 'openai';
  } catch (err) {
    log.error('[ai-provider] Failed to load Stage5 dubbing TTS provider:', err);
    return 'openai';
  }
}

function isByoToggleEnabled(): boolean {
  if (!settingsStoreRef) return false;
  // Master toggle overrides individual toggles
  if (!isByoMasterEnabled()) return false;
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
    throw new Error(ERROR_CODES.OPENAI_KEY_INVALID);
  }
  if (status === 429) {
    log.warn('[ai-provider] OpenAI rate limit hit.');
    throw new Error(ERROR_CODES.OPENAI_RATE_LIMIT);
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
    throw new Error(ERROR_CODES.ANTHROPIC_KEY_INVALID);
  }
  if (status === 429) {
    log.warn('[ai-provider] Anthropic rate limit hit.');
    throw new Error(ERROR_CODES.ANTHROPIC_RATE_LIMIT);
  }
  throw error;
}

function mapElevenLabsError(error: any): never {
  const status = error?.status || error?.response?.status;
  if (status === 401 || status === 403) {
    log.error(
      '[ai-provider] ElevenLabs rejected request with auth error:',
      status
    );
    throw new Error('elevenlabs-key-invalid');
  }
  if (status === 429) {
    log.warn('[ai-provider] ElevenLabs rate limit hit.');
    throw new Error('elevenlabs-rate-limit');
  }
  throw error;
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

/**
 * Get the active provider for transcription.
 * Respects user's preferred transcription provider setting.
 */
export function getActiveProviderForAudio(): ProviderKind {
  const entitlements = getCachedEntitlements();
  const preference = getPreferredTranscriptionProvider();

  const hasElevenLabs =
    entitlements.byoElevenLabs &&
    hasUserElevenLabsApiKey() &&
    isByoElevenLabsToggleEnabled();
  const hasOpenAi =
    entitlements.byoOpenAi && hasUserApiKey() && isByoToggleEnabled();

  log.debug(
    `[ai-provider] getActiveProviderForAudio: preference=${preference}, hasElevenLabs=${hasElevenLabs}, hasOpenAi=${hasOpenAi}`
  );

  // User explicitly wants Stage5
  if (preference === 'stage5') {
    return 'stage5';
  }

  // User prefers ElevenLabs
  if (preference === 'elevenlabs') {
    if (hasElevenLabs) return 'elevenlabs';
    // Fallback: try OpenAI, then Stage5
    if (hasOpenAi) return 'openai';
    return 'stage5';
  }

  // User prefers OpenAI
  if (preference === 'openai') {
    if (hasOpenAi) return 'openai';
    // Fallback: try ElevenLabs, then Stage5
    if (hasElevenLabs) return 'elevenlabs';
    return 'stage5';
  }

  // Default: prefer ElevenLabs > OpenAI > Stage5
  if (hasElevenLabs) return 'elevenlabs';
  if (hasOpenAi) return 'openai';
  return 'stage5';
}

/**
 * Get the active provider for dubbing/TTS.
 * Respects user's preferred dubbing provider setting.
 */
export function getActiveProviderForDubbing(): ProviderKind {
  const entitlements = getCachedEntitlements();
  const preference = getPreferredDubbingProvider();

  const hasElevenLabs =
    entitlements.byoElevenLabs &&
    hasUserElevenLabsApiKey() &&
    isByoElevenLabsToggleEnabled();
  const hasOpenAi =
    entitlements.byoOpenAi && hasUserApiKey() && isByoToggleEnabled();

  log.debug(
    `[ai-provider] getActiveProviderForDubbing: preference=${preference}, hasElevenLabs=${hasElevenLabs}, hasOpenAi=${hasOpenAi}`
  );

  // User explicitly wants Stage5
  if (preference === 'stage5') {
    return 'stage5';
  }

  // User prefers ElevenLabs
  if (preference === 'elevenlabs') {
    if (hasElevenLabs) return 'elevenlabs';
    // Fallback: try OpenAI, then Stage5
    if (hasOpenAi) return 'openai';
    return 'stage5';
  }

  // User prefers OpenAI
  if (preference === 'openai') {
    if (hasOpenAi) return 'openai';
    // Fallback: try ElevenLabs, then Stage5
    if (hasElevenLabs) return 'elevenlabs';
    return 'stage5';
  }

  // Default: prefer ElevenLabs > OpenAI > Stage5
  if (hasElevenLabs) return 'elevenlabs';
  if (hasOpenAi) return 'openai';
  return 'stage5';
}

export async function transcribe(
  options: Stage5TranscribeOptions
): Promise<any> {
  const audioProvider = getActiveProviderForAudio();

  // Use ElevenLabs Scribe for highest quality transcription
  if (audioProvider === 'elevenlabs') {
    const elevenLabsKey = getStoredElevenLabsApiKey();
    if (!elevenLabsKey) {
      log.warn(
        '[ai-provider] ElevenLabs provider selected but API key missing. Falling back.'
      );
      // Fall through to OpenAI or Stage5
    } else {
      const { filePath, signal } = options as Stage5TranscribeOptions;
      log.debug('[ai-provider] Using ElevenLabs Scribe for transcription.');
      try {
        const result = await transcribeWithElevenLabs({
          filePath,
          apiKey: elevenLabsKey,
          signal,
        });
        // Convert ElevenLabs result to Whisper-compatible format
        // ElevenLabs returns `words` with `speaker_id` - we need to build segments
        const words = (result.words || []).filter(w => w.type === 'word');

        // Build segments by grouping words on speaker changes and sentence-ending punctuation
        const segments: Array<{
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
        const MAX_SEGMENT_DURATION = 8; // seconds - keep segments short like Whisper

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

  // Use OpenAI BYO if enabled
  if (audioProvider === 'openai') {
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

  // Default: use Stage5 API
  return stage5Client.transcribe(options);
}

/**
 * Transcribe a large file via R2 upload flow (Stage5 credits only).
 * Used for files > 95MB that can't go through CF Worker directly.
 */
export async function transcribeLargeFileViaR2(options: {
  filePath: string;
  language?: string;
  signal?: AbortSignal;
  onProgress?: (stage: string, percent?: number) => void;
}): Promise<any> {
  return transcribeViaR2(options);
}

export async function translate(options: Stage5TranslateOptions): Promise<any> {
  const { messages, model, signal, reasoning } =
    options as Stage5TranslateOptions;
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

    log.debug(
      '[ai-provider] Using Anthropic direct translation for Claude model.'
    );
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
        reasoning,
      });
    } catch (error) {
      mapOpenAiError(error);
    }
  }

  // Default: use Stage5 API (handles both OpenAI and Claude via relay)
  return stage5Client.translate(options);
}

export async function synthesizeDub(options: Stage5DubOptions): Promise<any> {
  const audioProvider = getActiveProviderForDubbing();

  // Use ElevenLabs TTS for highest quality dubbing
  if (audioProvider === 'elevenlabs') {
    const elevenLabsKey = getStoredElevenLabsApiKey();
    if (!elevenLabsKey) {
      log.warn(
        '[ai-provider] ElevenLabs provider selected but API key missing. Falling back.'
      );
      // Fall through to OpenAI or Stage5
    } else {
      const { segments, voice, signal } = options;
      log.debug('[ai-provider] Using ElevenLabs TTS for dubbing.');
      try {
        // Map OpenAI voice names to ElevenLabs voice IDs (using default voices)
        // ElevenLabs has different voice IDs, but we can use readable names
        const elevenLabsVoice = voice || 'adam';
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
          voice: elevenLabsVoice,
          apiKey: elevenLabsKey,
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

  // Use OpenAI BYO if enabled
  if (audioProvider === 'openai') {
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

  // Default: use Stage5 API with user's preferred TTS provider
  // OpenAI: $15/1M chars (cheaper), ElevenLabs: $200/1M chars (premium quality)
  const stage5TtsProvider = getStage5DubbingTtsProvider();
  log.debug(`[ai-provider] Using Stage5 API with ${stage5TtsProvider} TTS provider`);
  return stage5Client.synthesizeDub({
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

export type SummaryModelConfig = {
  model: string;
  reasoning?: { effort: 'low' | 'medium' | 'high' };
  provider: ProviderKind;
};

/**
 * Get the model configuration for summary based on effort level and BYO settings.
 *
 * For Stage5 (non-BYO):
 *   - Standard: GPT-5.1 (no reasoning)
 *   - High: Claude Opus with extended thinking
 *
 * For BYO users:
 *   - If prefers Claude (or only has Anthropic key):
 *     - Standard: Claude Sonnet 4.5
 *     - High: Claude Opus 4.5 with extended thinking
 *   - If prefers OpenAI (or only has OpenAI key):
 *     - Standard: GPT-5.1 (reasoning: none)
 *     - High: GPT-5.1 (reasoning: high)
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

  // If no BYO available, use Stage5 defaults
  if (!hasOpenAiByo && !hasAnthropicByo) {
    if (effortLevel === 'high') {
      return {
        model: AI_MODELS.CLAUDE_OPUS,
        reasoning: { effort: 'high' },
        provider: 'stage5',
      };
    }
    return {
      model: AI_MODELS.GPT,
      provider: 'stage5',
    };
  }

  // BYO is available - check preference
  const prefersClaude = prefersClaudeTranslation();

  // Determine which provider to use
  let useAnthropic: boolean;
  if (hasOpenAiByo && hasAnthropicByo) {
    // User has both - use their preference
    useAnthropic = prefersClaude;
  } else {
    // User has only one - use what's available
    useAnthropic = hasAnthropicByo;
  }

  if (useAnthropic) {
    // Anthropic path
    if (effortLevel === 'high') {
      return {
        model: AI_MODELS.CLAUDE_OPUS,
        reasoning: { effort: 'high' },
        provider: 'anthropic',
      };
    }
    return {
      model: AI_MODELS.CLAUDE_SONNET,
      provider: 'anthropic',
    };
  } else {
    // OpenAI path
    if (effortLevel === 'high') {
      return {
        model: AI_MODELS.GPT,
        reasoning: { effort: 'high' },
        provider: 'openai',
      };
    }
    return {
      model: AI_MODELS.GPT,
      provider: 'openai',
    };
  }
}
