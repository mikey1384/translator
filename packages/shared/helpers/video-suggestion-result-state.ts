import type { VideoSuggestionResultItem } from '@shared-types/app';

export function mergeVideoSuggestionResults(
  current: VideoSuggestionResultItem[],
  incoming: VideoSuggestionResultItem[]
): VideoSuggestionResultItem[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(item => item.url));
  const fresh = incoming.filter(item => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  return fresh.length > 0 ? [...current, ...fresh] : current;
}

/**
 * Reconciles the authoritative Search More response against the result list
 * captured before the operation. Streamed candidates are intentionally not an
 * input: they are provisional and may have been rejected by final hard rails
 * such as the recency filter.
 */
export function finalizeVideoSuggestionSearchMoreResults(
  baseline: VideoSuggestionResultItem[],
  incoming: VideoSuggestionResultItem[]
): { results: VideoSuggestionResultItem[]; gainedResults: boolean } {
  const results = mergeVideoSuggestionResults(baseline, incoming);
  return {
    results,
    gainedResults: results.length > baseline.length,
  };
}
