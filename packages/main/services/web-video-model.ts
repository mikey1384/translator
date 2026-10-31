import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { WebVideoCandidate, WebVideoSelection } from '@shared-types/app';

export type WebVideoSource = {
  candidate: WebVideoCandidate;
  url: string;
  referer: string;
  userAgent?: string;
  info?: Record<string, unknown>;
  browser?: WebVideoBrowserLease;
};

/** Main-process-only lifetime, never exposed through IPC or saved to disk. */
export type WebVideoBrowserLease = {
  cancelled: boolean;
  close: (reason: 'transfer_started' | 'released') => void;
};

export function safeWebVideoUrl(
  value: unknown,
  base?: string,
  fixtureOrigin?: string
): string | null {
  if (typeof value !== 'string' || value.length > 16_384) return null;
  try {
    const u = new URL(value, base);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    if (fixtureOrigin && u.origin === fixtureOrigin) return u.href;
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!host.includes('.') && !host.includes(':')) return null;
    if (/(^|\.)(localhost|local|internal|test|invalid)$/.test(host))
      return null;
    if (isIP(host) === 4) {
      const [a, b] = host.split('.').map(Number);
      if (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 198 && (b === 18 || b === 19))
      )
        return null;
    }
    if (isIP(host) === 6 && !/^[23][0-9a-f]{3}:/.test(host)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export function webVideoId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function isProtectedWebVideoError(stderr: string): boolean {
  // Extractors echo the input URL in errors; a page path named "drm" is
  // not evidence that its video is protected.
  const message = stderr.replace(/https?:\/\/\S+/gi, '');
  return /\bDRM[- ]protected\b|\bprotected (?:by|with) DRM\b|\bdigital rights management\b/i.test(
    message
  );
}

/** Inspect the manifest itself; a blob URL is only a browser-local handle. */
export function inspectWebVideoManifest(
  body: string
):
  | { kind: 'vod' }
  | { kind: 'master'; variants: string[] }
  | { kind: 'protected' | 'live' | 'invalid' } {
  if (
    /SAMPLE-AES|KEYFORMAT\s*=\s*"(?!identity)|<(?:[\w-]+:)?ContentProtection\b/i.test(
      body
    )
  )
    return { kind: 'protected' };
  if (/^\s*#EXTM3U/.test(body)) {
    const lines = body.split(/\r?\n/).map(line => line.trim());
    if (lines.some(line => line.startsWith('#EXT-X-STREAM-INF:'))) {
      const variants = lines.flatMap((line, i) =>
        line.startsWith('#EXT-X-STREAM-INF:') &&
        lines[i + 1] &&
        !lines[i + 1].startsWith('#')
          ? [lines[i + 1]]
          : []
      );
      return variants.length
        ? { kind: 'master', variants }
        : { kind: 'invalid' };
    }
    if (!/#EXTINF:/.test(body)) return { kind: 'invalid' };
    return { kind: /#EXT-X-ENDLIST\b/.test(body) ? 'vod' : 'live' };
  }
  if (/<MPD\b/i.test(body))
    return {
      kind: /\btype\s*=\s*['"]dynamic['"]/i.test(body) ? 'live' : 'vod',
    };
  return { kind: 'invalid' };
}

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
const text = (value: unknown, max = 240) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Only transfer metadata is retained; extractor filenames and arbitrary options cannot survive. */
export function sourcesFromYtDlp(
  raw: unknown,
  pageUrl: string,
  fixtureOrigin?: string
): WebVideoSource[] {
  if (!raw || typeof raw !== 'object') return [];
  const root = raw as Record<string, any>;
  const entries = Array.isArray(root.entries)
    ? root.entries.slice(0, 20)
    : [root];
  const sources: WebVideoSource[] = [];
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      entry.has_drm ||
      entry.is_live ||
      ['is_live', 'is_upcoming', 'post_live'].includes(entry.live_status)
    )
      continue;
    const headers = (input: any): Record<string, string> => {
      const result: Record<string, string> = {};
      for (const key of [
        'User-Agent',
        'Referer',
        'Origin',
        'Accept',
        'Accept-Language',
      ]) {
        const value = input?.[key];
        if (
          typeof value === 'string' &&
          value.length < 4096 &&
          !/[\r\n]/.test(value) &&
          (!['Referer', 'Origin'].includes(key) ||
            Boolean(safeWebVideoUrl(value, undefined, fixtureOrigin)))
        )
          result[key] = value;
      }
      return result;
    };
    const safeFormat = (input: any): Record<string, unknown> | null => {
      if (!input || input.has_drm) return null;
      const url = safeWebVideoUrl(input.url, pageUrl, fixtureOrigin);
      if (!url) return null;
      if (
        input.protocol &&
        ![
          'http',
          'https',
          'm3u8',
          'm3u8_native',
          'http_dash_segments',
          'dash',
          'ism',
        ].includes(input.protocol)
      )
        return null;
      const out: Record<string, unknown> = { url };
      for (const key of [
        'format_id',
        'ext',
        'vcodec',
        'acodec',
        'language',
        'format_note',
        'protocol',
      ]) {
        const value = text(input[key], 100);
        if (
          value &&
          !/[\r\n]/.test(value) &&
          (key !== 'ext' || /^[a-z0-9]{1,10}$/i.test(value))
        )
          out[key] = value;
      }
      for (const key of [
        'width',
        'height',
        'fps',
        'tbr',
        'abr',
        'vbr',
        'filesize',
        'filesize_approx',
        'asr',
        'audio_channels',
      ]) {
        const value = number(input[key]);
        if (value) out[key] = value;
      }
      out.http_headers = headers(input.http_headers);
      if (Array.isArray(input.fragments)) {
        if (input.fragments.length > 30_000) return null;
        const base =
          safeWebVideoUrl(input.fragment_base_url, url, fixtureOrigin) || url;
        const fragments = input.fragments.map((fragment: any) => {
          const target = safeWebVideoUrl(
            fragment?.url || fragment?.path,
            base,
            fixtureOrigin
          );
          return target
            ? {
                url: target,
                ...(number(fragment.duration)
                  ? { duration: fragment.duration }
                  : {}),
              }
            : null;
        });
        if (fragments.some((f: unknown) => !f)) return null;
        out.fragments = fragments;
      }
      return out;
    };
    const formats = Array.isArray(entry.formats)
      ? entry.formats.slice(0, 100).map(safeFormat).filter(Boolean)
      : [];
    const direct = safeWebVideoUrl(entry.url, pageUrl, fixtureOrigin);
    const isEmbed = ['url', 'url_transparent'].includes(entry._type);
    if (!formats.length && !direct) continue;
    const id = webVideoId(
      `${pageUrl}\n${entry.extractor_key || entry.ie_key || 'generic'}\n${entry.id || direct}`
    );
    if (sources.some(source => source.candidate.id === id)) continue;
    const candidate: WebVideoCandidate = {
      id,
      title: text(entry.title) || text(root.title) || new URL(pageUrl).hostname,
      durationSec: number(entry.duration),
      width: number(entry.width),
      height: number(entry.height),
      thumbnailUrl:
        safeWebVideoUrl(entry.thumbnail, pageUrl, fixtureOrigin) || undefined,
    };
    const info = isEmbed
      ? undefined
      : {
          id,
          title: candidate.title,
          // yt-dlp requires an extractor label when reporting format errors.
          // Do not retain webpage_url: load-info-json otherwise re-extracts the
          // whole page on failure and can silently download a different video.
          extractor: 'generic',
          extractor_key: 'Generic',
          duration: candidate.durationSec,
          ...(formats.length ? { formats } : safeFormat(entry)),
          http_headers: { Referer: pageUrl, ...headers(entry.http_headers) },
        };
    if (!isEmbed && !formats.length && !safeFormat(entry)) continue;
    sources.push({
      candidate,
      url: isEmbed ? direct! : pageUrl,
      referer: pageUrl,
      info,
    });
  }
  return sources;
}

/** A bounded, expiring capability; one tab cannot consume another tab's discovery. */
export class WebVideoDiscoveries {
  private entries = new Map<
    string,
    {
      owner: number;
      pageUrl: string;
      expires: number;
      sources: WebVideoSource[];
    }
  >();
  constructor(private now = Date.now) {}
  put(owner: number, pageUrl: string, sources: WebVideoSource[]) {
    this.prune();
    while (this.entries.size >= 16)
      this.drop(this.entries.keys().next().value!);
    const id = randomUUID();
    this.entries.set(id, {
      owner,
      pageUrl,
      expires: this.now() + 20 * 60_000,
      sources: sources.slice(0, 20),
    });
    return id;
  }
  get(
    owner: number,
    pageUrl: string,
    selection: WebVideoSelection
  ): WebVideoSource {
    this.prune();
    const entry = this.entries.get(selection.discoveryId);
    const source = entry?.sources.find(
      item => item.candidate.id === selection.candidateId
    );
    if (!entry || entry.owner !== owner || entry.pageUrl !== pageUrl || !source)
      throw new Error('Video selection expired. Paste the page link again.');
    return source;
  }
  remove(owner: number, id?: string) {
    for (const [key, value] of this.entries)
      if (value.owner === owner && (!id || id === key)) this.drop(key);
  }
  private drop(key: string) {
    const entry = this.entries.get(key);
    this.entries.delete(key);
    for (const source of entry?.sources || [])
      source.browser?.close('released');
  }
  private prune() {
    for (const [key, value] of this.entries)
      if (value.expires <= this.now()) this.drop(key);
  }
}

// Ad servers and ad-video CDNs (Google IMA/DoubleClick, common SSPs). A stream
// from one of these is never the page's video.
const AD_HOST_RE =
  /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|2mdn\.net|imasdk\.googleapis\.com|googletagservices\.com|adnxs\.com|amazon-adsystem\.com|springserve\.com|spotxchange\.com|spotx\.tv|innovid\.com|tremorhub\.com|teads\.tv|adsrvr\.org|serving-sys\.com|moatads\.com|flashtalking\.com|smartadserver\.com|pubmatic\.com|rubiconproject\.com|openx\.net|criteo\.com|yieldmo\.com|unrulymedia\.com|adform\.net|aniview\.com|vidoomy\.com|outbrain\.com|taboola\.com)$/i;
const AD_PATH_RE =
  /\/(?:vast|vpaid|vmap|preroll|pre-roll|midroll|adserver)(?:[/_.-]|$)|[?&](?:ad_type|adtag|ad_unit|correlator)=/i;
// Players park a tiny black/blank clip in the <video> while an ad plays.
const PLACEHOLDER_PATH_RE =
  /\/(?:black|blank|empty|placeholder|dummy|silence|silent)[-_]?(?:video|clip)?\d*\.(?:mp4|webm|m4v|mov)$/i;
const AD_TITLE_RE =
  /^\s*(?:advertisement|advertising|ad|ads|sponsored|promoted|anzeige|werbung|publicité|publicidad|pubblicità|реклама|광고|広告|广告|廣告)\s*$/i;

/** Shorter than this is a teaser, hover preview or ad bumper, not the video. */
export const SHORT_WEB_VIDEO_SEC = 15;

export type WebVideoCandidateKind = 'ad' | 'placeholder' | 'short' | 'main';

/**
 * Generic ad/placeholder detection for streams found in the in-app browser.
 * `adContext` is the page's own signal (the <video> sits in an IMA/ad
 * container or is labelled as an ad).
 */
export function classifyWebVideoCandidate({
  url,
  title,
  durationSec,
  adContext,
}: {
  url: string;
  title?: string;
  durationSec?: number;
  adContext?: boolean;
}): WebVideoCandidateKind {
  let host = '';
  let path = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    path = `${parsed.pathname}${parsed.search}`;
  } catch {
    /* Unparseable URLs never reach here; treat as content. */
  }
  if (adContext || AD_HOST_RE.test(host) || AD_PATH_RE.test(path)) return 'ad';
  if (title && AD_TITLE_RE.test(title)) return 'ad';
  if (PLACEHOLDER_PATH_RE.test(path.split('?')[0])) return 'placeholder';
  if (
    typeof durationSec === 'number' &&
    durationSec > 0 &&
    durationSec < SHORT_WEB_VIDEO_SEC
  )
    return 'short';
  return 'main';
}

/**
 * What the picker lists: ads and placeholders never; short clips only when
 * the page has nothing longer (a hub page of previews). Longest first among
 * clips, page order otherwise.
 */
export function visibleWebVideoCandidates<
  T extends { kind: WebVideoCandidateKind },
>(items: T[]): T[] {
  const content = items.filter(
    item => item.kind === 'main' || item.kind === 'short'
  );
  const main = content.filter(item => item.kind === 'main');
  return main.length ? main : content;
}
