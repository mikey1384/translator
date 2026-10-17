import { refreshStage5CreditsAfterPaidCall } from '../utils/creditRefreshOperations';
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
  // A search spends credits whether it succeeds, fails late or is
  // cancelled, so the balance is re-read once it settles either way.
  return window.electron
    .suggestVideos(request)
    .finally(refreshStage5CreditsAfterPaidCall);
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
