export function canDeleteDownloadHistoryFile(options: {
  managedLocalFile: boolean;
  canPlay: boolean;
}): boolean {
  return options.managedLocalFile && options.canPlay;
}

export function historyRemovalDeletesManagedFile(
  managedLocalFile: boolean
): boolean {
  return managedLocalFile;
}

export function shouldSyncDownloadHistoryMutationResult(
  result: VideoSuggestionDownloadHistoryMutationResult
): boolean {
  return result.success || Boolean(result.deletion);
}
import type { VideoSuggestionDownloadHistoryMutationResult } from '@shared-types/app';
