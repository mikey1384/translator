import type { VideoSuggestionDownloadHistoryItem } from '@shared-types/app';

export const RECENT_DOWNLOAD_LIMIT = 40;
export const FILED_DOWNLOAD_LIMIT = 5000;

export function validDownloadFolderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}

/** Filing a video makes it durable: the recent-history cap must never evict it. */
export function limitDownloadHistory<
  T extends Pick<VideoSuggestionDownloadHistoryItem, 'folderId'>,
>(items: T[]): T[] {
  let recent = 0;
  return items.filter(
    item => item.folderId || ++recent <= RECENT_DOWNLOAD_LIMIT
  );
}
