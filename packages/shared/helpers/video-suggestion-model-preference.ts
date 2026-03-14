import {
  AI_MODELS,
  STAGE5_REVIEW_TRANSLATION_MODEL,
  normalizeAiModelId,
} from '../constants';
import type { VideoSuggestionModelPreference } from '@shared-types/app';

export type VideoSuggestionModelPreferenceValue =
  VideoSuggestionModelPreference;
export type Stage5VideoSuggestionMode = 'standard' | 'high';

export const STAGE5_CREDITS_VIDEO_SUGGESTION_DIRECT_MODELS = [
  AI_MODELS.GPT,
  STAGE5_REVIEW_TRANSLATION_MODEL,
] as const;

export const BYO_VIDEO_SUGGESTION_DIRECT_MODELS = [
  ...STAGE5_CREDITS_VIDEO_SUGGESTION_DIRECT_MODELS,
  AI_MODELS.CLAUDE_SONNET,
  AI_MODELS.CLAUDE_OPUS,
] as const;

export type DirectVideoSuggestionModelId =
  (typeof BYO_VIDEO_SUGGESTION_DIRECT_MODELS)[number];
export type LegacyByoVideoSuggestionModel =
  | 'follow-draft'
  | 'follow-review';
export type ByoVideoSuggestionModel =
  | DirectVideoSuggestionModelId
  | LegacyByoVideoSuggestionModel;

export function getSupportedDirectVideoSuggestionModels(
  apiKeyModeEnabled: boolean
): readonly DirectVideoSuggestionModelId[] {
  return apiKeyModeEnabled
    ? BYO_VIDEO_SUGGESTION_DIRECT_MODELS
    : STAGE5_CREDITS_VIDEO_SUGGESTION_DIRECT_MODELS;
}

export type EffectiveVideoSuggestionModelId = DirectVideoSuggestionModelId;

type ResolveVideoSuggestionModelOptions = {
  preference?: VideoSuggestionModelPreferenceValue | null;
  stage5Mode?: Stage5VideoSuggestionMode;
  byoModel?: ByoVideoSuggestionModel | null;
  apiKeyModeEnabled?: boolean;
  translationDraftModel?: string | null;
  translationReviewModel?: string | null;
  availableByoModels?: Array<string | null | undefined>;
};

function isDirectVideoSuggestionModelId(
  value: string
): value is DirectVideoSuggestionModelId {
  return BYO_VIDEO_SUGGESTION_DIRECT_MODELS.includes(
    value as DirectVideoSuggestionModelId
  );
}

function isLegacyByoVideoSuggestionModel(
  value: string
): value is LegacyByoVideoSuggestionModel {
  return value === 'follow-draft' || value === 'follow-review';
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

function resolveStage5CreditModeDirectSelection(
  selected: DirectVideoSuggestionModelId
): DirectVideoSuggestionModelId {
  if (selected === AI_MODELS.CLAUDE_SONNET) {
    return AI_MODELS.GPT;
  }
  if (selected === AI_MODELS.CLAUDE_OPUS) {
    return STAGE5_REVIEW_TRANSLATION_MODEL;
  }
  return selected;
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

export function normalizeStage5VideoSuggestionMode(
  value: unknown,
  fallback: Stage5VideoSuggestionMode = 'standard'
): Stage5VideoSuggestionMode {
  const normalizedText = String(value ?? '')
    .trim()
    .toLowerCase();
  if (normalizedText === 'high') {
    return 'high';
  }
  if (normalizedText === 'standard') {
    return 'standard';
  }

  const normalized = normalizeVideoSuggestionModelPreference(
    value,
    fallback === 'high' ? 'quality' : AI_MODELS.GPT
  );
  return normalized === 'quality' ||
    normalized === STAGE5_REVIEW_TRANSLATION_MODEL ||
    normalized === AI_MODELS.CLAUDE_OPUS
    ? 'high'
    : 'standard';
}

export function normalizeByoVideoSuggestionModel(
  value: unknown,
  fallback: ByoVideoSuggestionModel = AI_MODELS.GPT
): ByoVideoSuggestionModel {
  const normalizedText = String(value ?? '')
    .trim()
    .toLowerCase();
  if (isLegacyByoVideoSuggestionModel(normalizedText)) {
    return normalizedText;
  }

  const normalized = normalizeVideoSuggestionModelPreference(value, fallback);

  if (
    normalized === AI_MODELS.GPT ||
    normalized === STAGE5_REVIEW_TRANSLATION_MODEL ||
    normalized === AI_MODELS.CLAUDE_SONNET ||
    normalized === AI_MODELS.CLAUDE_OPUS
  ) {
    return normalized;
  }

  if (normalized === 'default') {
    return 'follow-draft';
  }
  if (normalized === 'quality') {
    return 'follow-review';
  }

  return normalizeByoVideoSuggestionModel(fallback, AI_MODELS.GPT);
}

export function resolveVideoSuggestionPreferenceForMode({
  apiKeyModeEnabled = false,
  stage5Mode = 'standard',
  byoModel = AI_MODELS.GPT,
}: {
  apiKeyModeEnabled?: boolean;
  stage5Mode?: Stage5VideoSuggestionMode;
  byoModel?: ByoVideoSuggestionModel;
}): VideoSuggestionModelPreferenceValue {
  if (apiKeyModeEnabled) {
    const normalizedByoModel = normalizeByoVideoSuggestionModel(byoModel);
    if (normalizedByoModel === 'follow-draft') {
      return 'default';
    }
    if (normalizedByoModel === 'follow-review') {
      return 'quality';
    }
    return normalizedByoModel;
  }

  return normalizeStage5VideoSuggestionMode(stage5Mode) === 'high'
    ? STAGE5_REVIEW_TRANSLATION_MODEL
    : AI_MODELS.GPT;
}

export function resolveEffectiveVideoSuggestionModel({
  preference,
  stage5Mode,
  byoModel,
  apiKeyModeEnabled = false,
  translationDraftModel,
  translationReviewModel,
  availableByoModels = [],
}: ResolveVideoSuggestionModelOptions): EffectiveVideoSuggestionModelId {
  const selected = normalizeVideoSuggestionModelPreference(
    preference ??
      resolveVideoSuggestionPreferenceForMode({
        apiKeyModeEnabled,
        stage5Mode,
        byoModel: normalizeByoVideoSuggestionModel(byoModel ?? AI_MODELS.GPT),
      })
  );
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

    // Product decision: Stage5 credits mode only supports OpenAI models for
    // video recommendations. Explicit Claude picks map to the nearest OpenAI tier.
    return resolveStage5CreditModeDirectSelection(selected);
  }

  if (selected === 'quality') {
    if (apiKeyModeEnabled) {
      return resolveApiKeyModeVideoSuggestionFallback(
        [normalizedReviewModel, normalizedDraftModel],
        normalizedAvailableByoModels
      );
    }
    return STAGE5_REVIEW_TRANSLATION_MODEL;
  }

  if (apiKeyModeEnabled) {
    return resolveApiKeyModeVideoSuggestionFallback(
      [normalizedDraftModel, normalizedReviewModel],
      normalizedAvailableByoModels
    );
  }

  return normalizedDraftModel;
}
