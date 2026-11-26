import {
  AI_MODELS,
  STAGE5_CREDIT_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  type ByoGeminiSummaryModel,
} from '../../shared/constants/index.js';
import type { ByoTextProviderPreference } from '../store/settings-schema.js';

export type SummaryModelConfig = {
  model: string;
  reasoning?: { effort: 'low' | 'medium' | 'high' };
  provider: 'stage5' | 'openai' | 'anthropic' | 'gemini';
};

export function resolveSummaryModelConfig({
  effortLevel,
  prefersClaude,
  preferredProvider,
  canUseAnthropicByo,
  canUseOpenAiByo,
  canUseGeminiByo = false,
  geminiSummaryModel = AI_MODELS.GEMINI_NEON,
}: {
  effortLevel: 'standard' | 'high';
  prefersClaude: boolean;
  preferredProvider?: ByoTextProviderPreference;
  canUseAnthropicByo: boolean;
  canUseOpenAiByo: boolean;
  canUseGeminiByo?: boolean;
  geminiSummaryModel?: ByoGeminiSummaryModel;
}): SummaryModelConfig {
  // Stage5 credits summarize on Claude: Sonnet 5.5 (standard), Opus 5.5 (high).
  if (!canUseAnthropicByo && !canUseOpenAiByo && !canUseGeminiByo) {
    return effortLevel === 'high'
      ? {
          model: STAGE5_CREDIT_MODELS.HIGH,
          provider: 'stage5',
        }
      : {
          model: STAGE5_CREDIT_MODELS.STANDARD,
          provider: 'stage5',
        };
  }

  const effectivePreference: ByoTextProviderPreference =
    preferredProvider ?? (prefersClaude ? 'anthropic' : 'openai');

  const geminiModel =
    effortLevel === 'standard'
      ? AI_MODELS.GEMINI_HYDROGEN
      : geminiSummaryModel === AI_MODELS.GEMINI_CARBON
        ? AI_MODELS.GEMINI_CARBON
        : AI_MODELS.GEMINI_NEON;

  if (effectivePreference === 'gemini' && canUseGeminiByo) {
    return {
      model: geminiModel,
      provider: 'gemini',
    };
  }

  if (effectivePreference === 'anthropic' && canUseAnthropicByo) {
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

  if (effectivePreference === 'openai' && canUseOpenAiByo) {
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

  if (canUseAnthropicByo) {
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

  if (canUseOpenAiByo) {
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

  return {
    model: geminiModel,
    provider: 'gemini',
  };
}
