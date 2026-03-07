import { execa } from 'execa';
import log from 'electron-log';
import type {
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import {
  ensureJsRuntime,
  ensureYtDlpBinary,
} from '../url-processor/binary-installer.js';
import {
  emitSuggestionProgress,
  type SuggestionProgressCallback,
} from './progress.js';
import { terminateProcess } from '../../utils/process-killer.js';
import {
  type CreatorSearchOutcome,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampTraceMessage,
  compactText,
  fallbackYoutubeThumbnailUrl,
  normalizeUploadedAt,
  normalizeYoutubeChannelUrl,
  normalizeYoutubeWatchUrl,
  isYoutubeVideoSuggestionUrl,
  quotedStatusValue,
  isSuggestionAbortError,
  sanitizeRetrievalSearchQuery,
  sanitizeSearchKeywords,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';

type YtDlpEntry = Record<string, unknown>;
const YT_DLP_NATIVE_SEARCH_PREFIX = 'ytsearch';

function buildYoutubeScopedQueries(query: string): string[] {
  const normalized =
    sanitizeRetrievalSearchQuery(query) || sanitizeSearchKeywords(query);
  if (!normalized) return [];
  return [normalized];
}

function buildYoutubeQueryPool({
  baseQuery,
  queries,
}: {
  baseQuery: string;
  queries?: string[];
}): string[] {
  const seedQueries = uniqueTexts([
    ...(queries || []).map(value => sanitizeRetrievalSearchQuery(value)),
    sanitizeRetrievalSearchQuery(baseQuery) ||
      sanitizeSearchKeywords(baseQuery),
  ]);
  return uniqueTexts(seedQueries.flatMap(buildYoutubeScopedQueries)).slice(
    0,
    12
  );
}

function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
  ]) {
    delete env[key];
  }
  for (const key of ['REQUESTS_CA_BUNDLE', 'SSL_CERT_FILE', 'CURL_CA_BUNDLE']) {
    delete env[key];
  }
  for (const key of ['PYTHONHOME', 'PYTHONPATH', 'PYTHONSTARTUP']) {
    delete env[key];
  }
  for (const key of [
    'NODE_OPTIONS',
    'NPM_CONFIG_PROXY',
    'NPM_CONFIG_HTTPS_PROXY',
  ]) {
    delete env[key];
  }
  return env;
}

function buildYtDlpEnv(jsRuntime: string | null): NodeJS.ProcessEnv {
  const env = buildChildEnv();
  env.PYTHONUNBUFFERED = '1';
  env.PYTHONIOENCODING = 'utf-8';

  if (!jsRuntime) return env;
  env.YTDLP_JSRUNTIME = jsRuntime;

  if (jsRuntime.startsWith('node:')) {
    const runtimePath = jsRuntime.slice('node:'.length);
    if (
      runtimePath &&
      runtimePath === process.execPath &&
      typeof process.versions?.electron === 'string'
    ) {
      env.ELECTRON_RUN_AS_NODE = '1';
    }
  }

  return env;
}

function recencyDays(recency: VideoSuggestionRecency): number | null {
  switch (recency) {
    case 'day':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'year':
      return 365;
    default:
      return null;
  }
}

function toCompactDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function dateAfterForRecency(
  recency: VideoSuggestionRecency
): string | undefined {
  const days = recencyDays(recency);
  if (!days) return undefined;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return toCompactDate(cutoff);
}

function parseYtDlpJsonLines(output: string): YtDlpEntry[] {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const rows: YtDlpEntry[] = [];
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        rows.push(parsed as YtDlpEntry);
      }
    } catch {
      // Ignore malformed lines.
    }
  }
  return rows;
}

function extractThumbnail(entry: YtDlpEntry): string | undefined {
  const single = compactText(entry.thumbnail);
  if (single && /^https?:\/\//i.test(single)) return single;

  const thumbs = Array.isArray(entry.thumbnails)
    ? (entry.thumbnails as unknown[])
    : [];
  for (let i = thumbs.length - 1; i >= 0; i--) {
    const candidate = thumbs[i];
    if (candidate && typeof candidate === 'object') {
      const url = compactText((candidate as { url?: unknown }).url);
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  }
  return undefined;
}

const YOUTUBE_ROOT_URL = 'https://www.youtube.com';

function normalizeAbsoluteHttpUrl(value: string): string {
  const normalized = compactText(value);
  if (!normalized || /\s/.test(normalized)) return '';
  if (/^https?:\/\//i.test(normalized)) return normalized;

  const candidate = normalized.startsWith('//')
    ? `https:${normalized}`
    : `https://${normalized}`;
  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function normalizeYoutubePathUrl(value: string): string {
  const normalized = compactText(value);
  if (!normalized || /\s/.test(normalized)) return '';
  if (!normalized.startsWith('/')) return '';
  return `${YOUTUBE_ROOT_URL}${normalized}`;
}

function normalizeYoutubeIdentifierUrl(entry: YtDlpEntry): string {
  const rawId = compactText(entry.id).replace(/^\/+|\/+$/g, '');
  if (!rawId || /\s/.test(rawId)) return '';

  const normalized = normalizeYoutubeWatchUrl(
    `${YOUTUBE_ROOT_URL}/watch?v=${rawId}`
  );
  return normalized || '';
}

function normalizeYoutubeYtDlpUrl(entry: YtDlpEntry): string {
  const rawWebpage = compactText(entry.webpage_url);
  const rawUrl = compactText(entry.url);
  const rawId = compactText(entry.id);

  const candidates = [rawWebpage, rawUrl, rawId].filter(Boolean);
  for (const candidate of candidates) {
    const absoluteCandidate =
      normalizeAbsoluteHttpUrl(candidate) || normalizeYoutubePathUrl(candidate);
    if (!absoluteCandidate) continue;
    const normalized = normalizeYoutubeWatchUrl(absoluteCandidate);
    if (normalized) return normalized;
  }
  return normalizeYoutubeIdentifierUrl(entry);
}

function normalizeYoutubeYtDlpResult(
  entry: YtDlpEntry,
  index: number
): VideoSuggestionResultItem | null {
  const url = normalizeYoutubeYtDlpUrl(entry);
  if (!url) return null;

  const title =
    compactText(entry.title) ||
    compactText(entry.fulltitle) ||
    'Untitled video';
  const channel =
    compactText(entry.channel) ||
    compactText(entry.uploader) ||
    compactText(entry.creator) ||
    undefined;
  const rawChannelUrl = compactText(
    entry.channel_url ?? entry.uploader_url ?? entry.author_url ?? ''
  );
  const channelId = compactText(entry.channel_id);
  const channelUrl =
    normalizeYoutubeChannelUrl(
      entry.channel_url ?? entry.uploader_url ?? entry.uploader
    ) ||
    (channelId ? `${YOUTUBE_ROOT_URL}/channel/${channelId}` : undefined) ||
    (/^https?:\/\//i.test(rawChannelUrl) ? rawChannelUrl : undefined);
  const thumbnailUrl =
    extractThumbnail(entry) || fallbackYoutubeThumbnailUrl(url);

  const durationRaw =
    typeof entry.duration === 'number'
      ? entry.duration
      : Number(entry.duration);
  const durationSec =
    Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;

  const timestampRaw =
    typeof entry.timestamp === 'number'
      ? entry.timestamp
      : Number(entry.timestamp);
  const timestampIso =
    Number.isFinite(timestampRaw) && timestampRaw > 0
      ? new Date(timestampRaw * 1000).toISOString()
      : '';
  const uploadedAt = normalizeUploadedAt(
    entry.upload_date ?? entry.release_date ?? timestampIso
  );

  return {
    id: `yt-dlp-${index + 1}`,
    title,
    url,
    channel,
    channelUrl,
    thumbnailUrl,
    durationSec,
    uploadedAt,
  };
}

function applyRecencyPreference(
  items: VideoSuggestionResultItem[],
  recency: VideoSuggestionRecency
): {
  items: VideoSuggestionResultItem[];
  recentCount: number;
  unknownCount: number;
  oldCount: number;
  strictApplied: boolean;
} {
  const days = recencyDays(recency);
  if (!days) {
    return {
      items,
      recentCount: items.length,
      unknownCount: 0,
      oldCount: 0,
      strictApplied: false,
    };
  }

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent: VideoSuggestionResultItem[] = [];
  const unknownDate: VideoSuggestionResultItem[] = [];
  const old: VideoSuggestionResultItem[] = [];

  for (const item of items) {
    const date = compactText(item.uploadedAt);
    if (!date) {
      unknownDate.push(item);
      continue;
    }
    const ts = Date.parse(date);
    if (!Number.isFinite(ts)) {
      unknownDate.push(item);
      continue;
    }
    if (ts >= cutoffMs) {
      recent.push(item);
    } else {
      old.push(item);
    }
  }

  return {
    // Strict dropdown behavior: when recency is selected, only dated matches
    // within the window are kept.
    items: recent,
    recentCount: recent.length,
    unknownCount: unknownDate.length,
    oldCount: old.length,
    strictApplied: true,
  };
}

function buildYoutubeSearchPageUrl(query: string): string {
  const encoded = encodeURIComponent(query);
  return `${YOUTUBE_ROOT_URL}/results?search_query=${encoded}`;
}

function buildYoutubeSeedUrls({
  seedUrls,
  fallbackQueries,
}: {
  seedUrls: string[];
  fallbackQueries: string[];
}): string[] {
  const explicitUrls = uniqueTexts(
    seedUrls.map(value => compactText(value)).filter(Boolean)
  ).filter(isYoutubeVideoSuggestionUrl);
  const fallbackSearchPages = fallbackQueries
    .map(buildYoutubeSearchPageUrl)
    .filter(isYoutubeVideoSuggestionUrl);
  return uniqueTexts([...explicitUrls, ...fallbackSearchPages]).slice(0, 24);
}

async function runAbortableYtDlpCommand({
  ytDlpPath,
  args,
  env,
  signal,
  logPrefix,
  fallbackMessage,
}: {
  ytDlpPath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  logPrefix: string;
  fallbackMessage: string;
}): Promise<string> {
  throwIfSuggestionAborted(signal);

  const subprocess = execa(ytDlpPath, args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 24 * 1024 * 1024,
    env,
  });

  const abortListener = () => {
    void terminateProcess({
      childProcess: subprocess,
      logPrefix,
    }).catch(error => {
      log.warn(`[${logPrefix}] Failed to terminate yt-dlp on abort:`, error);
    });
  };

  signal?.addEventListener('abort', abortListener, { once: true });

  try {
    const result = await subprocess;
    return String(result.stdout || '');
  } catch (error: any) {
    if (isSuggestionAbortError(error, signal)) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    const fallbackStdout =
      typeof error?.stdout === 'string' ? error.stdout : '';
    if (fallbackStdout.trim()) {
      return fallbackStdout;
    }
    const stderr =
      typeof error?.stderr === 'string' ? compactText(error.stderr) : '';
    throw new Error(
      stderr ||
        compactText(error?.shortMessage) ||
        compactText(error?.message) ||
        fallbackMessage
    );
  } finally {
    signal?.removeEventListener('abort', abortListener);
  }
}

async function runYtDlpKeywordSearch({
  ytDlpPath,
  env,
  searchPrefix,
  query,
  limit,
  dateAfter,
  signal,
}: {
  ytDlpPath: string;
  env: NodeJS.ProcessEnv;
  searchPrefix: string;
  query: string;
  limit: number;
  dateAfter?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const args = [
    `${searchPrefix}${limit}:${query}`,
    '--skip-download',
    '--dump-json',
    '--no-warnings',
    '--no-progress',
    '--ignore-errors',
  ];
  if (dateAfter) {
    args.push('--dateafter', dateAfter);
  }
  return runAbortableYtDlpCommand({
    ytDlpPath,
    args,
    env,
    signal,
    logPrefix: 'video-suggestions-yt-dlp-query',
    fallbackMessage: 'yt-dlp search failed.',
  });
}

async function runYtDlpUrlSeedSearch({
  ytDlpPath,
  env,
  targetUrl,
  limit,
  flatPlaylist,
  dateAfter,
  signal,
}: {
  ytDlpPath: string;
  env: NodeJS.ProcessEnv;
  targetUrl: string;
  limit: number;
  flatPlaylist: boolean;
  dateAfter?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const args = [
    targetUrl,
    '--skip-download',
    '--dump-json',
    '--yes-playlist',
    '--playlist-end',
    String(limit),
    '--no-warnings',
    '--no-progress',
    '--ignore-errors',
  ];
  if (flatPlaylist) {
    args.push('--flat-playlist');
  }
  if (dateAfter) {
    args.push('--dateafter', dateAfter);
  }
  return runAbortableYtDlpCommand({
    ytDlpPath,
    args,
    env,
    signal,
    logPrefix: 'video-suggestions-yt-dlp-seed',
    fallbackMessage: 'yt-dlp url-seed search failed.',
  });
}

export async function runYoutubeYtDlpSearch({
  baseQuery,
  queries,
  recency,
  operationId,
  maxResults,
  excludeUrls,
  seedUrls = [],
  continuationDepth = 0,
  onProgress,
  signal,
}: {
  baseQuery: string;
  queries?: string[];
  countryHint: string;
  recency: VideoSuggestionRecency;
  translationPhase: 'draft' | 'review';
  model: string;
  operationId: string;
  maxResults: number;
  excludeUrls: Set<string>;
  seedUrls?: string[];
  continuationDepth?: number;
  onProgress?: SuggestionProgressCallback;
  signal?: AbortSignal;
}): Promise<CreatorSearchOutcome> {
  const startedAt = Date.now();
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  throwIfSuggestionAborted(signal);
  const effectiveQuery =
    sanitizeRetrievalSearchQuery(baseQuery) ||
    sanitizeSearchKeywords(baseQuery);
  const candidateLimit = Math.min(
    240,
    Math.max(
      24,
      maxResults * 2,
      excludeUrls.size + maxResults * (2 + Math.max(0, continuationDepth))
    )
  );
  const youtubeQueries = buildYoutubeQueryPool({
    baseQuery: effectiveQuery,
    queries,
  });
  const queriesToTry =
    youtubeQueries.length > 0 ? youtubeQueries : [effectiveQuery];
  const seedUrlPool = buildYoutubeSeedUrls({
    seedUrls,
    fallbackQueries: queriesToTry,
  });
  const previewQuery = queriesToTry[0] || effectiveQuery;
  const perSeedLimit = Math.min(
    24,
    Math.max(
      8,
      Math.ceil(
        candidateLimit / Math.max(2, Math.min(seedUrlPool.length || 2, 6))
      )
    )
  );
  const useFlatPlaylist = true;

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Searching ${platformLabel} via yt-dlp for ${quotedStatusValue(effectiveQuery)}.`,
    searchQuery: previewQuery,
    elapsedMs: Date.now() - startedAt,
  });
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `yt-dlp mode: native-search (${YT_DLP_NATIVE_SEARCH_PREFIX}); limit=${candidateLimit}.`,
    searchQuery: previewQuery,
    elapsedMs: Date.now() - startedAt,
  });

  const ytDlpPath = await ensureYtDlpBinary();
  throwIfSuggestionAborted(signal);
  const jsRuntime = await ensureJsRuntime();
  throwIfSuggestionAborted(signal);
  const env = buildYtDlpEnv(jsRuntime);
  const dateAfter = dateAfterForRecency(recency);
  const recencyStatusForTrace = dateAfter
    ? `recency=${recency}; dateAfter=${dateAfter}`
    : 'recency=any; date filter=off (old videos allowed)';

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: dateAfter
      ? `Recency filter enabled: ${quotedStatusValue(dateAfter)} and newer.`
      : 'Recency filter disabled: any upload date is allowed.',
    searchQuery: previewQuery,
    elapsedMs: Date.now() - startedAt,
  });

  const parsedRows: YtDlpEntry[] = [];
  const triedQueries: string[] = [];
  const triedSeedUrls: string[] = [];

  const runUrlSeedLoop = async (seedIntroMessage?: string) => {
    throwIfSuggestionAborted(signal);
    if (seedUrlPool.length === 0) return;
    if (seedIntroMessage) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'searching',
        message: seedIntroMessage,
        searchQuery: seedUrlPool[0],
        elapsedMs: Date.now() - startedAt,
      });
    }
    for (let i = 0; i < seedUrlPool.length; i++) {
      throwIfSuggestionAborted(signal);
      if (parsedRows.length >= candidateLimit) break;
      const seedUrl = seedUrlPool[i];
      triedSeedUrls.push(seedUrl);
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'searching',
        message: `yt-dlp seed ${i + 1}/${seedUrlPool.length}: collecting candidates.`,
        searchQuery: seedUrl,
        elapsedMs: Date.now() - startedAt,
      });
      let raw = '';
      let parsed: YtDlpEntry[] = [];
      try {
        raw = await runYtDlpUrlSeedSearch({
          ytDlpPath,
          env,
          targetUrl: seedUrl,
          limit: perSeedLimit,
          flatPlaylist: useFlatPlaylist,
          dateAfter,
          signal,
        });
        parsed = parseYtDlpJsonLines(raw);
      } catch (error) {
        if (isSuggestionAbortError(error, signal)) {
          throw error;
        }
        parsed = [];
      }
      if (parsed.length > 0) {
        parsedRows.push(...parsed);
      }
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'searching',
        message: `yt-dlp seed ${i + 1}/${seedUrlPool.length}: ${parsed.length} rows (total ${parsedRows.length}).`,
        searchQuery: seedUrl,
        elapsedMs: Date.now() - startedAt,
      });
    }
  };

  for (let i = 0; i < queriesToTry.length; i++) {
    throwIfSuggestionAborted(signal);
    if (parsedRows.length >= candidateLimit) break;
    const scopedQuery = queriesToTry[i];
    triedQueries.push(scopedQuery);
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `yt-dlp query ${i + 1}/${queriesToTry.length}: running native search.`,
      searchQuery: scopedQuery,
      elapsedMs: Date.now() - startedAt,
    });
    let raw = '';
    let parsed: YtDlpEntry[] = [];
    try {
      raw = await runYtDlpKeywordSearch({
        ytDlpPath,
        env,
        searchPrefix: YT_DLP_NATIVE_SEARCH_PREFIX,
        query: scopedQuery,
        limit: candidateLimit,
        dateAfter,
        signal,
      });
      parsed = parseYtDlpJsonLines(raw);
    } catch (error) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      parsed = [];
    }

    if (parsed.length > 0) {
      parsedRows.push(...parsed);
    }
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `yt-dlp query ${i + 1}/${queriesToTry.length}: ${parsed.length} rows (total ${parsedRows.length}).`,
      searchQuery: scopedQuery,
      elapsedMs: Date.now() - startedAt,
    });
  }

  if (parsedRows.length === 0) {
    await runUrlSeedLoop(
      `Native search returned no candidates; trying discovered ${platformLabel} URLs.`
    );
  }

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Normalizing and de-duplicating ${parsedRows.length} raw candidates.`,
    searchQuery: triedQueries[0] || triedSeedUrls[0] || effectiveQuery,
    elapsedMs: Date.now() - startedAt,
  });

  const seenUrls = new Set<string>(excludeUrls);
  const normalizedCandidates: VideoSuggestionResultItem[] = [];
  for (let i = 0; i < parsedRows.length; i++) {
    throwIfSuggestionAborted(signal);
    const normalized = normalizeYoutubeYtDlpResult(parsedRows[i], i);
    if (!normalized) continue;
    if (!isYoutubeVideoSuggestionUrl(normalized.url)) {
      continue;
    }
    if (seenUrls.has(normalized.url)) continue;
    seenUrls.add(normalized.url);
    normalizedCandidates.push(normalized);
    if (normalizedCandidates.length >= candidateLimit) break;
  }

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message:
      recency === 'any'
        ? 'Recency is any time: keeping older and newer uploads.'
        : 'Applying strict recency filter to candidates.',
    searchQuery: triedQueries[0] || triedSeedUrls[0] || effectiveQuery,
    elapsedMs: Date.now() - startedAt,
  });

  const recencyOutcome = applyRecencyPreference(normalizedCandidates, recency);
  const rankingCandidateLimit = Math.min(
    60,
    Math.max(maxResults, maxResults * 3)
  );
  const results = recencyOutcome.items.slice(0, rankingCandidateLimit);
  const visibleResultCount = Math.min(results.length, maxResults);

  const creators = uniqueTexts(
    results.map(item => compactText(item.channel || '')).filter(Boolean)
  ).slice(0, 6);
  const confidence =
    visibleResultCount === 0
      ? 0
      : Math.min(
          100,
          55 + Math.round((visibleResultCount / Math.max(1, maxResults)) * 45)
        );

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `yt-dlp ${platformLabel} candidates: ${summarizeValues(creators, 4)}. Prepared ${results.length}/${normalizedCandidates.length} for ranking.`,
    searchQuery: triedQueries[0] || triedSeedUrls[0] || effectiveQuery,
    assistantPreview: clampTraceMessage(
      recencyOutcome.strictApplied
        ? `Mode=native-search; recency=${recency} strict kept=${recencyOutcome.recentCount}/${normalizedCandidates.length} (unknown=${recencyOutcome.unknownCount}, old=${recencyOutcome.oldCount}); source=${platformLabel}.`
        : `Mode=native-search; candidate limit=${candidateLimit}; ${recencyStatusForTrace}; source=${platformLabel}.`,
      220
    ),
    elapsedMs: Date.now() - startedAt,
    resultCount: results.length,
  });

  const lowConfidenceReason =
    results.length === 0
      ? recencyOutcome.strictApplied && normalizedCandidates.length > 0
        ? 'no-recency-matches'
        : 'no-scored-results'
      : undefined;

  return {
    results,
    searchQuery: triedQueries[0] || triedSeedUrls[0] || effectiveQuery,
    creators,
    queriesTried: uniqueTexts([...triedQueries, ...triedSeedUrls]),
    confidence,
    candidateCount: normalizedCandidates.length,
    lowConfidenceReason,
  };
}
