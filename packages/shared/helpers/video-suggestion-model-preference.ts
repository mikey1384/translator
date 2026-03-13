import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  normalizeAiModelId,
} from '../constants';
import type { VideoSuggestionModelPreference } from '@shared-types/app';

export type VideoSuggestionModelPreferenceValue =
  VideoSuggestionModelPreference;

export type DirectVideoSuggestionModelId =
  | typeof AI_MODELS.GPT
  | typeof STAGE5_REVIEW_TRANSLATION_MODEL
  | typeof AI_MODELS.CLAUDE_SONNET
  | typeof AI_MODELS.CLAUDE_OPUS;

export type EffectiveVideoSuggestionModelId = DirectVideoSuggestionModelId;

type ResolveVideoSuggestionModelOptions = {
  preference?: VideoSuggestionModelPreferenceValue | null;
  apiKeyModeEnabled?: boolean;
  translationDraftModel?: string | null;
  translationReviewModel?: string | null;
  availableByoModels?: Array<string | null | undefined>;
};

function isDirectVideoSuggestionModelId(
  value: string
): value is DirectVideoSuggestionModelId {
  return (
    value === AI_MODELS.GPT ||
    value === STAGE5_REVIEW_TRANSLATION_MODEL ||
    value === AI_MODELS.CLAUDE_SONNET ||
    value === AI_MODELS.CLAUDE_OPUS
  );
}

function isEffectiveVideoSuggestionModelId(
  value: string
): value is EffectiveVideoSuggestionModelId {
  return isDirectVideoSuggestionModelId(value);
}

function normalizeDirectVideoSuggestionModel(
  value: string | null | undefined
): DirectVideoSuggestionModelId | null {
  const normalized = normalizeAiModelId((value || '').trim());
  return isDirectVideoSuggestionModelId(normalized) ? normalized : null;
}

function normalizeEffectiveVideoSuggestionModel(
  value: string | null | undefined
): EffectiveVideoSuggestionModelId | null {
  const normalized = normalizeAiModelId((value || '').trim());
  return isEffectiveVideoSuggestionModelId(normalized) ? normalized : null;
}

function uniqueDirectModels(
  values: Array<string | null | undefined>
): DirectVideoSuggestionModelId[] {
  const seen = new Set<DirectVideoSuggestionModelId>();
  const models: DirectVideoSuggestionModelId[] = [];

  for (const value of values) {
    const normalized = normalizeDirectVideoSuggestionModel(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    models.push(normalized);
  }

  return models;
}

export function normalizeVideoSuggestionModelPreference(
  value: unknown,
  fallback: VideoSuggestionModelPreferenceValue = 'default'
): VideoSuggestionModelPreferenceValue {
  const normalized = normalizeAiModelId(String(value || fallback))
    .trim()
    .toLowerCase();

  if (normalized === 'quality') return 'quality';
  if (normalized === AI_MODELS.GPT || normalized === 'auto') {
    return AI_MODELS.GPT;
  }
  if (normalized === STAGE5_REVIEW_TRANSLATION_MODEL) {
    return STAGE5_REVIEW_TRANSLATION_MODEL;
  }
  if (normalized === AI_MODELS.CLAUDE_SONNET) {
    return AI_MODELS.CLAUDE_SONNET;
  }
  if (
    normalized === AI_MODELS.CLAUDE_OPUS ||
    normalized.startsWith('claude-opus')
  ) {
    return AI_MODELS.CLAUDE_OPUS;
  }
  if (normalized === 'default') {
    return 'default';
  }
  return fallback;
}

function resolveApiKeyModeVideoSuggestionFallback(
  candidateModels: Array<string | null | undefined>,
  availableByoModels: DirectVideoSuggestionModelId[]
): DirectVideoSuggestionModelId {
  const candidates = uniqueDirectModels([
    ...candidateModels,
    AI_MODELS.GPT,
    STAGE5_REVIEW_TRANSLATION_MODEL,
    AI_MODELS.CLAUDE_SONNET,
    AI_MODELS.CLAUDE_OPUS,
  ]);

  const available = candidates.find(model => availableByoModels.includes(model));
  return available || AI_MODELS.GPT;
}

export function resolveEffectiveVideoSuggestionModel({
  preference,
  apiKeyModeEnabled = false,
  translationDraftModel,
  translationReviewModel,
  availableByoModels = [],
}: ResolveVideoSuggestionModelOptions): EffectiveVideoSuggestionModelId {
  const selected = normalizeVideoSuggestionModelPreference(preference);
  const normalizedDraftModel =
    normalizeEffectiveVideoSuggestionModel(translationDraftModel) || AI_MODELS.GPT;
  const normalizedReviewModel =
    normalizeEffectiveVideoSuggestionModel(translationReviewModel) ||
    STAGE5_REVIEW_TRANSLATION_MODEL;
  const normalizedAvailableByoModels = uniqueDirectModels(availableByoModels);

  if (
    selected === AI_MODELS.GPT ||
    selected === STAGE5_REVIEW_TRANSLATION_MODEL ||
    selected === AI_MODELS.CLAUDE_SONNET ||
    selected === AI_MODELS.CLAUDE_OPUS
  ) {
    if (apiKeyModeEnabled) {
      return resolveApiKeyModeVideoSuggestionFallback(
        selected === STAGE5_REVIEW_TRANSLATION_MODEL ||
          selected === AI_MODELS.CLAUDE_OPUS
          ? [selected, normalizedReviewModel, normalizedDraftModel]
          : [selected, normalizedDraftModel, normalizedReviewModel],
        normalizedAvailableByoModels
      );
    }
    return selected === STAGE5_REVIEW_TRANSLATION_MODEL ||
      selected === AI_MODELS.CLAUDE_OPUS
      ? normalizedReviewModel
      : normalizedDraftModel;
  }

  if (selected === 'quality') {
    if (apiKeyModeEnabled) {
      return resolveApiKeyModeVideoSuggestionFallback(
        [normalizedReviewModel, normalizedDraftModel],
        normalizedAvailableByoModels
      );
    }
    return normalizedReviewModel;
  }

  if (apiKeyModeEnabled) {
    return resolveApiKeyModeVideoSuggestionFallback(
      [normalizedDraftModel, normalizedReviewModel],
      normalizedAvailableByoModels
    );
  }

  return normalizedDraftModel;
}
