import { randomUUID } from 'node:crypto';
import log from 'electron-log';
import { normalizeAiModelId } from '../../shared/constants/index.js';
import type {
  VideoSuggestionChatRequest,
  VideoSuggestionChatResult,
  VideoSuggestionProgress,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import { callAIModel } from './subtitle-processing/ai-client.js';
import {
  resolveVideoSuggestionModel,
  resolveVideoSuggestionTranslationPhase,
  type VideoSuggestionModelPreference,
} from './ai-provider.js';
import { normalizeVideoSuggestionModelPreference } from './video-suggestion-model-preference.js';
import { isVideoSuggestionRecency } from '../../shared/helpers/video-suggestion-sanitize.js';
import {
  buildPlannerPrompt,
  findFallbackTopicFromHistory,
  isBroadAcceptanceReply,
  parsePlannerPayload,
  toPlannerMessages,
} from './video-suggestions/planner.js';
import {
  emitSuggestionProgress,
  startProgressPulse,
} from './video-suggestions/progress.js';
import {
  continueVideoSearch,
  createVideoSearchContinuation,
  runCreatorFirstSearch,
  type VideoSearchContinuation,
} from './video-suggestions/search.js';
import {
  type PlannerPayload,
  VIDEO_SUGGESTION_SOURCE_LABEL,
  clampMessage,
  clampTraceLines,
  clampTraceMessage,
  compactText,
  describeLowConfidenceReason,
  isSuggestionAbortError,
  normalizeExcludeUrls,
  normalizePreferenceSlots,
  quotedStatusValue,
  recencyLabel,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  summarizeValues,
  summarizeSearchError,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './video-suggestions/shared.js';

const STARTER_QUESTION = '__i18n__:input.videoSuggestion.starterQuestion';
const PLANNING_PROGRESS_MESSAGES = [
  'Understanding your request...',
  'Refining search intent...',
  'Preparing a focused query...',
];
const VIDEO_SUGGESTION_BATCH_SIZE = 20;
const VIDEO_SEARCH_CONTINUATION_TTL_MS = 30 * 60 * 1000;
const VIDEO_SEARCH_CONTINUATION_LIMIT = 128;

const videoSearchContinuationCache = new Map<
  string,
  { value: VideoSearchContinuation; updatedAt: number }
>();

function sweepExpiredVideoSearchContinuations(now = Date.now()): void {
  for (const [id, entry] of videoSearchContinuationCache.entries()) {
    if (now - entry.updatedAt > VIDEO_SEARCH_CONTINUATION_TTL_MS) {
      videoSearchContinuationCache.delete(id);
    }
  }
}

function persistVideoSearchContinuation(
  value: VideoSearchContinuation,
  continuationId?: string
): string {
  const now = Date.now();
  sweepExpiredVideoSearchContinuations(now);
  const id = compactText(continuationId) || randomUUID();
  videoSearchContinuationCache.set(id, {
    value,
    updatedAt: now,
  });

  if (videoSearchContinuationCache.size > VIDEO_SEARCH_CONTINUATION_LIMIT) {
    const oldest = [...videoSearchContinuationCache.entries()].sort(
      (a, b) => a[1].updatedAt - b[1].updatedAt
    )[0];
    if (oldest) {
      videoSearchContinuationCache.delete(oldest[0]);
    }
  }

  return id;
}

function getVideoSearchContinuation(
  continuationId: string | undefined
): VideoSearchContinuation | null {
  const id = compactText(continuationId);
  if (!id) return null;

  const now = Date.now();
  sweepExpiredVideoSearchContinuations(now);
  const entry = videoSearchContinuationCache.get(id);
  if (!entry) return null;

  entry.updatedAt = now;
  return entry.value;
}

function lowConfidenceErrorKey(reason: string | undefined): string {
  const normalized = compactText(reason).toLowerCase();
  if (normalized === 'no-scored-results') {
    return '__i18n__:input.videoSuggestion.lowConfidenceNoScoredResults';
  }
  return '__i18n__:input.videoSuggestion.lowConfidenceGeneric';
}

type SuggestVideoRuntimeOptions = {
  onProgress?: (progress: VideoSuggestionProgress) => void;
  signal?: AbortSignal;
};

function normalizeRecency(
  input: VideoSuggestionChatRequest['preferredRecency']
): VideoSuggestionRecency {
  return isVideoSuggestionRecency(input) ? input : 'any';
}

export async function suggestVideosViaChat(
  request: VideoSuggestionChatRequest,
  runtimeOptions: SuggestVideoRuntimeOptions = {}
): Promise<VideoSuggestionChatResult> {
  const operationId = request.operationId || `video-suggest-${Date.now()}`;
  const startedAt = Date.now();
  const onProgress = runtimeOptions.onProgress;
  const signal = runtimeOptions.signal;
  throwIfSuggestionAborted(signal);
  const history = toPlannerMessages(request.history);
  const hasUserMessage = history.some(msg => msg.role === 'user');
  const lastUserMessage = [...history]
    .reverse()
    .find(msg => msg.role === 'user')?.content;
  const broadAcceptance = isBroadAcceptanceReply(lastUserMessage || '');
  const fallbackTopic = broadAcceptance
    ? findFallbackTopicFromHistory(history.slice(0, -1))
    : '';
  const preference: VideoSuggestionModelPreference =
    normalizeVideoSuggestionModelPreference(request.modelPreference);
  const suggestionTranslationPhase =
    resolveVideoSuggestionTranslationPhase(preference);
  const resolvedModel = normalizeAiModelId(
    resolveVideoSuggestionModel(preference)
  );
  let observedResolvedModel = resolvedModel;
  const observeResolvedModel = (model: string) => {
    const normalized = normalizeAiModelId(model);
    if (normalized) {
      observedResolvedModel = normalized;
    }
  };
  const preferredCountry = sanitizeCountryHint(request.preferredCountry);
  const sourceLabel = VIDEO_SUGGESTION_SOURCE_LABEL;
  const preferredRecency = normalizeRecency(request.preferredRecency);
  const savedPreferences = normalizePreferenceSlots(request.savedPreferences);
  const queryOverride = sanitizeSearchKeywords(
    compactText(request.searchQueryOverride || '')
  );
  const broadAcceptanceQuery =
    !queryOverride && broadAcceptance && fallbackTopic
      ? sanitizeSearchKeywords(fallbackTopic)
      : '';
  const forcedSearchQueryRaw = queryOverride || broadAcceptanceQuery;
  const excludeUrls = normalizeExcludeUrls(request.excludeUrls);
  let activeContinuationId = compactText(request.continuationId) || undefined;
  const runIncrementalSearch = async ({
    continuation,
    continuationId,
    assistantMessage,
  }: {
    continuation: VideoSearchContinuation;
    continuationId?: string;
    assistantMessage: string;
  }): Promise<VideoSuggestionChatResult> => {
    try {
      const outcome = await continueVideoSearch({
        continuation,
        excludeUrls,
        operationId,
        onProgress,
        onResolvedModel: observeResolvedModel,
        signal,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        outcome.continuation,
        continuationId
      );
      let needsMoreContext = false;
      let nextAssistantMessage = assistantMessage;

      if (outcome.lowConfidenceReason) {
        nextAssistantMessage = '__i18n__:input.videoSuggestion.noMatches';
        needsMoreContext = true;
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'finalizing',
          message: `${describeLowConfidenceReason(
            outcome.lowConfidenceReason
          )} Try a broader topic, creator hint, or different recency.`,
          searchQuery: outcome.searchQuery,
          resultCount: 0,
          elapsedMs: Date.now() - startedAt,
        });
      } else if (outcome.results.length === 0) {
        nextAssistantMessage = '__i18n__:input.videoSuggestion.noMatches';
        needsMoreContext = true;
      }

      emitSuggestionProgress(onProgress, {
        operationId,
        phase: outcome.results.length === 0 ? 'finalizing' : 'ranking',
        message:
          outcome.results.length === 0
            ? 'No additional matches found.'
            : `Found ${outcome.results.length} additional result${outcome.results.length === 1 ? '' : 's'}.`,
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'done',
        message: 'Suggestions ready.',
        searchQuery: outcome.searchQuery,
        resultCount: outcome.results.length,
        elapsedMs: Date.now() - startedAt,
      });

      return {
        success: true,
        assistantMessage: clampMessage(nextAssistantMessage),
        needsMoreContext,
        searchQuery: outcome.searchQuery,
        results: outcome.results,
        continuationId: nextContinuationId,
        resolvedModel: observedResolvedModel,
      };
    } catch (error: any) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      const detail = summarizeSearchError(error);
      log.error(
        `[video-suggestions] Incremental retrieval failed (${operationId}):`,
        detail
      );
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'error',
        message: detail,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: false,
        assistantMessage: '__i18n__:input.videoSuggestion.searchFailed',
        needsMoreContext: true,
        searchQuery:
          continuation.retrievalQueries[0] || continuation.intentQuery,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  };
  const storedContinuation = getVideoSearchContinuation(activeContinuationId);

  if (storedContinuation) {
    return runIncrementalSearch({
      continuation: storedContinuation,
      continuationId: activeContinuationId,
      assistantMessage: '__i18n__:input.videoSuggestion.defaultFollowUp',
    });
  }

  if (queryOverride) {
    const directContinuation = createVideoSearchContinuation({
      countryHint: preferredCountry,
      recency: preferredRecency,
      translationPhase: suggestionTranslationPhase,
      model: resolvedModel,
      maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
      intentQuery: queryOverride,
      retrievalQueries: [queryOverride],
      retrievalSeedUrls: [],
      selectedChannels: [],
      iteration: 0,
    });
    return runIncrementalSearch({
      continuation: directContinuation,
      assistantMessage: '__i18n__:input.videoSuggestion.defaultFollowUp',
    });
  }

  if (forcedSearchQueryRaw) {
    let results: VideoSuggestionResultItem[] = [];
    let searchQuery = '';
    let assistantMessage = queryOverride
      ? '__i18n__:input.videoSuggestion.defaultFollowUp'
      : 'Searching now.';
    let needsMoreContext = false;

    try {
      let forcedPlan: PlannerPayload | null = null;
      try {
        const forcedPlannerText = await callAIModel({
          operationId: `${operationId}-strategist-forced`,
          model: resolvedModel,
          translationPhase: suggestionTranslationPhase,
          onResolvedModel: observeResolvedModel,
          reasoning: { effort: 'low' },
          signal,
          retryAttempts: 1,
          messages: [
            {
              role: 'system',
              content: buildPlannerPrompt(
                request.preferredLanguage,
                request.preferredLanguageName,
                preferredCountry,
                preferredRecency,
                savedPreferences
              ),
            },
            {
              role: 'user',
              content: `Intent: ${forcedSearchQueryRaw}`,
            },
          ],
        });
        forcedPlan = parsePlannerPayload(forcedPlannerText);
        if (forcedPlan) {
          emitSuggestionProgress(onProgress, {
            operationId,
            phase: 'planning',
            message: `Step 1/4 cleared: strategist ready.`,
            searchQuery:
              forcedPlan.searchQuery ||
              forcedPlan.discoveryQueries?.[0] ||
              forcedSearchQueryRaw,
            assistantPreview: clampTraceMessage(
              [
                forcedPlan.intentSummary
                  ? `Intent: ${forcedPlan.intentSummary}`
                  : '',
                forcedPlan.strategy ? `Plan: ${forcedPlan.strategy}` : '',
                forcedPlan.discoveryQueries?.length
                  ? `Discovery queries: ${forcedPlan.discoveryQueries.length}`
                  : '',
                forcedPlan.retrievalMode
                  ? `Retrieval mode: ${forcedPlan.retrievalMode}`
                  : '',
                forcedPlan.retrievalQueries?.length
                  ? `Retrieval queries: ${forcedPlan.retrievalQueries.length}`
                  : '',
              ]
                .filter(Boolean)
                .join(' | ')
            ),
            stageKey: 'strategist',
            stageIndex: 1,
            stageTotal: 4,
            stageState: 'cleared',
            stageOutcome: clampTraceLines(
              [
                `Input request: ${quotedStatusValue(forcedSearchQueryRaw, 120)}.`,
                `Source lock: ${sourceLabel}.`,
                forcedPlan.intentSummary
                  ? `Yielded intent summary: ${forcedPlan.intentSummary}`
                  : '',
                forcedPlan.strategy
                  ? `Yielded strategy: ${forcedPlan.strategy}`
                  : '',
                forcedPlan.discoveryQueries?.length
                  ? `Yielded discovery queries (${forcedPlan.discoveryQueries.length}): ${summarizeValues(
                      forcedPlan.discoveryQueries,
                      4
                    )}.`
                  : '',
                forcedPlan.retrievalMode
                  ? `Yielded retrieval mode: ${forcedPlan.retrievalMode}.`
                  : '',
                forcedPlan.retrievalQueries?.length
                  ? `Yielded retrieval queries (${forcedPlan.retrievalQueries.length}): ${summarizeValues(
                      forcedPlan.retrievalQueries,
                      3
                    )}.`
                  : '',
                `Passed to step 2: ${quotedStatusValue(
                  forcedPlan.discoveryQueries?.[0] || forcedSearchQueryRaw,
                  120
                )}.`,
              ],
              620
            ),
            elapsedMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        if (isSuggestionAbortError(error, signal)) {
          throw error;
        }
        forcedPlan = null;
      }

      const outcome = await runCreatorFirstSearch({
        baseQuery: forcedSearchQueryRaw,
        countryHint: preferredCountry,
        languageTag: request.preferredLanguage,
        recency: preferredRecency,
        translationPhase: suggestionTranslationPhase,
        model: resolvedModel,
        operationId,
        maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
        excludeUrls,
        onProgress,
        discoveryQueries: forcedPlan?.discoveryQueries,
        searchLanguages: forcedPlan?.searchLanguages,
        retrievalMode: forcedPlan?.retrievalMode,
        retrievalQueries: forcedPlan?.retrievalQueries,
        intentSummary: forcedPlan?.intentSummary,
        strategy: forcedPlan?.strategy,
        onResolvedModel: observeResolvedModel,
        signal,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        outcome.continuation,
        activeContinuationId
      );
      activeContinuationId = nextContinuationId;
      results = outcome.results;
      searchQuery = outcome.searchQuery;
      if (forcedPlan?.assistantMessage) {
        assistantMessage = forcedPlan.assistantMessage;
      }
      if (outcome.lowConfidenceReason) {
        assistantMessage = '__i18n__:input.videoSuggestion.noMatches';
        needsMoreContext = true;
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'finalizing',
          message: `${describeLowConfidenceReason(
            outcome.lowConfidenceReason
          )} Try a broader topic, creator hint, or different recency.`,
          searchQuery,
          resultCount: 0,
          elapsedMs: Date.now() - startedAt,
        });
      } else if (results.length === 0) {
        assistantMessage = '__i18n__:input.videoSuggestion.noMatches';
        needsMoreContext = true;
      }
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: results.length === 0 ? 'finalizing' : 'ranking',
        message:
          results.length === 0
            ? 'No additional matches found.'
            : `Found ${results.length} additional result${results.length === 1 ? '' : 's'}.`,
        searchQuery,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt,
      });
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'done',
        message: 'Suggestions ready.',
        searchQuery,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: true,
        assistantMessage: clampMessage(assistantMessage),
        needsMoreContext,
        searchQuery,
        results,
        capturedPreferences: forcedPlan?.capturedPreferences,
        continuationId: nextContinuationId,
        resolvedModel: observedResolvedModel,
      };
    } catch (error: any) {
      if (isSuggestionAbortError(error, signal)) {
        throw error;
      }
      const detail = summarizeSearchError(error);
      log.error(
        `[video-suggestions] Search-more failed (${operationId}):`,
        detail
      );
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'error',
        message: detail,
        elapsedMs: Date.now() - startedAt,
      });
      return {
        success: false,
        assistantMessage: '__i18n__:input.videoSuggestion.searchFailed',
        needsMoreContext: true,
        searchQuery: forcedSearchQueryRaw,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  }

  const plannerPrompt = buildPlannerPrompt(
    request.preferredLanguage,
    request.preferredLanguageName,
    preferredCountry,
    preferredRecency,
    savedPreferences
  );
  const plannerHistory = hasUserMessage
    ? history
    : [
        {
          role: 'user' as const,
          content: preferredCountry
            ? 'Start the chat with one short question to learn my video preferences.'
            : 'Start the chat with one short question asking for both video preference and target country/region.',
        },
      ];

  emitSuggestionProgress(onProgress, {
    operationId,
    phase: 'planning',
    message: PLANNING_PROGRESS_MESSAGES[0],
    stageKey: 'strategist',
    stageIndex: 1,
    stageTotal: 4,
    stageState: 'running',
    elapsedMs: 0,
  });
  const stopPlanningPulse = startProgressPulse({
    onProgress,
    operationId,
    phase: 'planning',
    messages: PLANNING_PROGRESS_MESSAGES,
    startedAt,
    extra: () => ({
      stageKey: 'strategist',
      stageIndex: 1,
      stageTotal: 4,
      stageState: 'running',
    }),
  });

  try {
    const plannerText = await callAIModel({
      operationId,
      model: resolvedModel,
      translationPhase: suggestionTranslationPhase,
      onResolvedModel: observeResolvedModel,
      reasoning: { effort: 'low' },
      signal,
      messages: [{ role: 'system', content: plannerPrompt }, ...plannerHistory],
      retryAttempts: 2,
    });
    stopPlanningPulse();
    throwIfSuggestionAborted(signal);

    const parsed = parsePlannerPayload(plannerText);
    let assistantMessage =
      parsed?.assistantMessage || '__i18n__:input.videoSuggestion.askMore';
    let needsMoreContext = parsed?.needsMoreContext ?? true;
    const strategistDiscoveryQueries = uniqueTexts(
      (parsed?.discoveryQueries || []).map(query =>
        sanitizeSearchKeywords(query)
      )
    ).slice(0, 5);
    const strategistSearchLanguages = uniqueTexts(
      (parsed?.searchLanguages || []).map(code =>
        sanitizeLanguageToken(code).toLowerCase()
      )
    ).slice(0, 3);

    if (parsed) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'planning',
        message: `Step 1/4 cleared: strategist ready.`,
        searchQuery:
          parsed.searchQuery ||
          parsed.discoveryQueries?.[0] ||
          fallbackTopic ||
          '',
        assistantPreview: clampTraceMessage(
          [
            parsed.intentSummary ? `Intent: ${parsed.intentSummary}` : '',
            parsed.strategy ? `Plan: ${parsed.strategy}` : '',
            strategistSearchLanguages.length
              ? `Languages: ${strategistSearchLanguages.join(', ')}`
              : '',
            strategistDiscoveryQueries.length
              ? `Discovery queries: ${strategistDiscoveryQueries.length}`
              : '',
            parsed.retrievalMode
              ? `Retrieval mode: ${parsed.retrievalMode}`
              : '',
            parsed.retrievalQueries?.length
              ? `Retrieval queries: ${parsed.retrievalQueries.length}`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        ),
        stageKey: 'strategist',
        stageIndex: 1,
        stageTotal: 4,
        stageState: 'cleared',
        stageOutcome: clampTraceLines(
          [
            `Source lock: ${sourceLabel}.`,
            parsed.intentSummary
              ? `Yielded intent summary: ${parsed.intentSummary}`
              : '',
            parsed.strategy ? `Yielded strategy: ${parsed.strategy}` : '',
            strategistSearchLanguages.length
              ? `Yielded search languages: ${strategistSearchLanguages.join(', ')}.`
              : '',
            strategistDiscoveryQueries.length
              ? `Yielded discovery queries (${strategistDiscoveryQueries.length}): ${summarizeValues(
                  strategistDiscoveryQueries,
                  4
                )}.`
              : '',
            parsed.retrievalMode
              ? `Yielded retrieval mode: ${parsed.retrievalMode}.`
              : '',
            parsed.retrievalQueries?.length
              ? `Yielded retrieval queries (${parsed.retrievalQueries.length}): ${summarizeValues(
                  parsed.retrievalQueries,
                  3
                )}.`
              : '',
            `Passed to step 2: ${quotedStatusValue(
              parsed.searchQuery ||
                strategistDiscoveryQueries[0] ||
                fallbackTopic ||
                '',
              120
            )}.`,
          ],
          620
        ),
        elapsedMs: Date.now() - startedAt,
      });
    }
    let searchQuery = sanitizeSearchKeywords(
      parsed?.searchQuery || strategistDiscoveryQueries[0] || ''
    );
    const baseQueryForSearch = () =>
      sanitizeSearchKeywords(
        searchQuery ||
          parsed?.intentSummary ||
          fallbackTopic ||
          strategistDiscoveryQueries[0] ||
          ''
      );

    if (!searchQuery && broadAcceptance && fallbackTopic) {
      // Fallback for "any/whatever" replies: proceed using the known topic
      // instead of forcing another narrowing loop.
      searchQuery = sanitizeSearchKeywords(fallbackTopic);
      needsMoreContext = false;
    }

    if (searchQuery) {
      searchQuery = sanitizeSearchKeywords(searchQuery);
    }

    if (!searchQuery && strategistDiscoveryQueries.length === 0) {
      needsMoreContext = true;
    }
    if (!hasUserMessage) {
      needsMoreContext = true;
    }
    let results: VideoSuggestionResultItem[] = [];
    let searchFailureDetail = '';

    const effectiveBaseQuery = baseQueryForSearch();
    if (hasUserMessage && !needsMoreContext && effectiveBaseQuery) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'searching',
        message: `Searching ${sourceLabel} for ${quotedStatusValue(effectiveBaseQuery)} (${recencyLabel(preferredRecency)}).`,
        searchQuery: effectiveBaseQuery,
        assistantPreview: assistantMessage.startsWith('__i18n__:')
          ? undefined
          : assistantMessage,
        elapsedMs: Date.now() - startedAt,
      });
      try {
        const outcome = await runCreatorFirstSearch({
          baseQuery: effectiveBaseQuery,
          countryHint: preferredCountry,
          languageTag: request.preferredLanguage,
          recency: preferredRecency,
          translationPhase: suggestionTranslationPhase,
          model: resolvedModel,
          operationId,
          maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
          excludeUrls,
          onProgress,
          discoveryQueries: strategistDiscoveryQueries,
          searchLanguages: strategistSearchLanguages,
          retrievalMode: parsed?.retrievalMode,
          retrievalQueries: parsed?.retrievalQueries,
          intentSummary: parsed?.intentSummary,
          strategy: parsed?.strategy,
          onResolvedModel: observeResolvedModel,
          signal,
        });
        const nextContinuationId = persistVideoSearchContinuation(
          outcome.continuation,
          activeContinuationId
        );
        activeContinuationId = nextContinuationId;
        results = outcome.results;
        searchQuery = outcome.searchQuery;
        if (outcome.lowConfidenceReason) {
          assistantMessage = '__i18n__:input.videoSuggestion.noMatches';
          needsMoreContext = true;
          searchFailureDetail = lowConfidenceErrorKey(
            outcome.lowConfidenceReason
          );
          emitSuggestionProgress(onProgress, {
            operationId,
            phase: 'finalizing',
            message: `${describeLowConfidenceReason(
              outcome.lowConfidenceReason
            )} Try a broader topic, creator hint, or different recency.`,
            searchQuery,
            resultCount: 0,
            elapsedMs: Date.now() - startedAt,
          });
        }
      } catch (error: any) {
        if (isSuggestionAbortError(error, signal)) {
          throw error;
        }
        searchFailureDetail = summarizeSearchError(error);
        log.error(
          `[video-suggestions] Search failed (${operationId}):`,
          searchFailureDetail
        );
        assistantMessage = '__i18n__:input.videoSuggestion.searchFailed';
        needsMoreContext = true;
        emitSuggestionProgress(onProgress, {
          operationId,
          phase: 'error',
          message: searchFailureDetail,
          searchQuery,
          elapsedMs: Date.now() - startedAt,
        });
      }
    }

    if (
      hasUserMessage &&
      !needsMoreContext &&
      searchQuery &&
      results.length === 0
    ) {
      assistantMessage = '__i18n__:input.videoSuggestion.noMatches';
      needsMoreContext = true;
    }

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: needsMoreContext ? 'finalizing' : 'ranking',
      message: needsMoreContext
        ? 'Need one more detail to improve results.'
        : `Found ${results.length} result${results.length === 1 ? '' : 's'}.`,
      searchQuery,
      resultCount: results.length,
      assistantPreview: assistantMessage.startsWith('__i18n__:')
        ? undefined
        : assistantMessage,
      elapsedMs: Date.now() - startedAt,
    });

    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'done',
      message: 'Suggestions ready.',
      searchQuery,
      resultCount: results.length,
      elapsedMs: Date.now() - startedAt,
    });

    return {
      success: true,
      assistantMessage: clampMessage(assistantMessage),
      needsMoreContext,
      searchQuery,
      results,
      capturedPreferences: parsed?.capturedPreferences,
      continuationId: activeContinuationId,
      resolvedModel: observedResolvedModel,
      error: searchFailureDetail || undefined,
    };
  } catch (error: any) {
    stopPlanningPulse();
    if (isSuggestionAbortError(error, signal)) {
      throw error;
    }
    log.error(
      `[video-suggestions] Chat failed (${operationId}):`,
      error?.message || error
    );
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'error',
      message: 'Suggestion request failed.',
      elapsedMs: Date.now() - startedAt,
    });
    return {
      success: false,
      assistantMessage: hasUserMessage
        ? '__i18n__:input.videoSuggestion.genericError'
        : STARTER_QUESTION,
      needsMoreContext: true,
      searchQuery: '',
      results: [],
      resolvedModel: observedResolvedModel,
      error: error?.message || 'Failed to suggest videos',
    };
  }
}
