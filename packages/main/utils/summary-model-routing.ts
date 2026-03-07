import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
} from '../../shared/constants/index.js';

export type SummaryModelConfig = {
  model: string;
  reasoning?: { effort: 'low' | 'medium' | 'high' };
  provider: 'stage5' | 'openai' | 'anthropic';
};

export function resolveSummaryModelConfig({
  effortLevel,
  prefersClaude,
  canUseAnthropicByo,
  canUseOpenAiByo,
}: {
  effortLevel: 'standard' | 'high';
  prefersClaude: boolean;
  canUseAnthropicByo: boolean;
  canUseOpenAiByo: boolean;
}): SummaryModelConfig {
  if (!canUseAnthropicByo && !canUseOpenAiByo) {
    return effortLevel === 'high'
      ? {
          model: STAGE5_REVIEW_TRANSLATION_MODEL,
          provider: 'stage5',
        }
      : {
          model: AI_MODELS.GPT,
          provider: 'stage5',
        };
  }

  const useAnthropic =
    canUseAnthropicByo && (!canUseOpenAiByo || prefersClaude);

  if (useAnthropic) {
    return effortLevel === 'high'
      ? {
          model: AI_MODELS.CLAUDE_OPUS,
          provider: 'anthropic',
        }
      : {
          model: AI_MODELS.CLAUDE_SONNET,
          provider: 'anthropic',
        };
  }

  return effortLevel === 'high'
    ? {
        model: STAGE5_REVIEW_TRANSLATION_MODEL,
        provider: 'openai',
      }
    : {
        model: AI_MODELS.GPT,
        provider: 'openai',
      };
}
