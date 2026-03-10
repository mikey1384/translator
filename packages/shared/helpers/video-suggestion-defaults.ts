import type {
  VideoSuggestionContextToggles,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
} from '@shared-types/app';

export const VIDEO_SUGGESTION_DEFAULT_COUNTRY = '';
export const VIDEO_SUGGESTION_DEFAULT_RECENCY: VideoSuggestionRecency = 'any';
export const VIDEO_SUGGESTION_DEFAULT_TOPIC = '';
export const VIDEO_SUGGESTION_DEFAULT_CONTEXT_TOGGLES: VideoSuggestionContextToggles =
  {
    includeDownloadHistory: true,
    includeWatchedChannels: true,
  };

export function createDefaultVideoSuggestionPreferences(): VideoSuggestionPreferenceSlots {
  return {};
}

export function createDefaultVideoSuggestionLocalPrefs(): {
  country: string;
  recency: VideoSuggestionRecency;
  preferences: VideoSuggestionPreferenceSlots;
  preferenceHistory: {
    topic: string[];
  };
  contextToggles: VideoSuggestionContextToggles;
} {
  return {
    country: VIDEO_SUGGESTION_DEFAULT_COUNTRY,
    recency: VIDEO_SUGGESTION_DEFAULT_RECENCY,
    preferences: createDefaultVideoSuggestionPreferences(),
    preferenceHistory: {
      topic: [],
    },
    contextToggles: {
      ...VIDEO_SUGGESTION_DEFAULT_CONTEXT_TOGGLES,
    },
  };
}
