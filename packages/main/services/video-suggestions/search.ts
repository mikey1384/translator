import type {
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import type { SuggestionProgressCallback } from './progress.js';
import {
  consumeContinuationPage,
  splitContinuationPageResults,
} from './pagination.js';
import { runYoutubeYtDlpSearch } from './retrieval.js';
import {
  type SeedSearchOutcome,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  describeLowConfidenceReason,
  isYoutubeVideoSuggestionUrl,
  normalizeCountryCode,
  quotedStatusValue,
  sanitizeRetrievalSearchQuery,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  summarizeTopTitles,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';
import { emitSuggestionProgress } from './progress.js';

export type VideoSearchContinuation = {
  countryHint: string;
  countryCode?: string;
  searchLocale?: string;
  recency: VideoSuggestionRecency;
  translationPhase: 'draft' | 'review';
  model: string;
  maxResults: number;
  intentQuery: string;
  retrievalQueries: string[];
  retrievalSeedUrls: string[];
  selectedChannels: string[];
  iteration: number;
  pendingResults?: VideoSuggestionResultItem[];
};

export type VideoSearchRunOutcome = SeedSearchOutcome & {
  continuation: VideoSearchContinuation;
};

export function createVideoSearchContinuation({
  countryHint,
  countryCode,
  searchLocale,
  recency,
  translationPhase,
  model,
  maxResults,
  intentQuery,
  retrievalQueries,
  retrievalSeedUrls,
  selectedChannels,
  iteration,
  pendingResults,
}: VideoSearchContinuation): VideoSearchContinuation {
  const sanitizedIntentQuery =
    sanitizeRetrievalSearchQuery(intentQuery) ||
    sanitizeSearchKeywords(intentQuery);
  const sanitizedQueries = uniqueTexts(
    retrievalQueries.map(query => sanitizeRetrievalSearchQuery(query))
  ).slice(0, 10);
  const sanitizedSeedUrls = uniqueTexts(
    retrievalSeedUrls.map(url => compactText(url))
  )
    .filter(isYoutubeVideoSuggestionUrl)
    .slice(0, 24);
  const sanitizedChannels = uniqueTexts(
    selectedChannels.map(value => compactText(value))
  ).slice(0, 6);
  const seenPendingUrls = new Set<string>();
  const sanitizedPendingResults = (pendingResults || []).filter(item => {
    if (!item?.url || seenPendingUrls.has(item.url)) return false;
    seenPendingUrls.add(item.url);
    return true;
  });

  return {
    countryHint: compactText(countryHint),
    countryCode: normalizeCountryCode(countryCode),
    searchLocale:
      sanitizeLanguageToken(searchLocale).toLowerCase() || undefined,
    recency,
    translationPhase,
    model,
    maxResults,
    intentQuery: sanitizedIntentQuery || compactText(intentQuery),
    retrievalQueries:
      sanitizedQueries.length > 0
        ? sanitizedQueries
        : sanitizedIntentQuery
          ? [sanitizedIntentQuery]
          : [],
    retrievalSeedUrls: sanitizedSeedUrls,
    selectedChannels: sanitizedChannels,
    iteration: Math.max(0, Math.floor(iteration)),
    pendingResults: sanitizedPendingResults,
  };
}

function emitContinuationReuseStages({
  continuation,
  effectiveSeedUrls,
  excludeUrls,
  retrievalQueries,
  initialQuery,
  nextIteration,
  operationId,
  onProgress,
  startedAt,
}: {
  continuation: VideoSearchContinuation;
  effectiveSeedUrls: string[];
  excludeUrls: Set<string>;
  retrievalQueries: string[];
  initialQuery: string;
  nextIteration: number;
  operationId: string;
  onProgress?: SuggestionProgressCallback;
  startedAt: number;
}): void {
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: 'Step 1/3 cleared: reusing prior answer context.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      `Intent stays ${quotedStatusValue(continuation.intentQuery, 120)}.`,
      240
    ),
    stageKey: 'answerer',
    stageIndex: 1,
    stageTotal: 3,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Continuation iteration: ${nextIteration}.`,
        `Reused intent query: ${quotedStatusValue(continuation.intentQuery, 120)}.`,
        `Country hint carried forward: ${quotedStatusValue(continuation.countryHint || 'global results', 120)}.`,
        `Recency carried forward: ${quotedStatusValue(continuation.recency, 120)}.`,
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: 'Step 2/3 cleared: reusing prior search formulation.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      continuation.selectedChannels.length > 0
        ? `Reusing prior candidate context: ${summarizeValues(
            continuation.selectedChannels,
            5
          )}.`
        : `Reusing prior search query plan.`,
      320
    ),
    stageKey: 'planner',
    stageIndex: 2,
    stageTotal: 3,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        continuation.selectedChannels.length > 0
          ? `Candidate context carried forward (${continuation.selectedChannels.length}): ${summarizeValues(
              continuation.selectedChannels,
              5
            )}.`
          : 'No stored candidate context carried forward.',
        `Seed URLs carried forward: ${effectiveSeedUrls.length}.`,
        'Skipped a fresh answerer/formulator pass for this continuation.',
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: 'Step 3/3 running: reusing prior search plan.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      `Reusing retrieval queries: ${summarizeValues(retrievalQueries, 4)}.`,
      320
    ),
    stageKey: 'retrieval',
    stageIndex: 3,
    stageTotal: 3,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Reused retrieval queries (${retrievalQueries.length}): ${summarizeValues(
          retrievalQueries,
          4
        )}.`,
        `Already excluded URLs: ${excludeUrls.size}.`,
        `Passed to step 3: ${quotedStatusValue(initialQuery, 120)}.`,
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });
}

export async function runVideoSearch({
  continuation,
  excludeUrls,
  operationId,
  onProgress,
  startedAt,
  signal,
}: {
  continuation: VideoSearchContinuation;
  excludeUrls: Set<string>;
  operationId: string;
  onProgress?: SuggestionProgressCallback;
  startedAt: number;
  signal?: AbortSignal;
}): Promise<VideoSearchRunOutcome> {
  throwIfSuggestionAborted(signal);

  const retrievalQueries = uniqueTexts(
    continuation.retrievalQueries.map(query => sanitizeSearchKeywords(query))
  ).slice(0, 10);
  const initialQuery =
    retrievalQueries[0] ||
    sanitizeSearchKeywords(continuation.intentQuery) ||
    continuation.intentQuery;
  const effectiveSeedUrls = uniqueTexts(
    continuation.retrievalSeedUrls.map(url => compactText(url))
  )
    .filter(isYoutubeVideoSuggestionUrl)
    .slice(0, 24);
  const nextIteration = Math.max(0, continuation.iteration) + 1;

  emitContinuationReuseStages({
    continuation,
    effectiveSeedUrls,
    excludeUrls,
    retrievalQueries,
    initialQuery,
    nextIteration,
    operationId,
    onProgress,
    startedAt,
  });

  const pendingPage = consumeContinuationPage({
    items: continuation.pendingResults || [],
    pageSize: continuation.maxResults,
    excludeUrls,
  });
  if (pendingPage.pageResults.length > 0) {
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Serving ${pendingPage.pageResults.length} buffered result${pendingPage.pageResults.length === 1 ? '' : 's'}.`,
      searchQuery: initialQuery,
      resultCount: pendingPage.pageResults.length,
      elapsedMs: Date.now() - startedAt,
    });

    const channels = uniqueTexts(
      pendingPage.pageResults
        .map(item => compactText(item.channel || ''))
        .filter(Boolean)
    ).slice(0, 6);

    return {
      results: pendingPage.pageResults,
      searchQuery: initialQuery,
      channels,
      queriesTried: retrievalQueries,
      confidence: 100,
      candidateCount: pendingPage.pageResults.length,
      continuation: createVideoSearchContinuation({
        ...continuation,
        retrievalQueries,
        retrievalSeedUrls: effectiveSeedUrls,
        iteration: nextIteration,
        pendingResults: pendingPage.pendingResults,
      }),
    };
  }

  const retrievalOutcome = await runYoutubeYtDlpSearch({
    baseQuery: continuation.intentQuery || initialQuery,
    queries: retrievalQueries,
    countryHint: continuation.countryHint,
    countryCode: continuation.countryCode,
    searchLocale: continuation.searchLocale,
    recency: continuation.recency,
    translationPhase: continuation.translationPhase,
    model: continuation.model,
    operationId,
    maxResults: continuation.maxResults,
    excludeUrls,
    seedUrls: effectiveSeedUrls,
    continuationDepth: continuation.iteration,
    onProgress,
    signal,
  });

  const pagedResults = splitContinuationPageResults({
    items: retrievalOutcome.results,
    pageSize: continuation.maxResults,
  });

  return {
    ...retrievalOutcome,
    results: pagedResults.pageResults,
    continuation: createVideoSearchContinuation({
      ...continuation,
      intentQuery: continuation.intentQuery || retrievalOutcome.searchQuery,
      retrievalQueries:
        retrievalQueries.length > 0
          ? retrievalQueries
          : [retrievalOutcome.searchQuery],
      retrievalSeedUrls: effectiveSeedUrls,
      selectedChannels:
        retrievalOutcome.channels.length > 0
          ? retrievalOutcome.channels
          : continuation.selectedChannels,
      iteration: nextIteration,
      pendingResults: pagedResults.pendingResults,
    }),
  };
}
