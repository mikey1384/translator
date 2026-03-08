import type {
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { rerankVideosWithLlm } from './rerank.js';
import type { SuggestionProgressCallback } from './progress.js';
import {
  buildDefaultCreatorDiscoveryQueries,
  curateVideoQueries,
  runDiscoveryWebSearch,
} from './discovery.js';
import {
  normalizeContinuationBufferedResults,
  resolveContinuationCacheSize,
  splitContinuationPageResults,
} from './pagination.js';
import { runYoutubeYtDlpSearch } from './retrieval.js';
import {
  type DiscoveryRetrievalMode,
  type CreatorSearchOutcome,
  type DiscoveryChannelCandidate,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  describeLowConfidenceReason,
  enrichIntentKeywords,
  isYoutubeVideoSuggestionUrl,
  quotedStatusValue,
  resolveSearchLocale,
  sanitizeLanguageToken,
  sanitizeRetrievalSearchQuery,
  sanitizeSearchKeywords,
  summarizeTopTitles,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './shared.js';
import { emitSuggestionProgress, startProgressPulse } from './progress.js';

function buildTopicWideVideoQueries({
  intentQuery,
  discoveryQueries,
}: {
  intentQuery: string;
  discoveryQueries: string[];
}): string[] {
  return uniqueTexts([
    sanitizeRetrievalSearchQuery(intentQuery),
    ...discoveryQueries.map(query => sanitizeRetrievalSearchQuery(query)),
  ]).slice(0, 10);
}

function buildRetrievalSeedUrls({
  selectedChannels,
  discoveryChannels,
}: {
  selectedChannels: string[];
  discoveryChannels: DiscoveryChannelCandidate[];
}): string[] {
  const selectedSet = new Set(
    selectedChannels
      .map(value => compactText(value).toLowerCase())
      .filter(Boolean)
  );
  const prioritized =
    selectedSet.size === 0
      ? discoveryChannels
      : [
          ...discoveryChannels.filter(item =>
            selectedSet.has(compactText(item.name).toLowerCase())
          ),
          ...discoveryChannels.filter(
            item => !selectedSet.has(compactText(item.name).toLowerCase())
          ),
        ];
  const rawUrls = prioritized.flatMap(item => [
    compactText(item.url || ''),
    ...item.evidenceUrls.map(value => compactText(value)),
  ]);
  return uniqueTexts(rawUrls).filter(isYoutubeVideoSuggestionUrl).slice(0, 24);
}

export type VideoSearchContinuation = {
  countryHint: string;
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

export type VideoSearchRunOutcome = CreatorSearchOutcome & {
  continuation: VideoSearchContinuation;
};

export function createVideoSearchContinuation({
  countryHint,
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
  const sanitizedPendingResults = normalizeContinuationBufferedResults({
    items: pendingResults || [],
    pageSize: maxResults,
  });

  return {
    countryHint: compactText(countryHint),
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
  continuationMode = 'retrieval',
  cachedResultCount = 0,
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
  continuationMode?: 'cache' | 'retrieval';
  cachedResultCount?: number;
}): void {
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: 'Step 1/4 cleared: reusing prior search strategy.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      `Intent stays ${quotedStatusValue(continuation.intentQuery, 120)}.`,
      240
    ),
    stageKey: 'strategist',
    stageIndex: 1,
    stageTotal: 4,
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
    phase: 'searching',
    message: 'Step 2/4 cleared: reusing prior discovery context.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      continuation.selectedChannels.length > 0
        ? `Reusing discovered channels: ${summarizeValues(
            continuation.selectedChannels,
            5
          )}.`
        : `Reusing broad YouTube discovery context.`,
      320
    ),
    stageKey: 'discovery',
    stageIndex: 2,
    stageTotal: 4,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        continuation.selectedChannels.length > 0
          ? `Discovered channels carried forward (${continuation.selectedChannels.length}): ${summarizeValues(
              continuation.selectedChannels,
              5
            )}.`
          : 'No fixed channels carried forward; continuing broad retrieval.',
        `Seed URLs carried forward: ${effectiveSeedUrls.length}.`,
        'Skipped a fresh discovery web search for this continuation.',
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message:
      continuationMode === 'cache'
        ? 'Step 3/4 cleared: reusing ranked results cache.'
        : 'Step 3/4 cleared: reusing prior retrieval plan.',
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      continuationMode === 'cache'
        ? `Cached ranked results ready: ${cachedResultCount}.`
        : `Reusing retrieval queries: ${summarizeValues(retrievalQueries, 4)}.`,
      320
    ),
    stageKey: 'curator',
    stageIndex: 3,
    stageTotal: 4,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      continuationMode === 'cache'
        ? [
            `Cached ranked results available before this page: ${cachedResultCount}.`,
            `Already excluded URLs in the live results list: ${excludeUrls.size}.`,
            'Fresh retrieval skipped for this page.',
          ]
        : [
            `Reused retrieval queries (${retrievalQueries.length}): ${summarizeValues(
              retrievalQueries,
              4
            )}.`,
            `Already excluded URLs: ${excludeUrls.size}.`,
            `Passed to step 4: ${quotedStatusValue(initialQuery, 120)}.`,
          ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });
}

export async function runCreatorFirstSearch({
  baseQuery,
  countryHint,
  languageTag,
  recency,
  translationPhase,
  model,
  operationId,
  maxResults,
  excludeUrls,
  onProgress,
  discoveryQueries: strategistDiscoveryQueries,
  searchLanguages: strategistSearchLanguages,
  retrievalMode: strategistRetrievalMode,
  retrievalQueries: strategistRetrievalQueries,
  intentSummary,
  strategy,
  onResolvedModel,
  signal,
}: {
  baseQuery: string;
  countryHint: string;
  languageTag?: string;
  recency: VideoSuggestionRecency;
  translationPhase: 'draft' | 'review';
  model: string;
  operationId: string;
  maxResults: number;
  excludeUrls: Set<string>;
  onProgress?: SuggestionProgressCallback;
  discoveryQueries?: string[];
  searchLanguages?: string[];
  retrievalMode?: DiscoveryRetrievalMode;
  retrievalQueries?: string[];
  intentSummary?: string;
  strategy?: string;
  onResolvedModel?: (model: string) => void;
  signal?: AbortSignal;
}): Promise<VideoSearchRunOutcome> {
  const startedAt = Date.now();
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  throwIfSuggestionAborted(signal);
  const locale = resolveSearchLocale(countryHint, languageTag);
  const primarySearchLanguage =
    sanitizeLanguageToken(strategistSearchLanguages?.[0]).toLowerCase() ||
    locale;
  const sanitizedBaseQuery = sanitizeSearchKeywords(baseQuery);

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: `Strategizing for ${quotedStatusValue(baseQuery)}.`,
    searchQuery: compactText(baseQuery),
    assistantPreview: clampTraceMessage(
      [
        intentSummary ? `Intent: ${intentSummary}` : '',
        strategy ? `Plan: ${strategy}` : '',
      ]
        .filter(Boolean)
        .join(' | ')
    ),
    stageKey: 'strategist',
    stageIndex: 1,
    stageTotal: 4,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });

  const intentQuery = enrichIntentKeywords(
    sanitizedBaseQuery || baseQuery,
    primarySearchLanguage || locale
  );
  if (intentQuery && intentQuery !== sanitizedBaseQuery) {
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'searching',
      message: `Prepared intent query: ${quotedStatusValue(intentQuery)}.`,
      searchQuery: intentQuery,
      elapsedMs: Date.now() - startedAt,
    });
  }
  const fallbackDiscoveryQueries = buildDefaultCreatorDiscoveryQueries({
    videoQuery: intentQuery || sanitizedBaseQuery,
    locale: primarySearchLanguage || locale,
  });
  const discoveryQueries = uniqueTexts([
    ...(strategistDiscoveryQueries || []).map(query =>
      sanitizeSearchKeywords(String(query || ''))
    ),
    ...fallbackDiscoveryQueries,
  ]).slice(0, 5);
  const strategistSeedQueries = uniqueTexts(
    (strategistRetrievalQueries || []).map(query =>
      sanitizeRetrievalSearchQuery(String(query || ''))
    )
  ).slice(0, 10);

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Step 2/4: discovery web search.`,
    searchQuery: discoveryQueries[0] || intentQuery,
    stageKey: 'discovery',
    stageIndex: 2,
    stageTotal: 4,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Step 1 intent handoff: ${quotedStatusValue(intentQuery, 120)}.`,
        `Discovery queries (${discoveryQueries.length}): ${summarizeValues(
          discoveryQueries,
          5
        )}.`,
      ],
      420
    ),
    elapsedMs: Date.now() - startedAt,
  });

  const discoveryOutcome = await runDiscoveryWebSearch({
    intentQuery,
    discoveryQueries,
    countryHint,
    recency,
    primarySearchLanguage,
    translationPhase,
    model,
    operationId: `${operationId}-discovery`,
    onProgress,
    onResolvedModel,
    signal,
  });
  throwIfSuggestionAborted(signal);

  const effectiveRetrievalMode: DiscoveryRetrievalMode =
    discoveryOutcome.retrievalMode || strategistRetrievalMode || 'topic';
  const retrievalModeAuthority =
    discoveryOutcome.retrievalMode === strategistRetrievalMode ||
    !strategistRetrievalMode
      ? 'discovery'
      : 'discovery-overrode-strategist';
  const useChannelCurator = effectiveRetrievalMode === 'channel';
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: useChannelCurator
      ? `Step 3/4: curator selecting channels and final queries.`
      : `Step 3/4: topic-wide retrieval planning (channel curation skipped).`,
    searchQuery:
      discoveryOutcome.queriesUsed[0] || discoveryQueries[0] || intentQuery,
    assistantPreview: clampTraceMessage(
      [
        `Retrieval mode: ${effectiveRetrievalMode} (${retrievalModeAuthority}).`,
        discoveryOutcome.retrievalModeReason,
        `Discovery channels: ${summarizeValues(
          discoveryOutcome.channels.map(item => item.name),
          5
        )}.`,
      ]
        .filter(Boolean)
        .join(' | ')
    ),
    stageKey: 'curator',
    stageIndex: 3,
    stageTotal: 4,
    stageState: 'running',
    elapsedMs: Date.now() - startedAt,
  });

  let selectedChannels: string[] = [];
  let step3AssistantMessage = '';
  let videoQueries: string[] = [];

  if (useChannelCurator) {
    const curatorOutcome = await curateVideoQueries({
      intentQuery,
      countryHint,
      recency,
      primarySearchLanguage,
      channels: discoveryOutcome.channels,
      translationPhase,
      model,
      operationId: `${operationId}-curator`,
      onResolvedModel,
      signal,
    });
    throwIfSuggestionAborted(signal);
    selectedChannels = curatorOutcome.selectedChannels;
    step3AssistantMessage = curatorOutcome.assistantMessage;

    const fallbackVideoQueries = uniqueTexts(
      discoveryOutcome.channels
        .slice(0, 5)
        .map(item =>
          sanitizeRetrievalSearchQuery(
            `${item.name} ${intentQuery} ${
              primarySearchLanguage === 'ja'
                ? '配信 アーカイブ'
                : primarySearchLanguage === 'ko'
                  ? '방송 다시보기'
                  : 'stream archive'
            }`
          )
        )
    );
    videoQueries = uniqueTexts([
      ...strategistSeedQueries,
      ...curatorOutcome.videoQueries.map(query =>
        sanitizeRetrievalSearchQuery(query)
      ),
      ...fallbackVideoQueries,
    ]).slice(0, 10);

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'ranking',
      message: `Step 3/4 cleared: curator selected ${selectedChannels.length} channels and ${videoQueries.length} video queries.`,
      searchQuery: videoQueries[0] || intentQuery,
      assistantPreview: clampTraceMessage(
        [
          step3AssistantMessage,
          `Channels: ${summarizeValues(selectedChannels, 5)}.`,
        ]
          .filter(Boolean)
          .join(' | ')
      ),
      stageKey: 'curator',
      stageIndex: 3,
      stageTotal: 4,
      stageState: 'cleared',
      stageOutcome: clampTraceLines(
        [
          `Input from step 2 channels (${discoveryOutcome.channels.length}): ${summarizeValues(
            discoveryOutcome.channels.map(item => item.name),
            5
          )}.`,
          `Yielded selected channels (${selectedChannels.length}): ${summarizeValues(
            selectedChannels,
            5
          )}.`,
          `Yielded retrieval queries (${videoQueries.length}): ${summarizeValues(
            videoQueries,
            4
          )}.`,
          `Passed to step 4: ${quotedStatusValue(videoQueries[0] || intentQuery, 120)}.`,
        ],
        620
      ),
      elapsedMs: Date.now() - startedAt,
    });
  } else {
    step3AssistantMessage = discoveryOutcome.retrievalModeReason;
    videoQueries = uniqueTexts([
      ...strategistSeedQueries,
      ...buildTopicWideVideoQueries({
        intentQuery,
        discoveryQueries: discoveryOutcome.queriesUsed,
      }),
    ]).slice(0, 10);
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'ranking',
      message: `Step 3/4 cleared: topic-wide mode selected; searching broad ${platformLabel} results.`,
      searchQuery: videoQueries[0] || intentQuery,
      assistantPreview: clampTraceMessage(
        [
          step3AssistantMessage,
          `Topic-wide queries: ${summarizeValues(videoQueries, 4)}.`,
        ]
          .filter(Boolean)
          .join(' | ')
      ),
      stageKey: 'curator',
      stageIndex: 3,
      stageTotal: 4,
      stageState: 'cleared',
      stageOutcome: clampTraceLines(
        [
          `Input from step 2 mode: ${discoveryOutcome.retrievalMode}.`,
          `Mode reason: ${discoveryOutcome.retrievalModeReason || 'n/a'}.`,
          `Yielded topic-wide queries (${videoQueries.length}): ${summarizeValues(
            videoQueries,
            4
          )}.`,
          `Passed to step 4: ${quotedStatusValue(videoQueries[0] || intentQuery, 120)}.`,
        ],
        620
      ),
      elapsedMs: Date.now() - startedAt,
    });
  }
  if (videoQueries.length === 0) {
    const fallbackQuery =
      sanitizeRetrievalSearchQuery(intentQuery) ||
      sanitizeSearchKeywords(intentQuery);
    if (fallbackQuery) {
      videoQueries = [fallbackQuery];
    }
  }

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Step 4/4: yt-dlp ${platformLabel} video retrieval.`,
    searchQuery: videoQueries[0] || intentQuery,
    assistantPreview: clampTraceMessage(
      step3AssistantMessage ||
        `Selected channels: ${summarizeValues(selectedChannels, 5)}.`
    ),
    stageKey: 'retrieval',
    stageIndex: 4,
    stageTotal: 4,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Input query from step 3: ${quotedStatusValue(
          videoQueries[0] || intentQuery,
          120
        )}.`,
        `Selected channels context: ${summarizeValues(selectedChannels, 5)}.`,
      ],
      420
    ),
    elapsedMs: Date.now() - startedAt,
  });

  const retrievalSeedUrls = buildRetrievalSeedUrls({
    selectedChannels,
    discoveryChannels: discoveryOutcome.channels,
  });

  const retrievalOutcome = await runYoutubeYtDlpSearch({
    baseQuery: videoQueries[0] || intentQuery,
    queries: videoQueries,
    countryHint,
    recency,
    translationPhase,
    model,
    excludeUrls,
    seedUrls: retrievalSeedUrls,
    operationId: `${operationId}-retrieval-web-search`,
    maxResults,
    continuationDepth: 0,
    onProgress,
    signal,
  });
  const continuationCacheSize = resolveContinuationCacheSize(maxResults);
  const rerankOutcome = await rerankVideosWithLlm({
    candidates: retrievalOutcome.results,
    intentQuery,
    countryHint,
    recency,
    translationPhase,
    model,
    operationId: `${operationId}-retrieval-rerank`,
    maxResults: continuationCacheSize,
    preferredChannels: selectedChannels,
    onResolvedModel,
    signal,
  });
  throwIfSuggestionAborted(signal);

  const { pageResults: finalResults, pendingResults } =
    splitContinuationPageResults({
      items: rerankOutcome.results,
      pageSize: maxResults,
    });

  const creators = uniqueTexts([
    ...selectedChannels,
    ...retrievalOutcome.creators,
    ...rerankOutcome.results.map(item => compactText(item.channel || '')),
    ...discoveryOutcome.channels.map(item => item.name),
  ]).slice(0, 6);
  const lowConfidenceReason =
    finalResults.length === 0
      ? retrievalOutcome.lowConfidenceReason || 'no-scored-results'
      : undefined;
  const queriesTried = uniqueTexts([
    ...discoveryOutcome.queriesUsed,
    ...videoQueries,
    ...retrievalOutcome.queriesTried,
  ]).slice(0, 12);
  const effectiveQuery =
    retrievalOutcome.searchQuery || videoQueries[0] || intentQuery;
  const continuation = createVideoSearchContinuation({
    countryHint,
    recency,
    translationPhase,
    model,
    maxResults,
    intentQuery,
    retrievalQueries:
      videoQueries.length > 0 ? videoQueries : [effectiveQuery || intentQuery],
    retrievalSeedUrls,
    selectedChannels,
    iteration: 0,
    pendingResults,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'finalizing',
    message: `Pipeline complete: ${finalResults.length} videos kept. Top videos: ${summarizeTopTitles(finalResults, 3)}.`,
    searchQuery: effectiveQuery,
    assistantPreview: clampTraceMessage(
      [step3AssistantMessage, rerankOutcome.assistantMessage]
        .filter(Boolean)
        .join(' | ')
    ),
    stageKey: 'retrieval',
    stageIndex: 4,
    stageTotal: 4,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Input query: ${quotedStatusValue(effectiveQuery, 120)}.`,
        `Seed URLs passed: ${retrievalSeedUrls.length}.`,
        `yt-dlp ${platformLabel} candidates: ${retrievalOutcome.candidateCount ?? retrievalOutcome.results.length}.`,
        typeof retrievalOutcome.droppedUnavailable === 'number'
          ? `Ranking candidates prepared: ${retrievalOutcome.results.length} (dropped ${retrievalOutcome.droppedUnavailable} unreachable during verification).`
          : `Ranking candidates prepared: ${retrievalOutcome.results.length}.`,
        `Ranking mode: ${rerankOutcome.rankingMode}.`,
        `Ranked videos kept: ${finalResults.length}.`,
        `Cached continuation results ready: ${pendingResults.length}.`,
        lowConfidenceReason
          ? `Low-confidence detail: ${describeLowConfidenceReason(
              lowConfidenceReason
            )}`
          : '',
        `Top kept titles: ${summarizeTopTitles(finalResults, 3)}.`,
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
    resultCount: finalResults.length,
  });

  return {
    results: lowConfidenceReason ? [] : finalResults,
    searchQuery: effectiveQuery,
    creators,
    queriesTried,
    confidence: retrievalOutcome.confidence,
    lowConfidenceReason,
    continuation,
  };
}

export async function continueVideoSearch({
  continuation,
  excludeUrls,
  operationId,
  onProgress,
  onResolvedModel,
  signal,
}: {
  continuation: VideoSearchContinuation;
  excludeUrls: Set<string>;
  operationId: string;
  onProgress?: SuggestionProgressCallback;
  onResolvedModel?: (model: string) => void;
  signal?: AbortSignal;
}): Promise<VideoSearchRunOutcome> {
  const startedAt = Date.now();
  const platformLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  throwIfSuggestionAborted(signal);
  const retrievalQueries =
    continuation.retrievalQueries.length > 0
      ? continuation.retrievalQueries
      : [continuation.intentQuery];
  const effectiveSeedUrls = uniqueTexts(continuation.retrievalSeedUrls).slice(
    0,
    24
  );
  const nextIteration = continuation.iteration + 1;
  const initialQuery = retrievalQueries[0] || continuation.intentQuery;
  const cachedPage = splitContinuationPageResults({
    items: continuation.pendingResults || [],
    pageSize: continuation.maxResults,
  });
  const cachedResultCount =
    cachedPage.pageResults.length + cachedPage.pendingResults.length;

  if (cachedPage.pageResults.length > 0) {
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
      continuationMode: 'cache',
      cachedResultCount,
    });

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'finalizing',
      message: `Step 4/4 cleared: loaded ${cachedPage.pageResults.length} cached ${platformLabel} matches.`,
      searchQuery: initialQuery,
      assistantPreview: clampTraceMessage(
        cachedPage.pendingResults.length > 0
          ? `Cached ranked results remaining after this page: ${cachedPage.pendingResults.length}.`
          : 'Cached ranked results exhausted; the next page will replenish.',
        320
      ),
      stageKey: 'retrieval',
      stageIndex: 4,
      stageTotal: 4,
      stageState: 'cleared',
      stageOutcome: clampTraceLines(
        [
          `Cached ranked results served now: ${cachedPage.pageResults.length}.`,
          `Cached ranked results remaining: ${cachedPage.pendingResults.length}.`,
          `Skipped yt-dlp retrieval and reranking for this page.`,
        ],
        620
      ),
      elapsedMs: Date.now() - startedAt,
      resultCount: cachedPage.pageResults.length,
    });

    return {
      results: cachedPage.pageResults,
      searchQuery: initialQuery,
      creators: uniqueTexts([
        ...continuation.selectedChannels,
        ...cachedPage.pageResults.map(item => compactText(item.channel || '')),
      ]).slice(0, 6),
      queriesTried: uniqueTexts(retrievalQueries),
      confidence: 100,
      lowConfidenceReason: undefined,
      continuation: createVideoSearchContinuation({
        ...continuation,
        pendingResults: cachedPage.pendingResults,
      }),
    };
  }

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

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'searching',
    message: `Step 4/4: continuing yt-dlp ${platformLabel} retrieval.`,
    searchQuery: initialQuery,
    assistantPreview: clampTraceMessage(
      continuation.selectedChannels.length > 0
        ? `Continuing selected channels: ${summarizeValues(
            continuation.selectedChannels,
            5
          )}.`
        : `Continuing broad ${platformLabel} retrieval.`,
      320
    ),
    stageKey: 'retrieval',
    stageIndex: 4,
    stageTotal: 4,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Continuation iteration: ${nextIteration}.`,
        `Reusing retrieval queries (${retrievalQueries.length}): ${summarizeValues(
          retrievalQueries,
          4
        )}.`,
        `Reusing seed URLs: ${effectiveSeedUrls.length}.`,
        `Already excluded URLs: ${excludeUrls.size}.`,
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
  });

  const retrievalOutcome = await runYoutubeYtDlpSearch({
    baseQuery: initialQuery,
    queries: retrievalQueries,
    countryHint: continuation.countryHint,
    recency: continuation.recency,
    translationPhase: continuation.translationPhase,
    model: continuation.model,
    excludeUrls,
    seedUrls: effectiveSeedUrls,
    operationId: `${operationId}-retrieval-more`,
    maxResults: continuation.maxResults,
    continuationDepth: nextIteration,
    onProgress,
    signal,
  });
  const continuationCacheSize = resolveContinuationCacheSize(
    continuation.maxResults
  );
  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'ranking',
    message: `Step 4/4: ranking additional ${platformLabel} matches.`,
    searchQuery: retrievalOutcome.searchQuery || initialQuery,
    assistantPreview: clampTraceMessage(
      continuation.selectedChannels.length > 0
        ? `Comparing new candidates against preferred channels: ${summarizeValues(
            continuation.selectedChannels,
            5
          )}.`
        : 'Comparing new candidates against the existing request.',
      320
    ),
    stageKey: 'retrieval',
    stageIndex: 4,
    stageTotal: 4,
    stageState: 'running',
    stageOutcome: clampTraceLines(
      [
        `Continuation iteration: ${nextIteration}.`,
        `Candidates prepared for reranking: ${retrievalOutcome.results.length}.`,
        `Candidate pool after de-duplication: ${retrievalOutcome.candidateCount ?? retrievalOutcome.results.length}.`,
        `Selected channels context: ${summarizeValues(
          continuation.selectedChannels,
          5
        )}.`,
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
    resultCount: retrievalOutcome.results.length,
  });

  const stopRerankPulse = startProgressPulse({
    onProgress,
    operationId,
    phase: 'ranking',
    startedAt,
    intervalMs: 2400,
    messages: [
      `Step 4/4: comparing additional ${platformLabel} matches.`,
      'Step 4/4: scoring fresh candidates against your request.',
      'Step 4/4: keeping only the strongest additions.',
    ],
    extra: () => ({
      searchQuery: retrievalOutcome.searchQuery || initialQuery,
      stageKey: 'retrieval',
      stageIndex: 4,
      stageTotal: 4,
      stageState: 'running',
    }),
  });

  const rerankOutcome = await rerankVideosWithLlm({
    candidates: retrievalOutcome.results,
    intentQuery: continuation.intentQuery,
    countryHint: continuation.countryHint,
    recency: continuation.recency,
    translationPhase: continuation.translationPhase,
    model: continuation.model,
    operationId: `${operationId}-retrieval-rerank`,
    maxResults: continuationCacheSize,
    preferredChannels: continuation.selectedChannels,
    onResolvedModel,
    signal,
  }).finally(() => {
    stopRerankPulse();
  });
  throwIfSuggestionAborted(signal);

  const { pageResults: finalResults, pendingResults } =
    splitContinuationPageResults({
      items: rerankOutcome.results,
      pageSize: continuation.maxResults,
    });

  const creators = uniqueTexts([
    ...continuation.selectedChannels,
    ...retrievalOutcome.creators,
    ...rerankOutcome.results.map(item => compactText(item.channel || '')),
  ]).slice(0, 6);
  const lowConfidenceReason =
    finalResults.length === 0
      ? retrievalOutcome.lowConfidenceReason || 'no-scored-results'
      : undefined;
  const effectiveQuery =
    retrievalOutcome.searchQuery ||
    retrievalQueries[0] ||
    continuation.intentQuery;
  const nextContinuation = createVideoSearchContinuation({
    ...continuation,
    retrievalQueries:
      retrievalQueries.length > 0
        ? retrievalQueries
        : [effectiveQuery || continuation.intentQuery],
    retrievalSeedUrls: effectiveSeedUrls,
    iteration: nextIteration,
    pendingResults,
  });

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'finalizing',
    message: `Continuation complete: ${finalResults.length} videos kept. Top videos: ${summarizeTopTitles(finalResults, 3)}.`,
    searchQuery: effectiveQuery,
    assistantPreview: clampTraceMessage(rerankOutcome.assistantMessage),
    stageKey: 'retrieval',
    stageIndex: 4,
    stageTotal: 4,
    stageState: 'cleared',
    stageOutcome: clampTraceLines(
      [
        `Continuation iteration: ${nextIteration}.`,
        `Reused queries (${retrievalQueries.length}): ${summarizeValues(
          retrievalQueries,
          4
        )}.`,
        `Seed URLs passed: ${effectiveSeedUrls.length}.`,
        `yt-dlp ${platformLabel} candidates: ${retrievalOutcome.candidateCount ?? retrievalOutcome.results.length}.`,
        `Ranking mode: ${rerankOutcome.rankingMode}.`,
        `Ranking candidates prepared: ${retrievalOutcome.results.length}.`,
        `Ranked videos kept: ${finalResults.length}.`,
        `Cached continuation results ready: ${pendingResults.length}.`,
        lowConfidenceReason
          ? `Low-confidence detail: ${describeLowConfidenceReason(
              lowConfidenceReason
            )}`
          : '',
      ],
      620
    ),
    elapsedMs: Date.now() - startedAt,
    resultCount: finalResults.length,
  });

  return {
    results: lowConfidenceReason ? [] : finalResults,
    searchQuery: effectiveQuery,
    creators,
    queriesTried: uniqueTexts([
      ...retrievalQueries,
      ...retrievalOutcome.queriesTried,
    ]),
    confidence: retrievalOutcome.confidence,
    lowConfidenceReason,
    continuation: nextContinuation,
  };
}
