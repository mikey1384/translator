import type {
  CleanupAcceptedProcessedUrlOptions,
  ProcessUrlOptions,
  ProcessUrlPendingResultAction,
  SetMountedUrlDownloadLibraryPathsOptions,
  VideoSuggestionDownloadHistoryMutationRequest,
  VideoSuggestionDownloadHistoryMutationResult,
  UrlProgressCallback,
  ProcessUrlResult,
} from '@shared-types/app';

export function download<T extends ProcessUrlOptions>(
  options: T
): Promise<ProcessUrlResult> {
  return window.electron.processUrl(options);
}

export const downloadUrl = (o: ProcessUrlOptions) => download(o);

export function acceptProcessedUrl(
  operationId: string
): Promise<ProcessUrlPendingResultAction> {
  return window.electron.acceptProcessedUrl(operationId);
}

export function discardProcessedUrl(
  operationId: string
): Promise<ProcessUrlPendingResultAction> {
  return window.electron.discardProcessedUrl(operationId);
}

export function cleanupAcceptedProcessedUrl(
  options: CleanupAcceptedProcessedUrlOptions
): Promise<ProcessUrlPendingResultAction> {
  return window.electron.cleanupAcceptedProcessedUrl(options);
}

export function mutateVideoSuggestionDownloadHistory(
  request: VideoSuggestionDownloadHistoryMutationRequest
): Promise<VideoSuggestionDownloadHistoryMutationResult> {
  return window.electron.mutateVideoSuggestionDownloadHistory(request);
}

export function setMountedUrlDownloadLibraryPaths(
  options: SetMountedUrlDownloadLibraryPathsOptions
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setMountedUrlDownloadLibraryPaths(options);
}

export function onProgress(callback: UrlProgressCallback): () => void {
  return window.electron.onProcessUrlProgress(callback);
}
