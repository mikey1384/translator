import {
  getStage5ReviewOption,
} from '../../shared/constants/index.js';

export type ReviewModelConfig = {
  model: string;
  reasoning?: { effort: 'high' };
};

export type TranslationReasoning = {
  effort?: 'low' | 'medium' | 'high';
};

export function resolveStage5TranslationReviewModelConfig({
  prefersClaude,
}: {
  prefersClaude: boolean;
  stage5AnthropicReviewAvailable?: boolean;
}): ReviewModelConfig {
  const openAiReview = getStage5ReviewOption('openai');
  const anthropicReview = getStage5ReviewOption('anthropic');

  return prefersClaude
    ? { model: anthropicReview.model }
    : { model: openAiReview.model };
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
