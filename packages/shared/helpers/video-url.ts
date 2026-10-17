// What people paste into a video link field, and how two links to the same
// video are recognised as one source. Shared by the renderer (input fields,
// download history) and main (the URL handler and yt-dlp guard).

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"'`]+/i;
const BARE_DOMAIN_RE =
  /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s]*)?$/i;
const TRAILING_PUNCTUATION_RE = /[)\]}>.,;:!?'"’”»]+$/u;

function stripTrailingPunctuation(value: string): string {
  let text = value.replace(TRAILING_PUNCTUATION_RE, '');
  // Keep a closing paren that belongs to the URL (Wikipedia-style paths).
  if (value.length > text.length && value[text.length] === ')') {
    const opens = (text.match(/\(/g) || []).length;
    const closes = (text.match(/\)/g) || []).length;
    if (opens > closes) text += ')';
  }
  return text;
}

function parseHttpUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Turns a pasted link into a URL the downloader accepts: trims it, pulls the
 * first http(s) link out of a shared blurb, and adds https:// to bare
 * domains like `youtu.be/abc` or `www.youtube.com/watch?v=abc`. Returns null
 * when the text holds no link.
 */
export function normalizeVideoUrlInput(raw: unknown): string | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const embedded = text.match(URL_IN_TEXT_RE);
  if (embedded) {
    return parseHttpUrl(stripTrailingPunctuation(embedded[0]));
  }

  for (const token of text.split(/\s+/)) {
    const candidate = stripTrailingPunctuation(
      token.replace(/^[(<["'“‘«]+/u, '')
    );
    // Another scheme (mailto:, ftp:, file:) is not a video link; host:port is.
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(candidate)) continue;
    if (BARE_DOMAIN_RE.test(candidate)) {
      const parsed = parseHttpUrl(`https://${candidate}`);
      if (parsed) return parsed;
    }
  }
  return null;
}

const YOUTUBE_HOST_RE = /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i;
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

function isYouTubeHost(hostname: string): boolean {
  return YOUTUBE_HOST_RE.test(hostname) || /^youtu\.be$/i.test(hostname);
}

/** The YouTube video id a link points at, or null when it names no single video. */
export function youtubeVideoIdFromUrl(raw: unknown): string | null {
  const normalized = normalizeVideoUrlInput(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (!isYouTubeHost(url.hostname)) return null;
  if (/^youtu\.be$/i.test(url.hostname)) {
    const id = url.pathname.split('/')[1] || '';
    return YOUTUBE_ID_RE.test(id) ? id : null;
  }
  const v = url.searchParams.get('v') || '';
  if (YOUTUBE_ID_RE.test(v)) return v;
  const [, first, second] = url.pathname.split('/');
  if (
    ['shorts', 'embed', 'live', 'v', 'e'].includes(first || '') &&
    YOUTUBE_ID_RE.test(second || '')
  ) {
    return second!;
  }
  return null;
}

const TRACKING_PARAM_RE =
  /^(utm_.+|si|feature|fbclid|gclid|igsh|igshid|ref|ref_src|ref_url|s|t|is_from_webapp|sender_device|_r|mibextid)$/i;

/**
 * One key per video, so two links to the same video (youtu.be vs watch?v=,
 * share/tracking parameters, www. or m. hosts) are treated as one source.
 */
export function canonicalVideoSourceKey(raw: unknown): string | null {
  const youtubeId = youtubeVideoIdFromUrl(raw);
  if (youtubeId) return `youtube:${youtubeId}`;
  const normalized = normalizeVideoUrlInput(raw);
  if (!normalized) {
    const text = String(raw ?? '').trim();
    return text || null;
  }
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const path = url.pathname.replace(/\/+$/, '') || '';
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAM_RE.test(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.length
    ? `?${new URLSearchParams(params).toString()}`
    : '';
  return `${host}${path}${query}`;
}

export type VideoCollectionKind = 'channel' | 'playlist';

/**
 * Links that name many videos (a channel, a playlist, a search page) rather
 * than one. Downloading these would fetch every entry, so they are refused.
 * Links that name a video and also carry a playlist (watch?v=…&list=…) stay
 * single-video links.
 */
export function classifyVideoCollectionUrl(
  raw: unknown
): VideoCollectionKind | null {
  const normalized = normalizeVideoUrlInput(raw);
  if (!normalized) return null;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  const first = (segments[0] || '').toLowerCase();

  if (YOUTUBE_HOST_RE.test(host)) {
    if (youtubeVideoIdFromUrl(normalized)) return null;
    if (first === 'playlist' || url.searchParams.has('list')) {
      return 'playlist';
    }
    if (first === 'results' || first === 'feed' || first === 'hashtag') {
      return 'playlist';
    }
    // A channel's /live page resolves to its current broadcast: one video.
    if (first.startsWith('@')) {
      return (segments[1] || '').toLowerCase() === 'live' ? null : 'channel';
    }
    if (['channel', 'c', 'user'].includes(first) && segments[1]) {
      return (segments[2] || '').toLowerCase() === 'live' ? null : 'channel';
    }
    return null;
  }

  if (/(^|\.)tiktok\.com$/.test(host) && first.startsWith('@')) {
    return segments[1] === 'video' || segments[1] === 'photo'
      ? null
      : 'channel';
  }
  return null;
}
