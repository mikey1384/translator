import type {
  VideoSuggestionChatRequest,
  VideoSuggestionChatResult,
  VideoSuggestionProgress,
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
