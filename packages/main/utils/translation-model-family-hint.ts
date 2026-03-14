import { normalizeAiModelId } from '../../shared/constants/index.js';

export type TranslationModelFamilyHintSource = 'preference' | 'model';

function isClaudeModel(model: string | undefined): boolean {
  const normalizedModel = normalizeAiModelId(model);
  return Boolean(normalizedModel && normalizedModel.startsWith('claude-'));
}

export function resolveTranslationModelFamilyHint({
  translationPhase,
  model,
  hintSource = 'preference',
  prefersClaudeDraft,
  prefersClaudeReview,
}: {
  translationPhase?: 'draft' | 'review';
  model?: string;
  hintSource?: TranslationModelFamilyHintSource;
  prefersClaudeDraft: boolean;
  prefersClaudeReview: boolean;
}): 'gpt' | 'claude' | undefined {
  if (hintSource === 'model') {
    if (typeof model !== 'string' || model.trim().length === 0) {
      return undefined;
    }
    return isClaudeModel(model) ? 'claude' : 'gpt';
  }

  if (translationPhase === 'review') {
    return prefersClaudeReview ? 'claude' : 'gpt';
  }

  if (translationPhase === 'draft') {
    return prefersClaudeDraft ? 'claude' : 'gpt';
  }

  if (typeof model !== 'string' || model.trim().length === 0) {
    return undefined;
  }

  return isClaudeModel(model) ? 'claude' : 'gpt';
}
