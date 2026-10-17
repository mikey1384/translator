import type { VideoSuggestionDownloadHistoryItem } from '../../containers/GenerateSubtitles/components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import type { RecentLocalMediaItem } from '../../state/recent-local-media';

export const LOCAL_RECENT_ID_PREFIX = 'local:';

export function isLocalRecentItem(
  item: Pick<VideoSuggestionDownloadHistoryItem, 'id'>
): boolean {
  return item.id.startsWith(LOCAL_RECENT_ID_PREFIX);
}

function comparablePath(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase();
}

function timeOf(item: VideoSuggestionDownloadHistoryItem): number {
  const ts = Date.parse(String(item.downloadedAtIso || ''));
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * Home > Recent: downloads and locally opened files together, newest first,
 * one card per video (a downloaded file opened again from disk stays one
 * card, carrying its download's link and thumbnail).
 */
export function mergeHomeRecentItems(
  downloads: VideoSuggestionDownloadHistoryItem[],
  locals: RecentLocalMediaItem[],
  limit = 3
): VideoSuggestionDownloadHistoryItem[] {
  const localItems: VideoSuggestionDownloadHistoryItem[] = locals.map(
    local => ({
      id: `${LOCAL_RECENT_ID_PREFIX}${local.path}`,
      sourceUrl: '',
      title: local.name,
      localPath: local.path,
      downloadedAtIso: new Date(local.openedAt || 0).toISOString(),
    })
  );
  const downloadByPath = new Map(
    downloads
      .filter(item => item.localPath)
      .map(item => [comparablePath(item.localPath), item] as const)
  );
  const candidates = [
    ...downloads,
    ...localItems.map(local => {
      const download = downloadByPath.get(comparablePath(local.localPath));
      // Same file as a download: keep the download card, at the newer time.
      return download && timeOf(local) > timeOf(download)
        ? { ...download, downloadedAtIso: local.downloadedAtIso }
        : download
          ? null
          : local;
    }),
  ].filter((item): item is VideoSuggestionDownloadHistoryItem => !!item);

  const sorted = candidates
    .map((item, index) => ({ item, index }))
    .sort((a, b) => timeOf(b.item) - timeOf(a.item) || a.index - b.index)
    .map(entry => entry.item);

  const seen = new Set<string>();
  const out: VideoSuggestionDownloadHistoryItem[] = [];
  for (const item of sorted) {
    const keys = [
      item.sourceUrl ? `url:${item.sourceUrl}` : '',
      item.localPath ? `path:${comparablePath(item.localPath)}` : '',
      `id:${item.id}`,
    ].filter(Boolean);
    if (keys.some(key => seen.has(key))) continue;
    keys.forEach(key => seen.add(key));
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
}
