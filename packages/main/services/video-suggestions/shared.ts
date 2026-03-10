import type {
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import {
  sanitizeVideoSuggestionCountry,
  sanitizeVideoSuggestionPreference,
  sanitizeVideoSuggestionSearchKeywords,
} from '../../../shared/helpers/video-suggestion-sanitize.js';

export type IntentResolverPayload = {
  assistantMessage?: string;
  needsMoreContext?: boolean;
  answerToUserQuestion?: string;
  resolvedIntent?: string;
  intentSummary?: string;
  strategy?: string;
  candidates?: IntentCandidate[];
  descriptorPhrases?: string[];
  canonicalEntities?: string[];
  impliedLocale?: string;
  impliedSearchLanguage?: string;
  primarySearchLanguage?: string;
  searchLanguages?: string[];
  searchQuery?: string;
  discoveryQueries?: string[];
  retrievalMode?: DiscoveryRetrievalMode;
  retrievalQueries?: string[];
  impliedConstraints?: {
    country?: string;
    recency?: string;
  };
  ambiguities?: string[];
  recommendedInterpretation?: string;
  confidence?: 'low' | 'medium' | 'high';
  capturedPreferences?: VideoSuggestionPreferenceSlots;
};

export type IntentCandidate = {
  name: string;
  confidence?: 'low' | 'medium' | 'high';
};

export type QueryFormulatorPayload = {
  assistantMessage?: string;
  needsMoreContext?: boolean;
  intentSummary?: string;
  strategy?: string;
  countryCode?: string;
  primarySearchLanguage?: string;
  searchLanguages?: string[];
  searchQuery?: string;
  retrievalQueries?: string[];
  capturedPreferences?: VideoSuggestionPreferenceSlots;
};

export type SeedSearchOutcome = {
  results: VideoSuggestionResultItem[];
  searchQuery: string;
  channels: string[];
  queriesTried: string[];
  confidence: number;
  candidateCount?: number;
  droppedUnavailable?: number;
  lowConfidenceReason?: string;
};

export type DiscoveryChannelCandidate = {
  name: string;
  url?: string;
  localeHint?: string;
  categoryHint?: string;
  evidenceCount: number;
  evidenceUrls: string[];
  score: number;
};

export type DiscoveryRetrievalMode = 'channel' | 'topic';

export type DiscoveryOutcome = {
  channels: DiscoveryChannelCandidate[];
  queriesUsed: string[];
  assistantMessage: string;
};

export type LlmYoutubeVideoPayload = {
  title?: unknown;
  url?: unknown;
  channel?: unknown;
  channelUrl?: unknown;
  channel_url?: unknown;
  authorUrl?: unknown;
  thumbnailUrl?: unknown;
  durationSec?: unknown;
  uploadedAt?: unknown;
  uploadDate?: unknown;
  publishedAt?: unknown;
};

export type LlmYoutubeSearchPayload = {
  assistantMessage?: unknown;
  searchQuery?: unknown;
  videos?: unknown;
};

export const VIDEO_SUGGESTION_SOURCE_LABEL = 'YouTube';
export const VIDEO_SUGGESTION_HOST_SUFFIXES = ['youtube.com', 'youtu.be'];
const YOUTUBE_ROOT_URL = 'https://www.youtube.com';

export function throwIfSuggestionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Operation cancelled', 'AbortError');
  }
}

export function isSuggestionAbortError(
  error: unknown,
  signal?: AbortSignal
): boolean {
  if (signal?.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' || error.message === 'Operation cancelled'
    );
  }
  const message =
    typeof (error as { message?: unknown })?.message === 'string'
      ? (error as { message: string }).message
      : '';
  return message === 'Operation cancelled';
}

export function isYoutubeVideoSuggestionUrl(url: string): boolean {
  const normalizedUrl = compactText(url);
  if (!/^https?:\/\//i.test(normalizedUrl)) return false;
  try {
    const host = new URL(normalizedUrl).hostname.toLowerCase();
    return VIDEO_SUGGESTION_HOST_SUFFIXES.some(
      suffix => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

export const SUPPORTED_SEARCH_LOCALES = new Set([
  'en',
  'es',
  'fr',
  'de',
  'it',
  'ja',
  'ko',
  'zh',
  'ru',
  'pt',
  'ar',
  'hi',
  'id',
  'vi',
  'tr',
  'nl',
  'pl',
  'sv',
  'no',
  'da',
  'fi',
  'el',
  'cs',
  'hu',
  'ro',
  'uk',
  'he',
  'fa',
  'th',
  'ms',
  'sw',
  'af',
  'bn',
  'ta',
  'te',
  'mr',
  'tl',
  'ur',
]);

export const COUNTRY_LOCALE_RULES: Array<{
  locale: string;
  aliases: string[];
}> = [
  { locale: 'ja', aliases: ['japan', 'jp', '日本'] },
  { locale: 'ko', aliases: ['korea', 'kr', '한국', '대한민국', '韓国'] },
  {
    locale: 'zh',
    aliases: ['china', 'cn', '中国', 'taiwan', 'tw', '香港', 'hong kong'],
  },
  { locale: 'hi', aliases: ['india', 'in', 'bharat', 'भारत'] },
  { locale: 'bn', aliases: ['bangladesh', 'bd', 'বাংলাদেশ'] },
  { locale: 'ur', aliases: ['pakistan', 'pk', 'پاکستان'] },
  { locale: 'ta', aliases: ['tamil nadu', 'sri lanka', 'இலங்கை'] },
  { locale: 'te', aliases: ['andhra', 'telangana'] },
  { locale: 'mr', aliases: ['maharashtra'] },
  {
    locale: 'es',
    aliases: [
      'spain',
      'es',
      'mexico',
      'mx',
      'argentina',
      'ar',
      'colombia',
      'co',
      'peru',
      'pe',
      'chile',
      'cl',
    ],
  },
  { locale: 'pt', aliases: ['brazil', 'br', 'portugal', 'pt'] },
  { locale: 'fr', aliases: ['france', 'fr', 'belgium', 'be'] },
  { locale: 'de', aliases: ['germany', 'de', 'austria', 'at'] },
  { locale: 'it', aliases: ['italy', 'it'] },
  { locale: 'ru', aliases: ['russia', 'ru'] },
  { locale: 'tr', aliases: ['turkey', 'tr', 'türkiye'] },
  { locale: 'id', aliases: ['indonesia', 'id'] },
  { locale: 'vi', aliases: ['vietnam', 'vn', 'việt nam'] },
  { locale: 'th', aliases: ['thailand', 'th'] },
  { locale: 'ms', aliases: ['malaysia', 'my'] },
  {
    locale: 'ar',
    aliases: ['saudi', 'uae', 'egypt', 'qatar', 'kuwait', 'morocco', 'العربية'],
  },
  { locale: 'he', aliases: ['israel', 'il', 'עברית'] },
  { locale: 'fa', aliases: ['iran', 'ir', 'فارسی'] },
  { locale: 'nl', aliases: ['netherlands', 'nl'] },
  { locale: 'pl', aliases: ['poland', 'pl'] },
  { locale: 'sv', aliases: ['sweden', 'se'] },
  { locale: 'no', aliases: ['norway', 'no'] },
  { locale: 'da', aliases: ['denmark', 'dk'] },
  { locale: 'fi', aliases: ['finland', 'fi'] },
  { locale: 'el', aliases: ['greece', 'gr'] },
  { locale: 'cs', aliases: ['czech', 'cz'] },
  { locale: 'hu', aliases: ['hungary', 'hu'] },
  { locale: 'ro', aliases: ['romania', 'ro'] },
  { locale: 'uk', aliases: ['ukraine', 'ua'] },
  { locale: 'sw', aliases: ['kenya', 'ke', 'tanzania', 'tz'] },
  { locale: 'af', aliases: ['south africa', 'za'] },
  { locale: 'tl', aliases: ['philippines', 'ph'] },
];

const COUNTRY_CODE_RULES: Array<{
  code: string;
  aliases: string[];
}> = [
  { code: 'JP', aliases: ['japan', 'jp', '日本'] },
  { code: 'KR', aliases: ['south korea', 'korea', 'kr', '한국', '대한민국', '韓国'] },
  { code: 'CN', aliases: ['china', 'cn', '中国', '중국', 'mainland china', 'prc'] },
  { code: 'TW', aliases: ['taiwan', 'tw', '台灣', '台湾'] },
  { code: 'HK', aliases: ['hong kong', 'hk', '香港'] },
  { code: 'IN', aliases: ['india', 'in', 'bharat', 'भारत'] },
  { code: 'BD', aliases: ['bangladesh', 'bd', 'বাংলাদেশ'] },
  { code: 'PK', aliases: ['pakistan', 'pk', 'پاکستان'] },
  { code: 'LK', aliases: ['sri lanka', 'lk', 'இலங்கை'] },
  { code: 'ES', aliases: ['spain', 'es', 'españa'] },
  { code: 'MX', aliases: ['mexico', 'mx', 'méxico'] },
  { code: 'AR', aliases: ['argentina', 'ar'] },
  { code: 'CO', aliases: ['colombia', 'co'] },
  { code: 'PE', aliases: ['peru', 'pe', 'perú'] },
  { code: 'CL', aliases: ['chile', 'cl'] },
  { code: 'BR', aliases: ['brazil', 'br', 'brasil'] },
  { code: 'PT', aliases: ['portugal', 'pt'] },
  { code: 'FR', aliases: ['france', 'fr'] },
  { code: 'BE', aliases: ['belgium', 'be', 'belgique'] },
  { code: 'DE', aliases: ['germany', 'de', 'deutschland'] },
  { code: 'AT', aliases: ['austria', 'at', 'österreich'] },
  { code: 'IT', aliases: ['italy', 'it', 'italia'] },
  { code: 'RU', aliases: ['russia', 'ru', 'россия'] },
  { code: 'TR', aliases: ['turkey', 'tr', 'türkiye'] },
  { code: 'ID', aliases: ['indonesia', 'id'] },
  { code: 'VN', aliases: ['vietnam', 'vn', 'việt nam'] },
  { code: 'TH', aliases: ['thailand', 'th'] },
  { code: 'MY', aliases: ['malaysia', 'my'] },
  { code: 'SA', aliases: ['saudi arabia', 'saudi', 'sa'] },
  { code: 'AE', aliases: ['uae', 'united arab emirates', 'ae'] },
  { code: 'EG', aliases: ['egypt', 'eg', 'مصر'] },
  { code: 'QA', aliases: ['qatar', 'qa'] },
  { code: 'KW', aliases: ['kuwait', 'kw'] },
  { code: 'MA', aliases: ['morocco', 'ma'] },
  { code: 'IL', aliases: ['israel', 'il', 'ישראל', 'עברית'] },
  { code: 'IR', aliases: ['iran', 'ir', 'ایران', 'فارسی'] },
  { code: 'NL', aliases: ['netherlands', 'nl', 'holland'] },
  { code: 'PL', aliases: ['poland', 'pl'] },
  { code: 'SE', aliases: ['sweden', 'se'] },
  { code: 'NO', aliases: ['norway', 'no'] },
  { code: 'DK', aliases: ['denmark', 'dk'] },
  { code: 'FI', aliases: ['finland', 'fi'] },
  { code: 'GR', aliases: ['greece', 'gr'] },
  { code: 'CZ', aliases: ['czechia', 'czech republic', 'czech', 'cz'] },
  { code: 'HU', aliases: ['hungary', 'hu'] },
  { code: 'RO', aliases: ['romania', 'ro'] },
  { code: 'UA', aliases: ['ukraine', 'ua'] },
  { code: 'KE', aliases: ['kenya', 'ke'] },
  { code: 'TZ', aliases: ['tanzania', 'tz'] },
  { code: 'ZA', aliases: ['south africa', 'za'] },
  { code: 'PH', aliases: ['philippines', 'ph', 'pilipinas'] },
  { code: 'US', aliases: ['united states', 'us', 'usa', 'america'] },
  { code: 'GB', aliases: ['united kingdom', 'uk', 'gb', 'britain', 'england'] },
  { code: 'CA', aliases: ['canada', 'ca'] },
  { code: 'AU', aliases: ['australia', 'au'] },
  { code: 'SG', aliases: ['singapore', 'sg'] },
];

export function compactText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

export function recencyLabel(recency: VideoSuggestionRecency): string {
  switch (recency) {
    case 'day':
      return 'last 24 hours';
    case 'week':
      return 'last 7 days';
    case 'month':
      return 'last 30 days';
    case 'year':
      return 'last 365 days';
    default:
      return 'any time';
  }
}

export function sanitizeLanguageToken(input: unknown): string {
  const text = compactText(input);
  if (!text) return '';
  return text.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
}

export function sanitizeCountryHint(input: unknown): string {
  return sanitizeVideoSuggestionCountry(compactText(input));
}

export function sanitizeVideoSuggestionPreferenceValue(input: unknown): string {
  return sanitizeVideoSuggestionPreference(input);
}

export function normalizePreferenceSlots(
  input: unknown
): VideoSuggestionPreferenceSlots {
  const source = input && typeof input === 'object' ? (input as any) : {};
  const topic = sanitizeVideoSuggestionPreferenceValue(
    source?.topic ?? source?.contentTopic ?? source?.intentTopic
  );
  const out: VideoSuggestionPreferenceSlots = {};
  if (topic) out.topic = topic;
  return out;
}

export function countryTextMatchesAlias(
  countryText: string,
  alias: string
): boolean {
  const country = compactText(countryText).toLowerCase();
  const needle = compactText(alias).toLowerCase();
  if (!country || !needle) return false;
  if (needle.length <= 2 && /^[a-z0-9]+$/.test(needle)) {
    const tokens = country
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter(Boolean);
    return tokens.includes(needle);
  }
  return country.includes(needle);
}

export function inferCountryAliases(countryHint: string): string[] {
  const normalized = sanitizeCountryHint(countryHint).toLowerCase();
  if (!normalized) return [];

  for (const rule of COUNTRY_LOCALE_RULES) {
    if (
      rule.aliases.some(alias => countryTextMatchesAlias(normalized, alias))
    ) {
      return uniqueTexts([
        normalized,
        ...rule.aliases.map(alias => alias.toLowerCase()),
      ]);
    }
  }

  return [normalized];
}

export function normalizeLocaleCode(tag?: string): string {
  const normalized = sanitizeLanguageToken(tag || '').toLowerCase();
  if (!normalized) return 'en';
  const base = normalized.split(/[-_]/)[0];
  if (SUPPORTED_SEARCH_LOCALES.has(base)) return base;
  return 'en';
}

export function resolveSearchLocale(
  countryHint?: string,
  languageTag?: string
): string {
  const country = compactText(countryHint).toLowerCase();
  if (country) {
    for (const rule of COUNTRY_LOCALE_RULES) {
      if (rule.aliases.some(alias => countryTextMatchesAlias(country, alias))) {
        return rule.locale;
      }
    }
  }
  return normalizeLocaleCode(languageTag);
}

const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['en'], {
  type: 'region',
});

export function normalizeCountryCode(input: unknown): string {
  const normalized = sanitizeLanguageToken(input).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return '';
  try {
    const display = compactText(REGION_DISPLAY_NAMES.of(normalized));
    if (!display || /^unknown region$/i.test(display)) {
      return '';
    }
    return normalized;
  } catch {
    return '';
  }
}

export function inferCountryCodeFromCountryHint(countryHint?: string): string {
  const country = compactText(countryHint).toLowerCase();
  if (!country) return '';

  for (const rule of COUNTRY_CODE_RULES) {
    if (rule.aliases.some(alias => countryTextMatchesAlias(country, alias))) {
      return rule.code;
    }
  }

  return '';
}

export function resolveCountryCode(
  countryHint?: string,
  fallbackCode?: string
): string {
  return (
    inferCountryCodeFromCountryHint(countryHint) ||
    normalizeCountryCode(fallbackCode)
  );
}

export function localeToLanguageInstruction(locale: string): string {
  const base = normalizeLocaleCode(locale);
  const nameMap: Record<string, string> = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    ru: 'Russian',
    pt: 'Portuguese',
    ar: 'Arabic',
    hi: 'Hindi',
    id: 'Indonesian',
    vi: 'Vietnamese',
    tr: 'Turkish',
    nl: 'Dutch',
    pl: 'Polish',
    sv: 'Swedish',
    no: 'Norwegian',
    da: 'Danish',
    fi: 'Finnish',
    el: 'Greek',
    cs: 'Czech',
    hu: 'Hungarian',
    ro: 'Romanian',
    uk: 'Ukrainian',
    he: 'Hebrew',
    fa: 'Persian',
    th: 'Thai',
    ms: 'Malay',
    sw: 'Swahili',
    af: 'Afrikaans',
    bn: 'Bengali',
    ta: 'Tamil',
    te: 'Telugu',
    mr: 'Marathi',
    tl: 'Tagalog',
    ur: 'Urdu',
  };
  return nameMap[base] || 'English';
}

export function inferSearchLanguageFromCountry(
  countryHint?: string,
  languageTag?: string
): string {
  return resolveSearchLocale(countryHint, languageTag);
}

export function localizeCountryToken(
  countryHint: string,
  targetLang: string
): string {
  const locale = normalizeLocaleCode(targetLang);
  const aliases = inferCountryAliases(countryHint);
  if (aliases.includes('japan')) {
    if (locale === 'ja') return '日本';
    if (locale === 'ko') return '일본';
    return 'Japan';
  }
  if (aliases.includes('korea')) {
    if (locale === 'ja') return '韓国';
    if (locale === 'ko') return '한국';
    return 'Korea';
  }
  return sanitizeCountryHint(countryHint);
}

export function applyCountryHint(query: string, countryHint: string): string {
  const normalizedQuery = compactText(query);
  const normalizedCountry = sanitizeCountryHint(countryHint);
  if (!normalizedQuery || !normalizedCountry) return normalizedQuery;
  const aliases = inferCountryAliases(normalizedCountry);
  const hasAlias = aliases.some(alias =>
    countryTextMatchesAlias(normalizedQuery, alias)
  );
  if (hasAlias) {
    return normalizedQuery;
  }
  const targetLang = inferSearchLanguageFromCountry(countryHint);
  const localizedCountry = localizeCountryToken(normalizedCountry, targetLang);
  return `${normalizedQuery} ${localizedCountry}`;
}

export function buildYoutubeSearchPageUrl({
  query,
  countryCode,
  searchLocale,
}: {
  query: string;
  countryCode?: string;
  searchLocale?: string;
}): string {
  const url = new URL(`${YOUTUBE_ROOT_URL}/results`);
  url.searchParams.set('search_query', compactText(query));

  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const normalizedSearchLocale = sanitizeLanguageToken(searchLocale)
    .toLowerCase()
    .slice(0, 10);

  if (normalizedCountryCode) {
    url.searchParams.set('gl', normalizedCountryCode);
    url.searchParams.set('persist_gl', '1');
  }
  if (normalizedSearchLocale) {
    url.searchParams.set('hl', normalizedSearchLocale);
  }

  return url.toString();
}

export function truncateStatusValue(value: string, max = 90): string {
  const normalized = compactText(value);
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trim()}...`;
}

export function quotedStatusValue(value: string, max = 90): string {
  const normalized = truncateStatusValue(value, max);
  if (!normalized) return '"(none)"';
  return `"${normalized}"`;
}

export function clampMessage(text: string): string {
  const normalized = compactText(text);
  if (!normalized) return '';
  if (normalized.length <= 160) return normalized;
  return `${normalized.slice(0, 157).trim()}...`;
}

export function clampTraceMessage(text: string, max = 420): string {
  const normalized = compactText(text);
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trim()}...`;
}

export function clampTraceLines(lines: string[], max = 560): string {
  const normalized = lines
    .map(line => compactText(line))
    .filter(Boolean)
    .join('\n');
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3).trim()}...`;
}

export function describeLowConfidenceReason(
  reason: string | undefined
): string {
  const normalized = compactText(reason).toLowerCase();
  if (!normalized) return 'Search confidence was too low.';
  if (normalized === 'no-scored-results') {
    return 'No verified videos remained after retrieval.';
  }
  if (normalized === 'no-recency-matches') {
    return 'No videos matched the selected recency window with verifiable upload dates.';
  }
  return `Search confidence was too low (${normalized}).`;
}

export function uniqueTexts(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = compactText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function summarizeValues(values: string[], max = 4): string {
  const cleaned = uniqueTexts(
    values.map(value => compactText(value)).filter(Boolean)
  );
  if (cleaned.length === 0) return 'none';
  if (cleaned.length <= max) return cleaned.join(', ');
  return `${cleaned.slice(0, max).join(', ')} +${cleaned.length - max} more`;
}

export function summarizeTopTitles(
  items: VideoSuggestionResultItem[],
  max = 3
): string {
  return summarizeValues(
    items
      .map(item => compactText(item.title))
      .filter(Boolean)
      .slice(0, max),
    max
  );
}

export function containsHangul(text: string): boolean {
  return /[\uAC00-\uD7AF]/.test(text);
}

export function containsCjkOrKana(text: string): boolean {
  return /[\u3040-\u30FF\u3400-\u9FFF]/.test(text);
}

export const sanitizeSearchKeywords = sanitizeVideoSuggestionSearchKeywords;

const NOISY_RETRIEVAL_PATTERNS: RegExp[] = [
  /\bofficial\s+youtube\s+channel\b/gi,
  /\byoutube\s+official\s+channel\b/gi,
  /\bofficial\s+channel\b/gi,
  /\byoutube\b/gi,
  /\bchannel\b/gi,
  /公式\s*YouTube\s*チャンネル/gi,
  /YouTube\s*公式(?:チャンネル)?/gi,
  /公式チャンネル/gi,
  /유튜브\s*공식\s*채널/g,
  /공식\s*유튜브\s*채널/g,
  /官方\s*YouTube\s*频道/gi,
  /官方频道/gi,
  /\blatest\s+videos?\b/gi,
  /\blatest\b/gi,
  /\bnewest\b/gi,
  /(?:^|\s)最新(?:$|\s)/g,
  /(?:^|\s)최신(?:$|\s)/g,
];

export function sanitizeRetrievalSearchQuery(value: unknown): string {
  let normalized = sanitizeSearchKeywords(value);
  if (!normalized) return '';
  for (const pattern of NOISY_RETRIEVAL_PATTERNS) {
    normalized = normalized.replace(pattern, ' ');
  }
  normalized = sanitizeSearchKeywords(normalized);
  return normalized;
}

function normalizeCandidateConfidence(
  value: unknown
): IntentCandidate['confidence'] | undefined {
  const normalized = compactText(value).toLowerCase();
  if (
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high'
  ) {
    return normalized;
  }
  return undefined;
}

export function normalizeIntentCandidates(
  input: unknown
): IntentCandidate[] {
  const rawItems = Array.isArray(input) ? input : [];
  const out: IntentCandidate[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const source =
      rawItem && typeof rawItem === 'object'
        ? (rawItem as Record<string, unknown>)
        : null;
    const name = clampMessage(
      compactText(source ? source.name ?? source.channel : rawItem)
    );
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      confidence: normalizeCandidateConfidence(source?.confidence),
    });
    if (out.length >= 12) break;
  }

  return out;
}

export function normalizeDescriptorPhrases(input: unknown): string[] {
  const rawItems = Array.isArray(input) ? input : [];
  const out: string[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const phrase = sanitizeRetrievalSearchQuery(rawItem);
    if (!phrase) continue;
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= 8) break;
  }

  return out;
}

function candidateConfidenceWeight(
  confidence: IntentCandidate['confidence']
): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 2;
  }
}

export function buildOrderedIntentSeedQueries({
  candidates,
  descriptorPhrases,
  resolvedIntent,
  latestUserQuery,
  maxQueries = 18,
}: {
  candidates?: IntentCandidate[];
  descriptorPhrases?: string[];
  resolvedIntent?: string;
  latestUserQuery?: string;
  maxQueries?: number;
}): string[] {
  const sortedCandidates = [...(candidates || [])]
    .filter(candidate => compactText(candidate?.name))
    .sort((a, b) => {
      const weightDiff =
        candidateConfidenceWeight(b.confidence) -
        candidateConfidenceWeight(a.confidence);
      if (weightDiff !== 0) return weightDiff;
      return 0;
    });

  const candidateNames = uniqueTexts(
    sortedCandidates.map(candidate =>
      sanitizeRetrievalSearchQuery(candidate.name)
    )
  ).slice(0, 8);

  const descriptors = normalizeDescriptorPhrases(descriptorPhrases).slice(0, 4);
  const queries: string[] = [];

  for (const candidateName of candidateNames) {
    queries.push(candidateName);
  }

  let comboCount = 0;
  for (const descriptor of descriptors.slice(0, 2)) {
    for (const candidateName of candidateNames.slice(0, 4)) {
      const normalizedCandidate = candidateName.toLowerCase();
      const normalizedDescriptor = descriptor.toLowerCase();
      if (
        normalizedDescriptor.includes(normalizedCandidate) ||
        normalizedCandidate.includes(normalizedDescriptor)
      ) {
        continue;
      }
      queries.push(`${candidateName} ${descriptor}`);
      comboCount += 1;
      if (comboCount >= 4) break;
    }
    if (comboCount >= 4) break;
  }

  queries.push(...descriptors);

  for (const fallback of [resolvedIntent, latestUserQuery]) {
    const normalized = sanitizeRetrievalSearchQuery(fallback);
    if (!normalized) continue;
    queries.push(normalized);
  }

  return uniqueTexts(
    queries.map(query => sanitizeRetrievalSearchQuery(query)).filter(Boolean)
  ).slice(0, Math.max(1, Math.floor(maxQueries)));
}

export function enrichIntentKeywords(
  query: string,
  targetLang: string
): string {
  const normalized = sanitizeSearchKeywords(query);
  if (!normalized) return normalized;
  const lower = normalized.toLowerCase();
  const isStreamerIntent =
    /\b(streamer|stream|livestream|live stream|twitch|vtuber|gaming|game)\b/i.test(
      lower
    ) ||
    /配信|配信者|実況|ストリーマー|ゲーム/.test(normalized) ||
    /스트리머|방송|게임|라이브/.test(normalized);
  if (!isStreamerIntent) return normalized;
  const hasStreamWord =
    /\b(stream|livestream|archive|vod)\b/i.test(lower) ||
    /配信|アーカイブ|実況|생방|다시보기/.test(normalized);
  if (hasStreamWord) return normalized;
  if (targetLang === 'ja') {
    return `${normalized} 配信 アーカイブ`;
  }
  if (targetLang === 'ko') {
    return `${normalized} 방송 다시보기`;
  }
  return `${normalized} stream archive`;
}

export function normalizeExcludeUrls(input: unknown): Set<string> {
  if (!Array.isArray(input)) return new Set<string>();
  const out = new Set<string>();
  for (const raw of input) {
    const url = compactText(raw);
    if (!/^https?:\/\//i.test(url)) continue;
    out.add(url);
  }
  return out;
}

export function summarizeSearchError(error: any): string {
  const stderr = compactText(error?.stderr);
  const shortMessage = compactText(error?.shortMessage);
  const message = compactText(error?.message);
  const raw = stderr || shortMessage || message || 'Unknown search error';
  return raw.slice(0, 220);
}

export function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (!text) return null;
    if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  }
  return null;
}

export function normalizeYoutubeWatchUrl(input: unknown): string {
  const raw = compactText(input);
  if (!raw || !/^https?:\/\//i.test(raw)) return '';

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = compactText(parsed.pathname.replace(/^\//, ''));
      if (!id) return '';
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }

    if (host !== 'youtube.com' && host !== 'm.youtube.com') return '';

    if (parsed.pathname === '/watch') {
      const id = compactText(parsed.searchParams.get('v'));
      if (!id) return '';
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }

    if (parsed.pathname.startsWith('/shorts/')) {
      const id = compactText(
        parsed.pathname.replace('/shorts/', '').split('/')[0]
      );
      if (!id) return '';
      return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    }
  } catch {
    return '';
  }

  return '';
}

export function normalizeYoutubeChannelUrl(input: unknown): string | undefined {
  const raw = compactText(input);
  if (!raw || !/^https?:\/\//i.test(raw)) return undefined;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/^m\./, '');
    if (host !== 'youtube.com') return undefined;
    const path = parsed.pathname.replace(/\/+$/, '');
    if (!path || path === '/') return undefined;
    if (
      path.startsWith('/@') ||
      path.startsWith('/channel/') ||
      path.startsWith('/c/') ||
      path.startsWith('/user/')
    ) {
      return `https://www.youtube.com${path}`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function extractYoutubeVideoId(url: string): string {
  const normalized = normalizeYoutubeWatchUrl(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const id = compactText(parsed.searchParams.get('v'));
    if (!id) return '';
    return id.slice(0, 20);
  } catch {
    return '';
  }
}

export function fallbackYoutubeThumbnailUrl(url: string): string | undefined {
  const id = extractYoutubeVideoId(url);
  if (!id) return undefined;
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
}

export function normalizeUploadedAt(input: unknown): string | undefined {
  const value = compactText(input);
  if (!value) return undefined;

  const compactMatch = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    return `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
  }

  const dashedMatch = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (dashedMatch) {
    const year = dashedMatch[1];
    const month = String(Number(dashedMatch[2]) || '').padStart(2, '0');
    const day = String(Number(dashedMatch[3]) || '').padStart(2, '0');
    if (!month || !day) return undefined;
    return `${year}-${month}-${day}`;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString().slice(0, 10);
}
