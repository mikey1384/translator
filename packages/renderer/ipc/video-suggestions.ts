import type {
  VideoSuggestionChatRequest,
  VideoSuggestionChatResult,
  VideoSuggestionProgress,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';

export function suggestVideos(
  request: VideoSuggestionChatRequest
): Promise<VideoSuggestionChatResult> {
  return window.electron.suggestVideos(request);
}

export function onVideoSuggestionProgress(
  callback: (progress: VideoSuggestionProgress) => void
): () => void {
  return window.electron.onVideoSuggestionProgress(callback);
}

/** Plain yt-dlp YouTube search: no model, no credits. */
export function youtubeQuickSearch(request: {
  query: string;
  maxResults?: number;
  recency?: VideoSuggestionRecency;
}): Promise<{
  success: boolean;
  results?: VideoSuggestionResultItem[];
  error?: string;
}> {
  return window.electron.youtubeQuickSearch(request);
}
