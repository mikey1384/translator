import { fileTitle } from './fileTitle';
import { readLocalVideoSuggestionHistory } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';

const CACHE_MS = 5_000;
let cache: { key: string; title: string; at: number } | null = null;

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}

/**
 * What a tab with this video open is called: the video's own title when it
 * was downloaded (downloads are saved under generated file names), else the
 * file name without its extension. Null when no video is open.
 */
export function resolveTabVideoTitle({
  path,
  originalPath,
  sourceUrl,
  fileName,
}: {
  path?: string | null;
  originalPath?: string | null;
  sourceUrl?: string | null;
  fileName?: string | null;
}): string | null {
  const local = originalPath || path || null;
  if (!local && !fileName) return null;
  const key = `${local ?? ''}\n${sourceUrl ?? ''}\n${fileName ?? ''}`;
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < CACHE_MS) {
    return cache.title;
  }

  let title: string | null = null;
  try {
    const match = readLocalVideoSuggestionHistory().find(
      item =>
        (local && item.localPath && samePath(item.localPath, local)) ||
        (sourceUrl && item.sourceUrl === sourceUrl)
    );
    const saved = match?.title?.trim();
    if (saved && saved !== match?.sourceUrl) title = saved;
  } catch {
    // History is a nicety; fall back to the file name.
  }
  title ||= local ? fileTitle(local) : fileTitle(fileName || '');
  cache = { key, title, at: now };
  return title;
}
