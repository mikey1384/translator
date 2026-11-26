import {
  AI_MODELS,
  getStage5ReviewOption,
  STAGE5_CREDIT_MODELS,
  type ByoGeminiReviewModel,
} from '../../shared/constants/index.js';
import type { ByoTextProviderPreference } from '../store/settings-schema.js';

export type ReviewModelConfig = {
  model: string;
  reasoning?: { effort: 'high' };
};

export type TranslationReasoning = {
  effort?: 'low' | 'medium' | 'high';
};

// Stage5 credits review on Claude Opus 5.5 (the servers choose it whenever
// Anthropic is available); the review-provider preference applies to API-key
// mode only.
export function resolveStage5TranslationReviewModelConfig(_options: {
  prefersClaude: boolean;
  stage5AnthropicReviewAvailable?: boolean;
}): ReviewModelConfig {
  return { model: STAGE5_CREDIT_MODELS.REVIEW };
}

export function resolveByoTranslationReviewModelConfig({
  prefersClaude,
  preferredProvider,
  canUseAnthropicByo,
  canUseOpenAiByo,
  canUseGeminiByo = false,
  geminiReviewModel = AI_MODELS.GEMINI_NEON,
}: {
  prefersClaude: boolean;
  preferredProvider?: ByoTextProviderPreference;
  canUseAnthropicByo: boolean;
  canUseOpenAiByo: boolean;
  canUseGeminiByo?: boolean;
  geminiReviewModel?: ByoGeminiReviewModel;
}): ReviewModelConfig {
  const openAiReview = getStage5ReviewOption('openai');
  const anthropicReview = getStage5ReviewOption('anthropic');
  const effectivePreference: ByoTextProviderPreference =
    preferredProvider ?? (prefersClaude ? 'anthropic' : 'openai');

  if (effectivePreference === 'gemini' && canUseGeminiByo) {
    return { model: geminiReviewModel };
  }
  if (effectivePreference === 'anthropic' && canUseAnthropicByo) {
    return { model: anthropicReview.model };
  }
  if (effectivePreference === 'openai' && canUseOpenAiByo) {
    return { model: openAiReview.model };
  }

  if (canUseOpenAiByo) {
    return { model: openAiReview.model };
  }
  if (canUseAnthropicByo) {
    return { model: anthropicReview.model };
  }
  if (canUseGeminiByo) {
    return { model: geminiReviewModel };
  }

  if (effectivePreference === 'gemini') {
    return { model: geminiReviewModel };
  }
  return effectivePreference === 'anthropic'
    ? { model: anthropicReview.model }
    : { model: openAiReview.model };
}

export function getStage5TranslationReasoning({
  translationPhase,
  reasoning,
}: {
  translationPhase?: 'draft' | 'review';
  reasoning?: TranslationReasoning;
}): TranslationReasoning | undefined {
  return translationPhase === 'review' ? undefined : reasoning;
}
