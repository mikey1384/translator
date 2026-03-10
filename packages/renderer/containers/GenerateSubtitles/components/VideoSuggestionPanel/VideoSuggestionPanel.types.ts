import type {
  VideoSuggestionContextToggles,
  VideoSuggestionMessage,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionStageKey,
  VideoSuggestionStageState,
} from '@shared-types/app';

export type PipelineStageKey = VideoSuggestionStageKey;
export type PipelineStageState = VideoSuggestionStageState;
export type GenerateSubtitlesWorkspaceTab =
  | 'main'
  | 'history'
  | 'channels';

export type PipelineStageProgress = {
  key: PipelineStageKey;
  index: number;
  state: PipelineStageState;
  outcome: string;
};

export type LocalVideoSuggestionPrefs = {
  country: string;
  recency: VideoSuggestionRecency;
  preferences: VideoSuggestionPreferenceSlots;
  preferenceHistory: {
    topic: string[];
  };
  contextToggles: VideoSuggestionContextToggles;
};

export type VideoSuggestionDownloadHistoryItem = {
  id: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl?: string;
  channel?: string;
  channelUrl?: string;
  durationSec?: number;
  uploadedAt?: string;
  downloadedAtIso: string;
  localPath?: string;
};

export type VideoSuggestionPlannerMessage = Pick<
  VideoSuggestionMessage,
  'role' | 'content'
>;
