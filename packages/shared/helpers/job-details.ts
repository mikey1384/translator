import {
  KNOWN_VIDEO_SITES,
  OTHER_VIDEO_SITE,
  VIDEO_SITE_ALIASES,
  type KnownVideoSite,
} from '../constants/known-video-sites.js';

/**
 * Job details: the four facts recorded with a credit-based transcription or
 * translation (Translator 1.34.0+). Nothing else about a job is ever sent:
 * no title, URL, file name, audio, subtitle text or prompt.
 */
export interface JobDetails {
  /** Language of the speech, when known (set by the user or detected). */
  sourceLanguage?: string;
  /** Language the subtitles are translated into. */
  targetLanguage?: string;
  /** Full length of the video in whole seconds, not the part being processed. */
  videoSeconds?: number;
  /**
   * Site the video was downloaded from: a well-known video site by name
   * ("youtube.com"), or "other" for every other web address.
   */
  sourceSite?: KnownVideoSite;
}

/**
 * What the renderer knows about the open video. Main overrides any field it
 * can measure or was told directly (video length, target language).
 */
export type JobContext = JobDetails;

// An ISO-style code ("en", "eng", "pt-br") or one of the app's language
// tokens ("korean", "chinese_simplified").
const LANGUAGE_PATTERN =
  /^(?:[a-z]{2,3}(?:-[a-z0-9]{2,8})?|[a-z]{3,12}(?:_[a-z]{3,12}){0,2})$/;
const MAX_VIDEO_SECONDS = 7 * 24 * 60 * 60;
// Not real languages: "original" means "do not translate".
const NON_LANGUAGES = new Set(['original', 'auto', 'none', 'unknown', 'und']);
const KNOWN_SITES: ReadonlySet<string> = new Set(KNOWN_VIDEO_SITES);

function knownSite(value: string): KnownVideoSite | undefined {
  return KNOWN_SITES.has(value) || value === OTHER_VIDEO_SITE
    ? (value as KnownVideoSite)
    : undefined;
}

/**
 * The site a video was downloaded from. A well-known video site is named;
 * any other web address is only "other", so a private server, a company
 * intranet or a personal domain is never reported by name. Local files
 * give undefined.
 */
export function siteNameFromUrl(
  url: string | null | undefined
): KnownVideoSite | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return undefined;
    }
    host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return undefined;
  }
  const labels = host.split('.');
  // Longest suffix first: "tv.naver.com" matches "naver.com".
  for (let start = 0; start < labels.length - 1; start += 1) {
    const suffix = labels.slice(start).join('.');
    const site = VIDEO_SITE_ALIASES[suffix] ?? knownSite(suffix);
    if (site && site !== OTHER_VIDEO_SITE) return site;
  }
  return OTHER_VIDEO_SITE;
}

function cleanLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (NON_LANGUAGES.has(normalized)) return undefined;
  return LANGUAGE_PATTERN.test(normalized) ? normalized : undefined;
}

/** Keeps only well-formed fields; returns null when none is left. */
export function cleanJobDetails(
  input:
    | {
        sourceLanguage?: unknown;
        targetLanguage?: unknown;
        videoSeconds?: unknown;
        sourceSite?: unknown;
      }
    | null
    | undefined
): JobDetails | null {
  if (!input || typeof input !== 'object') return null;
  const details: JobDetails = {};
  const sourceLanguage = cleanLanguage(input.sourceLanguage);
  if (sourceLanguage) details.sourceLanguage = sourceLanguage;
  const targetLanguage = cleanLanguage(input.targetLanguage);
  if (targetLanguage) details.targetLanguage = targetLanguage;
  const seconds =
    typeof input.videoSeconds === 'number' &&
    Number.isFinite(input.videoSeconds)
      ? Math.round(input.videoSeconds)
      : 0;
  if (seconds >= 1 && seconds <= MAX_VIDEO_SECONDS) {
    details.videoSeconds = seconds;
  }
  const site =
    typeof input.sourceSite === 'string'
      ? knownSite(input.sourceSite.trim().toLowerCase())
      : undefined;
  if (site) details.sourceSite = site;
  return Object.keys(details).length > 0 ? details : null;
}
