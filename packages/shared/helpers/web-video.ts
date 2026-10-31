const FAST_PATH_HOST_RE =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|facebook\.com|fb\.watch|vimeo\.com|twitch\.tv|bilibili\.com|b23\.tv|dailymotion\.com|dai\.ly|reddit\.com|redd\.it|streamable\.com)$/i;
const YOUTUBE_HOST_RE =
  /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

function parseHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** Known video links keep the existing fast path; ordinary pages are inspected. */
export function shouldDiscoverWebVideo(raw: string): boolean {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  if (
    /\.(mp4|m4v|mov|webm|mkv|avi|m3u8|mpd|mp3|m4a|wav|ogg)$/i.test(url.pathname)
  )
    return false;
  return !FAST_PATH_HOST_RE.test(url.hostname);
}

/**
 * A fast-path link (Reddit, Instagram, TikTok…) whose yt-dlp download failed
 * can still be public in a browser: Reddit's API needs an account while its
 * pages and v.redd.it streams do not. Those links may fall back to the in-app
 * browser picker. YouTube never does: its page streams are not downloadable
 * and its failures have their own recovery (Connect, captions).
 */
export function canFallBackToWebVideoBrowser(raw: string): boolean {
  const url = parseHttpUrl(raw);
  if (!url) return false;
  if (YOUTUBE_HOST_RE.test(url.hostname)) return false;
  if (
    /\.(mp4|m4v|mov|webm|mkv|avi|m3u8|mpd|mp3|m4a|wav|ogg)$/i.test(url.pathname)
  )
    return false;
  return FAST_PATH_HOST_RE.test(url.hostname);
}

const SITE_NAMES: Array<[RegExp, string]> = [
  [YOUTUBE_HOST_RE, 'YouTube'],
  [/(^|\.)instagram\.com$/i, 'Instagram'],
  [/(^|\.)(reddit\.com|redd\.it)$/i, 'Reddit'],
  [/(^|\.)tiktok\.com$/i, 'TikTok'],
  [/(^|\.)(twitter\.com|x\.com)$/i, 'X'],
  [/(^|\.)(facebook\.com|fb\.watch)$/i, 'Facebook'],
  [/(^|\.)vimeo\.com$/i, 'Vimeo'],
  [/(^|\.)twitch\.tv$/i, 'Twitch'],
  [/(^|\.)(bilibili\.com|b23\.tv)$/i, 'Bilibili'],
  [/(^|\.)(dailymotion\.com|dai\.ly)$/i, 'Dailymotion'],
  [/(^|\.)streamable\.com$/i, 'Streamable'],
];

/** "Instagram", "Reddit"… for known sites, otherwise the bare host name. */
export function siteDisplayName(raw: string): string {
  const url = parseHttpUrl(raw);
  if (!url) return '';
  const host = url.hostname.toLowerCase();
  for (const [re, name] of SITE_NAMES) if (re.test(host)) return name;
  return host.replace(/^(?:www|m)\./, '');
}
