import {
  getApiKeyModeDubbingBlocker,
  type ApiKeyModeDubbingBlocker,
} from '../../shared/helpers/dubbing-route';
import {
  getApiKeyModeTranscriptionBlocker,
  type ApiKeyModeTranscriptionBlocker,
} from '../../shared/helpers/transcription-route';
import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants';

export type ByoPreferenceProvider = 'elevenlabs' | 'openai' | 'stage5';
// Transcription is ElevenLabs Scribe only (OpenAI whisper-1 retires
// 2027-02-26 and its replacement returns no timestamps).
export type TranscriptionPreferenceProvider = 'elevenlabs' | 'stage5';
// Dubbing is ElevenLabs-only (OpenAI TTS retires 2027-01-06).
export type DubbingPreferenceProvider = 'elevenlabs' | 'stage5';
export type DubbingCreditProvider = 'elevenlabs';
export type RuntimeProvider = 'stage5' | 'openai' | 'anthropic' | 'elevenlabs';

export type ByoRuntimeState = {
  useApiKeysMode: boolean;
  byoUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  stage5AnthropicReviewAvailable: boolean;
  useByo: boolean;
  useByoAnthropic: boolean;
  useByoElevenLabs: boolean;
  keyPresent: boolean;
  anthropicKeyPresent: boolean;
  elevenLabsKeyPresent: boolean;
  preferClaudeTranslation: boolean;
  preferClaudeReview: boolean;
  preferClaudeSummary: boolean;
  preferredTranscriptionProvider: TranscriptionPreferenceProvider;
  preferredDubbingProvider: DubbingPreferenceProvider;
  stage5DubbingTtsProvider: DubbingCreditProvider;
};

export function hasAnyByoEntitlementUnlocked(
  state: Pick<
    ByoRuntimeState,
    'byoUnlocked' | 'byoAnthropicUnlocked' | 'byoElevenLabsUnlocked'
  >
): boolean {
  return Boolean(
    state.byoUnlocked ||
    state.byoAnthropicUnlocked ||
    state.byoElevenLabsUnlocked
  );
}

/**
 * The paid Stage5 BYO bundle is keyed off the OpenAI entitlement.
 * Legacy partial entitlements (for example Anthropic-only) unlock
 * provider-specific settings, but they should not hide the upgrade CTA.
 */
export function hasFullByoBundleUnlocked(
  state: Pick<ByoRuntimeState, 'byoUnlocked'>
): boolean {
  return Boolean(state.byoUnlocked);
}

export function hasOpenAiByoConfigured(
  state: Pick<ByoRuntimeState, 'byoUnlocked' | 'keyPresent'>
): boolean {
  return Boolean(state.byoUnlocked && state.keyPresent);
}

export function hasAnthropicByoConfigured(
  state: Pick<ByoRuntimeState, 'byoAnthropicUnlocked' | 'anthropicKeyPresent'>
): boolean {
  return Boolean(state.byoAnthropicUnlocked && state.anthropicKeyPresent);
}

export function hasElevenLabsByoConfigured(
  state: Pick<ByoRuntimeState, 'byoElevenLabsUnlocked' | 'elevenLabsKeyPresent'>
): boolean {
  return Boolean(state.byoElevenLabsUnlocked && state.elevenLabsKeyPresent);
}

export function hasByoTranslationConfiguredCoverage(
  state: Pick<
    ByoRuntimeState,
    | 'byoUnlocked'
    | 'byoAnthropicUnlocked'
    | 'keyPresent'
    | 'anthropicKeyPresent'
  >
): boolean {
  return Boolean(
    hasOpenAiByoConfigured(state) || hasAnthropicByoConfigured(state)
  );
}

/**
 * Audio (transcription and dubbing) is ElevenLabs-only, so only an
 * ElevenLabs key covers it. An OpenAI key no longer does (Whisper and
 * OpenAI TTS are retired).
 */
export function hasByoAudioConfiguredCoverage(
  state: Pick<ByoRuntimeState, 'byoElevenLabsUnlocked' | 'elevenLabsKeyPresent'>
): boolean {
  return hasElevenLabsByoConfigured(state);
}

/**
 * API key mode can be turned on with translation coverage (OpenAI or
 * Anthropic). Audio coverage is not required: without an ElevenLabs key,
 * transcription and dubbing show a blocked state that explains what is
 * missing, while translation keeps using the user's keys. (Requiring
 * ElevenLabs here would silently switch OpenAI-only users out of API key
 * mode now that an OpenAI key cannot transcribe.)
 */
export function hasApiKeyModeConfiguredCoverage(
  state: Pick<
    ByoRuntimeState,
    | 'byoUnlocked'
    | 'byoAnthropicUnlocked'
    | 'byoElevenLabsUnlocked'
    | 'keyPresent'
    | 'anthropicKeyPresent'
    | 'elevenLabsKeyPresent'
  >
): boolean {
  return hasByoTranslationConfiguredCoverage(state);
}

export function hasOpenAiByoAvailable(
  state: Pick<
    ByoRuntimeState,
    'useApiKeysMode' | 'useByo' | 'byoUnlocked' | 'keyPresent'
  >
): boolean {
  return Boolean(
    state.useApiKeysMode && state.useByo && hasOpenAiByoConfigured(state)
  );
}

export function hasAnthropicByoAvailable(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'useByoAnthropic'
    | 'byoAnthropicUnlocked'
    | 'anthropicKeyPresent'
  >
): boolean {
  return Boolean(
    state.useApiKeysMode &&
    state.useByoAnthropic &&
    hasAnthropicByoConfigured(state)
  );
}

export function hasElevenLabsByoAvailable(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'useByoElevenLabs'
    | 'byoElevenLabsUnlocked'
    | 'elevenLabsKeyPresent'
  >
): boolean {
  return Boolean(
    state.useApiKeysMode &&
    state.useByoElevenLabs &&
    hasElevenLabsByoConfigured(state)
  );
}

export function hasApiKeyModeActiveCoverage(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'byoUnlocked'
    | 'byoAnthropicUnlocked'
    | 'byoElevenLabsUnlocked'
    | 'useByo'
    | 'useByoAnthropic'
    | 'useByoElevenLabs'
    | 'keyPresent'
    | 'anthropicKeyPresent'
    | 'elevenLabsKeyPresent'
  >
): boolean {
  // Translation coverage only; see hasApiKeyModeConfiguredCoverage.
  return Boolean(
    hasOpenAiByoAvailable(state) || hasAnthropicByoAvailable(state)
  );
}

/** Normalize a stored transcription preference ('openai' is legacy Whisper). */
export function normalizeTranscriptionPreference(
  value: unknown
): TranscriptionPreferenceProvider {
  return value === 'stage5' ? 'stage5' : 'elevenlabs';
}

type TranscriptionRuntimeState = Pick<
  ByoRuntimeState,
  | 'useApiKeysMode'
  | 'byoElevenLabsUnlocked'
  | 'elevenLabsKeyPresent'
  | 'useByoElevenLabs'
> & {
  // Accepts a legacy 'openai' value from older stores; treated as 'elevenlabs'.
  preferredTranscriptionProvider: TranscriptionPreferenceProvider | 'openai';
};

/**
 * Transcription is ElevenLabs Scribe only: BYO ElevenLabs when available,
 * otherwise Stage5 credits (also Scribe). An OpenAI key never routes
 * transcription. Mirrors resolveTranscriptionRoute in
 * packages/main/services/transcription-provider-routing.ts.
 */
export function resolveTranscriptionProvider(
  state: TranscriptionRuntimeState
): 'elevenlabs' | 'stage5' {
  if (
    normalizeTranscriptionPreference(state.preferredTranscriptionProvider) ===
      'stage5' &&
    !state.useApiKeysMode
  ) {
    return 'stage5';
  }
  return hasElevenLabsByoAvailable(state) ? 'elevenlabs' : 'stage5';
}

export type TranscriptionActionState =
  | { kind: 'byo' }
  | { kind: 'credits' }
  | { kind: 'blocked'; blocker: ApiKeyModeTranscriptionBlocker };

/**
 * What a transcription action (Transcribe / Translate from scratch /
 * Generate) should do: 'byo' = the user's ElevenLabs key, 'credits' = Stage5
 * credits, 'blocked' = API key mode without a usable ElevenLabs key, so the
 * request must not be sent.
 */
export function getTranscriptionActionState(
  state: TranscriptionRuntimeState
): TranscriptionActionState {
  if (resolveTranscriptionProvider(state) === 'elevenlabs') {
    return { kind: 'byo' };
  }
  if (!state.useApiKeysMode) return { kind: 'credits' };
  return {
    kind: 'blocked',
    blocker:
      getApiKeyModeTranscriptionBlocker({
        elevenLabsUnlocked: state.byoElevenLabsUnlocked,
        elevenLabsToggleEnabled: state.useByoElevenLabs,
        elevenLabsKeyPresent: state.elevenLabsKeyPresent,
      }) ?? 'elevenlabs-key-missing',
  };
}

export function isTranscriptionBlockedInApiKeyMode(
  state: TranscriptionRuntimeState
): boolean {
  return getTranscriptionActionState(state).kind === 'blocked';
}

/**
 * Dubbing is ElevenLabs-only: BYO ElevenLabs when available, otherwise Stage5
 * credits (also ElevenLabs). An OpenAI key never routes dubbing. Mirrors
 * resolveDubbingRoute in packages/main/services/dubbing-provider-routing.ts.
 */
export function resolveDubbingProvider(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'byoElevenLabsUnlocked'
    | 'elevenLabsKeyPresent'
    | 'useByoElevenLabs'
    | 'preferredDubbingProvider'
  >
): 'elevenlabs' | 'stage5' {
  if (state.preferredDubbingProvider === 'stage5' && !state.useApiKeysMode) {
    return 'stage5';
  }
  return hasElevenLabsByoAvailable(state) ? 'elevenlabs' : 'stage5';
}

/**
 * API key mode never spends Stage5 credits, so dubbing there needs a usable
 * BYO ElevenLabs key. True when dubbing would be blocked.
 */
export function isDubbingBlockedInApiKeyMode(
  state: Parameters<typeof resolveDubbingProvider>[0]
): boolean {
  return getDubbingActionState(state).kind === 'blocked';
}

export function resolveTranslationDraftProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  const hasOpenAi = hasOpenAiByoAvailable(state);
  const hasAnthropic = hasAnthropicByoAvailable(state);

  if (state.preferClaudeTranslation && hasAnthropic) {
    return 'anthropic';
  }
  if (hasOpenAi) {
    return 'openai';
  }
  if (hasAnthropic) {
    return 'anthropic';
  }
  return 'stage5';
}

export function resolveTranslationDraftModel(state: ByoRuntimeState): string {
  return resolveTranslationDraftProvider(state) === 'anthropic'
    ? AI_MODELS.CLAUDE_SONNET
    : AI_MODELS.GPT;
}

export function resolveTranslationReviewProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  if (!state.useApiKeysMode) {
    return resolveStage5TranslationReviewProvider(state);
  }

  return resolveByoTranslationReviewProvider(state);
}

function resolveStage5TranslationReviewProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  const hasOpenAi = hasOpenAiByoAvailable(state);
  const hasAnthropic = hasAnthropicByoAvailable(state);

  if (state.preferClaudeReview) {
    return hasAnthropic ? 'anthropic' : 'stage5';
  }

  return hasOpenAi ? 'openai' : 'stage5';
}

function resolveByoTranslationReviewProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  const hasOpenAi = hasOpenAiByoAvailable(state);
  const hasAnthropic = hasAnthropicByoAvailable(state);

  if (state.preferClaudeReview && hasAnthropic) {
    return 'anthropic';
  }
  if (!state.preferClaudeReview && hasOpenAi) {
    return 'openai';
  }
  if (hasAnthropic) {
    return 'anthropic';
  }
  if (hasOpenAi) {
    return 'openai';
  }
  return 'stage5';
}

export function resolveTranslationReviewModel(state: ByoRuntimeState): {
  model: string;
  reasoning?: { effort: 'high' };
} {
  const provider = resolveTranslationReviewProvider(state);

  if (provider === 'anthropic') {
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  if (provider === 'openai') {
    return { model: STAGE5_REVIEW_TRANSLATION_MODEL };
  }

  return resolveStage5TranslationReviewModel(state);
}

export function resolveEffectiveTranslationReviewModel(
  state: ByoRuntimeState
): string {
  return resolveTranslationReviewModel(state).model;
}

function resolveStage5TranslationReviewModel(state: ByoRuntimeState): {
  model: string;
  reasoning?: { effort: 'high' };
} {
  return state.preferClaudeReview
    ? { model: AI_MODELS.CLAUDE_OPUS }
    : { model: STAGE5_REVIEW_TRANSLATION_MODEL };
}

export function resolveSummaryProvider(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'byoUnlocked'
    | 'byoAnthropicUnlocked'
    | 'useByo'
    | 'useByoAnthropic'
    | 'keyPresent'
    | 'anthropicKeyPresent'
    | 'preferClaudeSummary'
  >
): RuntimeProvider {
  const hasOpenAi = hasOpenAiByoAvailable(state);
  const hasAnthropic = hasAnthropicByoAvailable(state);

  if (state.preferClaudeSummary && hasAnthropic) {
    return 'anthropic';
  }
  if (!state.preferClaudeSummary && hasOpenAi) {
    return 'openai';
  }
  if (hasAnthropic) {
    return 'anthropic';
  }
  if (hasOpenAi) {
    return 'openai';
  }
  return 'stage5';
}

export function isSummaryByo(
  state: Pick<
    ByoRuntimeState,
    | 'useApiKeysMode'
    | 'byoUnlocked'
    | 'byoAnthropicUnlocked'
    | 'useByo'
    | 'useByoAnthropic'
    | 'keyPresent'
    | 'anthropicKeyPresent'
    | 'preferClaudeSummary'
  >
): boolean {
  return resolveSummaryProvider(state) !== 'stage5';
}

export function isTranslationByo(state: ByoRuntimeState): boolean {
  return (
    resolveTranslationDraftProvider(state) !== 'stage5' &&
    resolveTranslationReviewProvider(state) !== 'stage5'
  );
}

export function isTranscriptionByo(state: TranscriptionRuntimeState): boolean {
  return resolveTranscriptionProvider(state) !== 'stage5';
}

export type DubbingActionState =
  | { kind: 'byo' }
  | { kind: 'credits' }
  | { kind: 'blocked'; blocker: ApiKeyModeDubbingBlocker };

/**
 * What a dubbing action (Dub button, voice preview) should do:
 * 'byo' = free on the user's ElevenLabs key, 'credits' = priced in Stage5
 * credits, 'blocked' = API key mode without a usable ElevenLabs key, so the
 * request must not be sent.
 */
export function getDubbingActionState(
  state: Parameters<typeof resolveDubbingProvider>[0]
): DubbingActionState {
  if (resolveDubbingProvider(state) === 'elevenlabs') return { kind: 'byo' };
  if (!state.useApiKeysMode) return { kind: 'credits' };
  return {
    kind: 'blocked',
    blocker:
      getApiKeyModeDubbingBlocker({
        elevenLabsUnlocked: state.byoElevenLabsUnlocked,
        elevenLabsToggleEnabled: state.useByoElevenLabs,
        elevenLabsKeyPresent: state.elevenLabsKeyPresent,
      }) ?? 'elevenlabs-key-missing',
  };
}

export function isDubbingByo(
  state: Parameters<typeof resolveDubbingProvider>[0]
): boolean {
  return resolveDubbingProvider(state) !== 'stage5';
}

/** Dubbing always synthesizes (and is priced) with ElevenLabs eleven_v4. */
export function resolveDubbingCreditProvider(
  _state?: unknown
): DubbingCreditProvider {
  return 'elevenlabs';
}
