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
  type SeedSearchOutcome,
  buildYoutubeSearchPageUrl,
  compactText,
  fallbackYoutubeThumbnailUrl,
  normalizeUploadedAt,
  normalizeYoutubeChannelUrl,
  normalizeYoutubeWatchUrl,
  isYoutubeVideoSuggestionUrl,
  isSuggestionAbortError,
  sanitizeSearchKeywords,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';

type YtDlpEntry = Record<string, unknown>;

type YoutubeSearchSeed = {
  query: string;
  url: string;
};

const YOUTUBE_ROOT_URL = 'https://www.youtube.com';
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

  const viewCountRaw =
    typeof entry.view_count === 'number'
      ? entry.view_count
      : Number(entry.view_count);
  const viewCount =
    Number.isFinite(viewCountRaw) && viewCountRaw >= 0
      ? viewCountRaw
      : undefined;

  return {
    id: `yt-dlp-${index + 1}`,
    title,
    url,
    channel,
    channelUrl,
    thumbnailUrl,
    durationSec,
    uploadedAt,
    viewCount,
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
    // Recency is enforced server-side via the search URL's upload-date
    // filter, so undated flat-playlist entries are already in-window.
    // Keep them after dated matches; drop only entries known to be old.
    items: [...recent, ...unknownDate],
    recentCount: recent.length,
    unknownCount: unknownDate.length,
    oldCount: old.length,
    strictApplied: true,
  };
}

/**
 * Run every seed URL in ONE yt-dlp invocation, streaming parsed JSON rows
 * as they arrive. The official macOS yt-dlp binary spends ~15-20s on
 * process startup (onefile unpack + malware scan) versus ~1s per actual
 * search request, so batching pays the startup tax once instead of once
 * per seed. A timeout is not fatal: rows streamed before it still count.
 */
async function runYtDlpBatchedSeedSearch({
  ytDlpPath,
  env,
  targetUrls,
  limit,
  signal,
  onJsonRow,
}: {
  ytDlpPath: string;
  env: NodeJS.ProcessEnv;
  targetUrls: string[];
  limit: number;
  signal?: AbortSignal;
  onJsonRow: (row: YtDlpEntry) => void;
}): Promise<void> {
  throwIfSuggestionAborted(signal);

  const args = [
    ...targetUrls,
    '--skip-download',
    '--dump-json',
    '--yes-playlist',
    '--playlist-end',
    String(limit),
    '--no-warnings',
    '--no-progress',
    '--ignore-errors',
    // Flat extraction reads only the search/playlist page instead of
    // fetching every video's watch page — one network round trip per seed.
    '--flat-playlist',
  ];
  const timeoutMs = Math.min(150_000, 60_000 + 8_000 * targetUrls.length);
  const logPrefix = 'video-suggestions-yt-dlp-seed';

  const subprocess = execa(ytDlpPath, args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 24 * 1024 * 1024,
    env,
    buffer: false,
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

  let lineRemainder = '';
  const consumeChunk = (chunk: string) => {
    const combined = lineRemainder + chunk;
    const lines = combined.split(/\r?\n/);
    lineRemainder = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          onJsonRow(parsed as YtDlpEntry);
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  };
  subprocess.stdout?.on('data', (chunk: Buffer | string) => {
    consumeChunk(String(chunk));
  });

  try {
    await subprocess;
  } catch (error: any) {
    if (isSuggestionAbortError(error, signal)) {
      throw new DOMException('Operation cancelled', 'AbortError');
    }
    // Timeouts and per-URL extraction errors are soft failures — whatever
    // streamed before the exit is still usable.
    log.warn(
      `[${logPrefix}] yt-dlp batch ended with error (keeping streamed rows):`,
      compactText(error?.shortMessage || error?.message || String(error || ''))
    );
  } finally {
    signal?.removeEventListener('abort', abortListener);
    if (lineRemainder.trim()) {
      consumeChunk('\n');
    }
  }
}

export async function runYoutubeYtDlpSearch({
  searchQuery,
  retrievalQueries,
  retrievalSeedUrls,
  youtubeRegionCode,
  youtubeSearchLanguage,
  recency,
  maxResults,
  excludeUrls,
  operationId,
  onProgress,
  startedAt,
  signal,
}: {
  searchQuery: string;
  retrievalQueries: string[];
  retrievalSeedUrls: string[];
  youtubeRegionCode?: string;
  youtubeSearchLanguage?: string;
  recency: VideoSuggestionRecency;
  maxResults: number;
  excludeUrls: Set<string>;
  operationId: string;
  onProgress?: SuggestionProgressCallback;
  startedAt: number;
  signal?: AbortSignal;
}): Promise<SeedSearchOutcome> {
  throwIfSuggestionAborted(signal);

  const normalizedSearchQuery = sanitizeSearchKeywords(searchQuery);
  const normalizedQueries = uniqueTexts(
    retrievalQueries.map(query => sanitizeSearchKeywords(query))
  ).slice(0, 10);
  const normalizedSeedUrls = uniqueTexts(
    retrievalSeedUrls
      .map(url => compactText(url))
      .filter(isYoutubeVideoSuggestionUrl)
  ).slice(0, 24);
  const querySeeds: YoutubeSearchSeed[] = normalizedQueries.map(query => ({
    query,
    url: buildYoutubeSearchPageUrl({
      query,
      youtubeRegionCode,
      youtubeSearchLanguage,
      recency,
    }),
  }));
  const urlSeeds: YoutubeSearchSeed[] = normalizedSeedUrls.map(url => ({
    query: normalizedSearchQuery || url,
    url,
  }));
  const seenSeedUrls = new Set<string>();
  const seeds = [...querySeeds, ...urlSeeds]
    .filter(seed => {
      if (seenSeedUrls.has(seed.url)) return false;
      seenSeedUrls.add(seed.url);
      return true;
    })
    .slice(0, 10);

  if (seeds.length === 0) {
    return {
      results: [],
      searchQuery: normalizedSearchQuery,
      channels: [],
      queriesTried: normalizedQueries,
      confidence: 0,
      candidateCount: 0,
      lowConfidenceReason: 'no-scored-results',
    };
  }

  const ytDlpPath = await ensureYtDlpBinary();
  const jsRuntime = await ensureJsRuntime();
  const env = buildYtDlpEnv(jsRuntime);
  const perSeedLimit = Math.max(
    8,
    Math.min(20, Math.ceil((maxResults * 2) / seeds.length))
  );
  const excludedUrls = new Set<string>(excludeUrls);
  // Display-only dedupe for streamed partials (arrival order). Final
  // ranking dedupes separately, in seed order, after the batch returns.
  const streamedUrls = new Set<string>();
  const resultsBySeed: VideoSuggestionResultItem[][] = seeds.map(() => []);
  // Search-page rows report the originating query as their playlist name,
  // which is how a batched invocation attributes rows back to seeds.
  const seedIndexByQuery = new Map<string, number>();
  seeds.forEach((seed, index) => {
    const key = compactText(seed.query).toLowerCase();
    if (key && !seedIndexByQuery.has(key)) {
      seedIndexByQuery.set(key, index);
    }
  });
  const seedUrlSets: Array<Set<string>> = seeds.map(() => new Set<string>());
  let normalizedCount = 0;
  let streamedCount = 0;
  let streamBuffer: VideoSuggestionResultItem[] = [];
  let lastEmitAt = 0;

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Searching ${seeds.length} quer${seeds.length === 1 ? 'y' : 'ies'} on YouTube.`,
    searchQuery: normalizedSearchQuery || seeds[0].query,
    stageKey: 'retrieval',
    stageIndex: 3,
    stageTotal: 3,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });

  const flushStreamBuffer = (force = false) => {
    if (streamBuffer.length === 0) return;
    const now = Date.now();
    if (!force && streamBuffer.length < 6 && now - lastEmitAt < 2_000) return;
    lastEmitAt = now;
    const fresh = streamBuffer;
    streamBuffer = [];
    streamedCount += fresh.length;
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Loaded ${streamedCount} candidate${streamedCount === 1 ? '' : 's'} so far.`,
      searchQuery: normalizedSearchQuery || seeds[0].query,
      resultCount: streamedCount,
      partialResults: fresh,
      stageKey: 'retrieval',
      stageIndex: 3,
      stageTotal: 3,
      stageState: 'running',
      elapsedMs: Date.now() - startedAt,
    });
  };

  await runYtDlpBatchedSeedSearch({
    ytDlpPath,
    env,
    targetUrls: seeds.map(seed => seed.url),
    limit: perSeedLimit,
    signal,
    onJsonRow: row => {
      const playlistKey = compactText(
        String(row.playlist_id ?? row.playlist ?? '')
      ).toLowerCase();
      // Rows from URL seeds (channels/playlists) report their own titles;
      // anything unattributable ranks after query-seed hits.
      const seedIndex = seedIndexByQuery.get(playlistKey) ?? seeds.length - 1;

      const item = normalizeYoutubeYtDlpResult(row, normalizedCount);
      if (
        !item?.url ||
        excludedUrls.has(item.url) ||
        seedUrlSets[seedIndex].has(item.url)
      ) {
        return;
      }
      seedUrlSets[seedIndex].add(item.url);
      normalizedCount += 1;
      resultsBySeed[seedIndex].push(item);
      if (!streamedUrls.has(item.url)) {
        streamedUrls.add(item.url);
        streamBuffer.push(item);
        flushStreamBuffer();
      }
    },
  });
  flushStreamBuffer(true);

  // Merge in seed order and dedupe here, so the most precise query's hits
  // lead and duplicates keep the earliest seed's ranking, regardless of
  // row arrival order.
  const mergedUrls = new Set<string>();
  const collectedResults: VideoSuggestionResultItem[] = [];
  for (const item of resultsBySeed.flat()) {
    if (mergedUrls.has(item.url)) continue;
    mergedUrls.add(item.url);
    collectedResults.push(item);
  }

  const recencyApplied = applyRecencyPreference(collectedResults, recency);
  const finalResults = recencyApplied.items;
  const channels = uniqueTexts(
    finalResults.map(item => compactText(item.channel || '')).filter(Boolean)
  ).slice(0, 6);

  return {
    results: finalResults,
    searchQuery: normalizedSearchQuery || normalizedQueries[0] || '',
    channels,
    queriesTried: normalizedQueries,
    confidence: finalResults.length > 0 ? 100 : 0,
    candidateCount: collectedResults.length,
    lowConfidenceReason:
      finalResults.length > 0
        ? undefined
        : recency !== 'any' && collectedResults.length > 0
          ? 'no-recency-matches'
          : 'no-scored-results',
  };
}
