import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.js';

export type ReviewModelConfig = {
  model: string;
  reasoning?: { effort: 'high' };
};

export type TranslationReasoning = {
  effort?: 'low' | 'medium' | 'high';
};

export function resolveTranslationReviewModelConfig({
  prefersClaude,
  canUseAnthropicByo,
  canUseOpenAiByo,
}: {
  prefersClaude: boolean;
  canUseAnthropicByo: boolean;
  canUseOpenAiByo: boolean;
}): ReviewModelConfig {
  if (!canUseAnthropicByo && !canUseOpenAiByo) {
    return { model: STAGE5_REVIEW_TRANSLATION_MODEL };
  }

  if (prefersClaude && canUseAnthropicByo) {
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  if (!prefersClaude && canUseOpenAiByo) {
    return { model: STAGE5_REVIEW_TRANSLATION_MODEL };
  }

  if (canUseAnthropicByo) {
    return { model: AI_MODELS.CLAUDE_OPUS };
  }

  return { model: STAGE5_REVIEW_TRANSLATION_MODEL };
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
