import type { VideoSuggestionResultItem } from '@shared-types/app';

const CONTINUATION_CACHE_PAGE_MULTIPLIER = 2;
const CONTINUATION_CACHE_MIN_EXTRA_RESULTS = 12;
const CONTINUATION_CACHE_MAX_RESULTS = 40;

export function resolveContinuationCacheSize(pageSize: number): number {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  return Math.min(
    CONTINUATION_CACHE_MAX_RESULTS,
    Math.max(
      safePageSize,
      safePageSize * CONTINUATION_CACHE_PAGE_MULTIPLIER,
      safePageSize + CONTINUATION_CACHE_MIN_EXTRA_RESULTS
    )
  );
}

export function normalizeContinuationBufferedResults({
  items,
  pageSize,
}: {
  items: VideoSuggestionResultItem[];
  pageSize: number;
}): VideoSuggestionResultItem[] {
  const limit = resolveContinuationCacheSize(pageSize);
  const normalized: VideoSuggestionResultItem[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    const url = String(item?.url || '').trim();
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    normalized.push(item);
    if (normalized.length >= limit) break;
  }

  return normalized;
}

export function splitContinuationPageResults({
  items,
  pageSize,
}: {
  items: VideoSuggestionResultItem[];
  pageSize: number;
}): {
  pageResults: VideoSuggestionResultItem[];
  pendingResults: VideoSuggestionResultItem[];
} {
  const bufferedResults = normalizeContinuationBufferedResults({
    items,
    pageSize,
  });
  const safePageSize = Math.max(1, Math.floor(pageSize));

  return {
    pageResults: bufferedResults.slice(0, safePageSize),
    pendingResults: bufferedResults.slice(safePageSize),
  };
}

export function consumeContinuationPage({
  items,
  pageSize,
  excludeUrls,
}: {
  items: VideoSuggestionResultItem[];
  pageSize: number;
  excludeUrls?: Iterable<string>;
}): {
  pageResults: VideoSuggestionResultItem[];
  pendingResults: VideoSuggestionResultItem[];
} {
  const excluded = new Set<string>();
  for (const rawUrl of excludeUrls || []) {
    const url = String(rawUrl || '').trim();
    if (!url) continue;
    excluded.add(url);
  }

  const freshItems = items.filter(item => {
    const url = String(item?.url || '').trim();
    return Boolean(url) && !excluded.has(url);
  });

  return splitContinuationPageResults({
    items: freshItems,
    pageSize,
  });
}
