import {
  normalizeVideoSuggestionModelPreference,
  type VideoSuggestionModelPreferenceValue,
} from '../services/video-suggestion-model-preference.js';
import { isVideoSuggestionRecency } from '../../shared/helpers/video-suggestion-sanitize.js';
import {
  VIDEO_SUGGESTION_DEFAULT_COUNTRY,
  VIDEO_SUGGESTION_DEFAULT_RECENCY,
  VIDEO_SUGGESTION_DEFAULT_TOPIC,
} from '../../shared/helpers/video-suggestion-defaults.js';
import type { VideoSuggestionRecency } from '@shared-types/app';

export type TranscriptionProviderPreference =
  | 'elevenlabs'
  | 'openai'
  | 'stage5';
export type DubbingProviderPreference = 'elevenlabs' | 'openai' | 'stage5';
export type Stage5DubbingTtsProviderPreference = 'openai' | 'elevenlabs';

type PostInstallNotice = {
  targetVersion: string;
  releaseName?: string;
  releaseDate?: string;
  notes: string;
  preparedAt: string;
};

export type AppSettingsSchema = {
  pendingPostInstallNotice: PostInstallNotice | null;
  app_language_preference: string;
  subtitleTargetLanguage: string;
  apiKey: string | null;
  anthropicApiKey: string | null;
  elevenLabsApiKey: string | null;
  videoPlaybackPositions: Record<string, number>;
  byoOpenAiUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  stage5AnthropicReviewAvailable: boolean;
  useByoOpenAi: boolean;
  useByoAnthropic: boolean;
  useByoElevenLabs: boolean;
  // Legacy persisted key for API key mode. Keep the storage key stable to
  // preserve existing user profiles without a migration.
  useByoMaster: boolean;
  preferClaudeTranslation: boolean;
  preferClaudeReview: boolean;
  preferClaudeSummary: boolean;
  videoSuggestionModelPreference: VideoSuggestionModelPreferenceValue;
  videoSuggestionTargetCountry: string;
  videoSuggestionRecency: VideoSuggestionRecency;
  videoSuggestionPreferenceTopic: string;
  preferredTranscriptionProvider: TranscriptionProviderPreference;
  preferredDubbingProvider: DubbingProviderPreference;
  stage5DubbingTtsProvider: Stage5DubbingTtsProviderPreference;
};

export const APP_SETTINGS_DEFAULTS: AppSettingsSchema = {
  pendingPostInstallNotice: null,
  app_language_preference: 'en',
  subtitleTargetLanguage: 'original',
  apiKey: null,
  anthropicApiKey: null,
  elevenLabsApiKey: null,
  videoPlaybackPositions: {},
  byoOpenAiUnlocked: false,
  byoAnthropicUnlocked: false,
  byoElevenLabsUnlocked: false,
  stage5AnthropicReviewAvailable: false,
  useByoOpenAi: false,
  useByoAnthropic: false,
  useByoElevenLabs: false,
  useByoMaster: false,
  preferClaudeTranslation: false,
  preferClaudeReview: false,
  preferClaudeSummary: true,
  videoSuggestionModelPreference: 'default',
  videoSuggestionTargetCountry: VIDEO_SUGGESTION_DEFAULT_COUNTRY,
  videoSuggestionRecency: VIDEO_SUGGESTION_DEFAULT_RECENCY,
  videoSuggestionPreferenceTopic: VIDEO_SUGGESTION_DEFAULT_TOPIC,
  preferredTranscriptionProvider: 'elevenlabs',
  preferredDubbingProvider: 'openai',
  stage5DubbingTtsProvider: 'openai',
};

export function normalizeVideoSuggestionModelPreferenceSetting(
  value: unknown,
  fallback: VideoSuggestionModelPreferenceValue = APP_SETTINGS_DEFAULTS.videoSuggestionModelPreference
): VideoSuggestionModelPreferenceValue {
  return normalizeVideoSuggestionModelPreference(value, fallback);
}

export function normalizeVideoSuggestionRecencySetting(
  value: unknown,
  fallback: VideoSuggestionRecency = APP_SETTINGS_DEFAULTS.videoSuggestionRecency
): VideoSuggestionRecency {
  const normalized = String(value ?? '').trim();
  return isVideoSuggestionRecency(normalized) ? normalized : fallback;
}

export function normalizeTranscriptionProviderSetting(
  value: unknown,
  fallback: TranscriptionProviderPreference = APP_SETTINGS_DEFAULTS.preferredTranscriptionProvider
): TranscriptionProviderPreference {
  return value === 'elevenlabs' || value === 'openai' || value === 'stage5'
    ? value
    : fallback;
}

export function normalizeDubbingProviderSetting(
  value: unknown,
  fallback: DubbingProviderPreference = APP_SETTINGS_DEFAULTS.preferredDubbingProvider
): DubbingProviderPreference {
  return value === 'elevenlabs' || value === 'openai' || value === 'stage5'
    ? value
    : fallback;
}

export function normalizeStage5DubbingTtsProviderSetting(
  value: unknown,
  fallback: Stage5DubbingTtsProviderPreference = APP_SETTINGS_DEFAULTS.stage5DubbingTtsProvider
): Stage5DubbingTtsProviderPreference {
  return value === 'openai' || value === 'elevenlabs' ? value : fallback;
}

export type { VideoSuggestionModelPreferenceValue };
export type { VideoSuggestionRecency };
