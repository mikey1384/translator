import { useVideoStore } from '../state/video-store.js';
import { sanitizeVideoSuggestionHistoryPath } from '../../shared/helpers/video-suggestion-sanitize.js';
import { updateMountedUrlDownloadLibraryPaths } from './mounted-download-leases.js';

function collectMountedPaths(): string[] {
  const state = useVideoStore.getState();
  const filePath =
    state.file &&
    typeof state.file === 'object' &&
    'path' in state.file &&
    typeof state.file.path === 'string'
      ? state.file.path
      : '';
  return Array.from(
    new Set(
      [state.path, state.originalPath, state.dubbedVideoPath, filePath]
        .map(value => sanitizeVideoSuggestionHistoryPath(value))
        .filter(Boolean)
    )
  ).sort();
}

function reportMountedPaths(): void {
  updateMountedUrlDownloadLibraryPaths(collectMountedPaths());
}

useVideoStore.subscribe(reportMountedPaths);
reportMountedPaths();
