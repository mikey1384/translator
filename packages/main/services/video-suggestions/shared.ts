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
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
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
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
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

export function sanitizeYoutubeRegionCode(input: unknown): string {
  const text = compactText(input).toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : '';
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

const REGION_DISPLAY_NAMES = new Intl.DisplayNames(['en'], {
  type: 'region',
});

export function buildYoutubeSearchPageUrl({
  query,
  youtubeRegionCode,
  youtubeSearchLanguage,
}: {
  query: string;
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
}): string {
  const url = new URL(`${YOUTUBE_ROOT_URL}/results`);
  url.searchParams.set('search_query', compactText(query));
  const regionCode = sanitizeYoutubeRegionCode(youtubeRegionCode);
  const searchLanguage = sanitizeLanguageToken(
    youtubeSearchLanguage
  ).toLowerCase();
  if (regionCode) {
    url.searchParams.set('gl', regionCode);
  }
  if (searchLanguage) {
    url.searchParams.set('hl', searchLanguage);
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

export function normalizeIntentCandidates(input: unknown): IntentCandidate[] {
  const rawItems = Array.isArray(input) ? input : [];
  const out: IntentCandidate[] = [];
  const seen = new Set<string>();

  for (const rawItem of rawItems) {
    const source =
      rawItem && typeof rawItem === 'object'
        ? (rawItem as Record<string, unknown>)
        : null;
    const name = clampMessage(
      compactText(source ? (source.name ?? source.channel) : rawItem)
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
  return uniqueTexts(
    rawItems
      .map(value => sanitizeSearchKeywords(String(value || '')))
      .filter(Boolean)
  ).slice(0, 8);
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
}: {
  candidates?: unknown;
  descriptorPhrases?: unknown;
  resolvedIntent?: string;
  latestUserQuery?: string;
}): string[] {
  const rankedCandidates = normalizeIntentCandidates(candidates)
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => {
      const weightDelta =
        candidateConfidenceWeight(b.confidence) -
        candidateConfidenceWeight(a.confidence);
      return weightDelta !== 0 ? weightDelta : a.index - b.index;
    });
  const candidateNames = rankedCandidates
    .map(item => sanitizeSearchKeywords(item.name))
    .filter(Boolean)
    .slice(0, 8);
  const cleanedDescriptors = normalizeDescriptorPhrases(descriptorPhrases).slice(
    0,
    4
  );
  const combinedQueries: string[] = [];

  for (const candidateName of candidateNames.slice(0, 4)) {
    for (const descriptor of cleanedDescriptors.slice(0, 2)) {
      const combined = sanitizeSearchKeywords(`${candidateName} ${descriptor}`);
      if (combined) {
        combinedQueries.push(combined);
      }
    }
  }

  return uniqueTexts(
    [
      ...candidateNames,
      ...combinedQueries,
      ...cleanedDescriptors,
      sanitizeSearchKeywords(resolvedIntent || ''),
      sanitizeSearchKeywords(latestUserQuery || ''),
    ].filter(Boolean)
  ).slice(0, 12);
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
