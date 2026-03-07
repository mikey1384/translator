import type {
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
} from '@shared-types/app';

export const VIDEO_SUGGESTION_DEFAULT_COUNTRY = '';
export const VIDEO_SUGGESTION_DEFAULT_RECENCY: VideoSuggestionRecency = 'any';
export const VIDEO_SUGGESTION_DEFAULT_TOPIC = '';
export const VIDEO_SUGGESTION_DEFAULT_CREATOR = '';
export const VIDEO_SUGGESTION_DEFAULT_SUBTOPIC = '';

export function createDefaultVideoSuggestionPreferences(): VideoSuggestionPreferenceSlots {
  return {};
}

export function createDefaultVideoSuggestionLocalPrefs(): {
  country: string;
  recency: VideoSuggestionRecency;
  preferences: VideoSuggestionPreferenceSlots;
} {
  return {
    country: VIDEO_SUGGESTION_DEFAULT_COUNTRY,
    recency: VIDEO_SUGGESTION_DEFAULT_RECENCY,
    preferences: createDefaultVideoSuggestionPreferences(),
  };
}
