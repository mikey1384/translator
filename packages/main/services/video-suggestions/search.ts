import type { VideoSuggestionRecency } from '@shared-types/app';
import { rerankVideosWithLlm } from './rerank.js';
import type { SuggestionProgressCallback } from './progress.js';
import {
  buildDefaultCreatorDiscoveryQueries,
  curateVideoQueries,
  runDiscoveryWebSearch,
} from './discovery.js';
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
import { emitSuggestionProgress } from './progress.js';

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
  };
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
  const rerankOutcome = await rerankVideosWithLlm({
    candidates: retrievalOutcome.results,
    intentQuery,
    countryHint,
    recency,
    translationPhase,
    model,
    operationId: `${operationId}-retrieval-rerank`,
    maxResults,
    preferredChannels: selectedChannels,
    onResolvedModel,
    signal,
  });
  throwIfSuggestionAborted(signal);

  const creators = uniqueTexts([
    ...selectedChannels,
    ...retrievalOutcome.creators,
    ...rerankOutcome.results.map(item => compactText(item.channel || '')),
    ...discoveryOutcome.channels.map(item => item.name),
  ]).slice(0, 6);
  const finalResults = rerankOutcome.results.slice(0, maxResults);
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
  const rerankOutcome = await rerankVideosWithLlm({
    candidates: retrievalOutcome.results,
    intentQuery: continuation.intentQuery,
    countryHint: continuation.countryHint,
    recency: continuation.recency,
    translationPhase: continuation.translationPhase,
    model: continuation.model,
    operationId: `${operationId}-retrieval-rerank`,
    maxResults: continuation.maxResults,
    preferredChannels: continuation.selectedChannels,
    onResolvedModel,
    signal,
  });
  throwIfSuggestionAborted(signal);

  const creators = uniqueTexts([
    ...continuation.selectedChannels,
    ...retrievalOutcome.creators,
    ...rerankOutcome.results.map(item => compactText(item.channel || '')),
  ]).slice(0, 6);
  const finalResults = rerankOutcome.results.slice(0, continuation.maxResults);
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
