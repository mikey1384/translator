import {
  getStage5ReviewOption,
  STAGE5_CREDIT_MODELS,
} from '../../shared/constants/index.js';

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
  canUseAnthropicByo,
  canUseOpenAiByo,
}: {
  prefersClaude: boolean;
  canUseAnthropicByo: boolean;
  canUseOpenAiByo: boolean;
}): ReviewModelConfig {
  const openAiReview = getStage5ReviewOption('openai');
  const anthropicReview = getStage5ReviewOption('anthropic');

  if (prefersClaude && canUseAnthropicByo) {
    return { model: anthropicReview.model };
  }

  if (!prefersClaude && canUseOpenAiByo) {
    return { model: openAiReview.model };
  }

  if (canUseOpenAiByo) {
    return { model: openAiReview.model };
  }

  if (canUseAnthropicByo) {
    return { model: anthropicReview.model };
  }

  return prefersClaude
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
