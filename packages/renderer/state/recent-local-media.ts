export interface RecentLocalMediaItem {
  path: string;
  name: string;
  openedAt: number;
}

const RECENT_MEDIA_KEY = 'recentLocalMediaPaths';
const MAX_RECENT_MEDIA = 3;

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function readRecentLocalMedia(): RecentLocalMediaItem[] {
  try {
    const raw = localStorage.getItem(RECENT_MEDIA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => {
        const path = typeof item?.path === 'string' ? item.path.trim() : '';
        const openedAt = Number(item?.openedAt) || 0;
        if (!path) return null;
        return {
          path,
          name:
            typeof item?.name === 'string' && item.name.trim()
              ? item.name.trim()
              : basename(path),
          openedAt,
        } satisfies RecentLocalMediaItem;
      })
      .filter((item): item is RecentLocalMediaItem => Boolean(item))
      .slice(0, MAX_RECENT_MEDIA);
  } catch {
    return [];
  }
}

export function writeRecentLocalMedia(items: RecentLocalMediaItem[]) {
  try {
    localStorage.setItem(
      RECENT_MEDIA_KEY,
      JSON.stringify(items.slice(0, MAX_RECENT_MEDIA))
    );
  } catch {
    // Ignore storage failures.
  }
}

export function rememberRecentLocalMedia(path: string): RecentLocalMediaItem[] {
  const trimmed = String(path || '').trim();
  if (!trimmed) return readRecentLocalMedia();
  const nextItem: RecentLocalMediaItem = {
    path: trimmed,
    name: basename(trimmed),
    openedAt: Date.now(),
  };
  const next = [
    nextItem,
    ...readRecentLocalMedia().filter(item => item.path !== trimmed),
  ].slice(0, MAX_RECENT_MEDIA);
  writeRecentLocalMedia(next);
  return next;
}

export function removeRecentLocalMedia(path: string): RecentLocalMediaItem[] {
  const next = readRecentLocalMedia().filter(item => item.path !== path);
  writeRecentLocalMedia(next);
  return next;
}

export async function filterExistingRecentLocalMedia(
  items: RecentLocalMediaItem[] = readRecentLocalMedia()
): Promise<RecentLocalMediaItem[]> {
  if (items.length === 0) return [];
  const checks = await Promise.all(
    items.map(async item => {
      try {
        return (await window.fileApi.fileExists(item.path)) ? item : null;
      } catch {
        return null;
      }
    })
  );
  const next = checks.filter(
    (item): item is RecentLocalMediaItem => item !== null
  );
  writeRecentLocalMedia(next);
  return next;
}
