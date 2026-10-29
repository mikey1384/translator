import { canonicalVideoSourceKey } from '../../shared/helpers/video-url.js';
import { sanitizeVideoSuggestionHistoryPath } from '../../shared/helpers/video-suggestion-sanitize.js';

type HistoryEntry = {
  sourceUrl?: string;
  localPath?: string;
  downloadedAtIso?: string;
  title?: string;
  webVideoId?: string;
};

/**
 * Download-history entries for the same video as `url` (youtu.be and
 * watch?v= links, tracking parameters and hosts all count as one video) that
 * name a local file, newest first. The caller checks which file still exists.
 */
export function historyCopiesForUrl<T extends HistoryEntry>(
  history: readonly T[],
  url: string,
  webVideoId?: string
): Array<T & { localPath: string }> {
  const key = canonicalVideoSourceKey(url);
  if (!key) return [];
  return history
    .filter(
      (item): item is T & { localPath: string } =>
        Boolean(sanitizeVideoSuggestionHistoryPath(item.localPath)) &&
        canonicalVideoSourceKey(item.sourceUrl) === key &&
        item.webVideoId === webVideoId
    )
    .sort(
      (a, b) =>
        (Date.parse(String(b.downloadedAtIso || '')) || 0) -
        (Date.parse(String(a.downloadedAtIso || '')) || 0)
    );
}
