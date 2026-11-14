import { useSubStore, useVideoStore } from '../state';
import {
  downloadHandoffKey,
  useDownloadHandoffStore,
} from '../state/download-handoff-store';
import { pathsMatch } from './saveVideo';

/** The handoff key of what is open in the workspace. */
export function currentDownloadHandoffKey(): string | null {
  return downloadHandoffKey({ sourceUrl: useVideoStore.getState().sourceUrl });
}

/**
 * "Download only" saved a copy: put "Saved to …" on the handoff card when
 * the card is up for that very video. Returns false (keep the native
 * confirmation) when it isn't, so a save is never left unconfirmed.
 */
export function confirmSaveInDownloadHandoff(
  downloadedPath: string,
  savedPath: string
): boolean {
  const video = useVideoStore.getState();
  if (!pathsMatch(video.originalPath ?? video.path, downloadedPath)) {
    return false;
  }
  const key = currentDownloadHandoffKey();
  const store = useDownloadHandoffStore.getState();
  if (!key || store.items[key]?.status !== 'ready') return false;
  if (useSubStore.getState().order.length > 0) return false;
  store.setSavedPath(key, savedPath);
  return true;
}
