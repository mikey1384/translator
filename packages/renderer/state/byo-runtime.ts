import { AI_MODELS, STAGE5_REVIEW_TRANSLATION_MODEL } from '../../shared/constants';

export type ByoPreferenceProvider = 'elevenlabs' | 'openai' | 'stage5';
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
  preferredTranscriptionProvider: ByoPreferenceProvider;
  preferredDubbingProvider: ByoPreferenceProvider;
  stage5DubbingTtsProvider: 'openai' | 'elevenlabs';
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

export function hasByoAudioConfiguredCoverage(
  state: Pick<
    ByoRuntimeState,
    | 'byoUnlocked'
    | 'byoElevenLabsUnlocked'
    | 'keyPresent'
    | 'elevenLabsKeyPresent'
  >
): boolean {
  return Boolean(
    hasOpenAiByoConfigured(state) || hasElevenLabsByoConfigured(state)
  );
}

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
  return Boolean(
    hasByoTranslationConfiguredCoverage(state) &&
    hasByoAudioConfiguredCoverage(state)
  );
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
  return Boolean(
    (hasOpenAiByoAvailable(state) || hasAnthropicByoAvailable(state)) &&
    (hasOpenAiByoAvailable(state) || hasElevenLabsByoAvailable(state))
  );
}

function resolveProviderByPreference(
  preference: ByoPreferenceProvider,
  state: ByoRuntimeState,
  defaultOrder: Array<'elevenlabs' | 'openai'>
): RuntimeProvider {
  const hasOpenAi = hasOpenAiByoAvailable(state);
  const hasElevenLabs = hasElevenLabsByoAvailable(state);

  if (preference === 'stage5') {
    if (!state.useApiKeysMode) {
      return 'stage5';
    }
  }
  if (preference === 'elevenlabs') {
    if (hasElevenLabs) return 'elevenlabs';
    if (hasOpenAi) return 'openai';
    return 'stage5';
  }
  if (preference === 'openai') {
    if (hasOpenAi) return 'openai';
    if (hasElevenLabs) return 'elevenlabs';
    return 'stage5';
  }
  for (const provider of defaultOrder) {
    if (provider === 'elevenlabs' && hasElevenLabs) return 'elevenlabs';
    if (provider === 'openai' && hasOpenAi) return 'openai';
  }
  return 'stage5';
}

export function resolveTranscriptionProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  return resolveProviderByPreference(
    state.preferredTranscriptionProvider,
    state,
    ['elevenlabs', 'openai']
  );
}

export function resolveDubbingProvider(
  state: ByoRuntimeState
): RuntimeProvider {
  return resolveProviderByPreference(state.preferredDubbingProvider, state, [
    'openai',
    'elevenlabs',
  ]);
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
  return state.preferClaudeReview && state.stage5AnthropicReviewAvailable
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

export function isTranscriptionByo(state: ByoRuntimeState): boolean {
  return resolveTranscriptionProvider(state) !== 'stage5';
}

export function isDubbingByo(state: ByoRuntimeState): boolean {
  return resolveDubbingProvider(state) !== 'stage5';
}

export function resolveDubbingCreditProvider(
  state: ByoRuntimeState
): 'openai' | 'elevenlabs' {
  const provider = resolveDubbingProvider(state);
  if (provider === 'stage5') {
    return state.stage5DubbingTtsProvider;
  }
  return provider === 'elevenlabs' ? 'elevenlabs' : 'openai';
}
