import { randomUUID } from 'node:crypto';
import log from 'electron-log';
import { normalizeAiModelId } from '../../shared/constants/index.js';
import type {
  VideoSuggestionChatRequest,
  VideoSuggestionChatResult,
  VideoSuggestionProgress,
  VideoSuggestionRecency,
} from '@shared-types/app';
import {
  resolveVideoSuggestionModel,
  resolveVideoSuggestionTranslationPhase,
  type VideoSuggestionModelPreference,
} from './ai-provider.js';
import { normalizeVideoSuggestionModelPreference } from './video-suggestion-model-preference.js';
import { isVideoSuggestionRecency } from '../../shared/helpers/video-suggestion-sanitize.js';
import { toPlannerMessages } from './video-suggestions/planner.js';
import { emitSuggestionProgress } from './video-suggestions/progress.js';
import { runVideoSearchAgent } from './video-suggestions/agent.js';
import {
  createVideoSearchContinuation,
  runVideoSearch,
  type VideoSearchContinuation,
} from './video-suggestions/search.js';
import {
  compactText,
  describeLowConfidenceReason,
  isSuggestionAbortError,
  normalizeExcludeUrls,
  normalizePreferenceSlots,
  normalizeYoutubeWatchUrl,
  quotedStatusValue,
  sanitizeCountryHint,
  sanitizeLanguageToken,
  sanitizeSearchKeywords,
  sanitizeYoutubeRegionCode,
  summarizeSearchError,
  summarizeValues,
  throwIfSuggestionAborted,
  uniqueTexts,
} from './video-suggestions/shared.js';

const STARTER_QUESTION = '__i18n__:input.videoSuggestion.starterQuestion';
const DEFAULT_FOLLOW_UP = '__i18n__:input.videoSuggestion.defaultFollowUp';
const SEARCH_FAILED = '__i18n__:input.videoSuggestion.searchFailed';
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

function buildAgentContextBlock({
  preferredRecency,
  includeDownloadHistory,
  includeWatchedChannels,
  recentDownloadTitles,
  recentChannelNames,
  savedTopic,
}: {
  preferredRecency: VideoSuggestionRecency;
  includeDownloadHistory: boolean;
  includeWatchedChannels: boolean;
  recentDownloadTitles: string[];
  recentChannelNames: string[];
  savedTopic?: string;
}): string {
  const lines: string[] = [];

  if (compactText(savedTopic)) {
    lines.push(
      `Saved topic preference from earlier sessions: ${quotedStatusValue(savedTopic || '', 80)}.`
    );
  }
  if (includeDownloadHistory && recentDownloadTitles.length > 0) {
    lines.push(
      `Videos the user recently downloaded: ${summarizeValues(recentDownloadTitles, 4)}.`
    );
  }
  if (includeWatchedChannels && recentChannelNames.length > 0) {
    lines.push(
      `Channels the user recently watched: ${summarizeValues(recentChannelNames, 4)}.`
    );
  }
  if (preferredRecency !== 'any') {
    lines.push('The recency window is a hard filter applied by the app.');
  }

  return lines.join('\n');
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

  const targetCountry = sanitizeCountryHint(request.targetCountry);
  const requestYoutubeRegionCode = sanitizeYoutubeRegionCode(
    request.youtubeRegionCode
  );
  const requestYoutubeSearchLanguage =
    sanitizeLanguageToken(request.youtubeSearchLanguage).toLowerCase() || 'en';
  const preferredRecency = normalizeRecency(request.preferredRecency);
  const savedPreferences = normalizePreferenceSlots(request.savedPreferences);
  const excludeUrls = normalizeExcludeUrls(request.excludeUrls);
  const queryOverride = sanitizeSearchKeywords(
    compactText(request.searchQueryOverride || '')
  );
  let activeContinuationId = compactText(request.continuationId) || undefined;

  const emitDone = (searchQuery: string, resultCount: number) => {
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'finalizing',
      message:
        resultCount === 0
          ? 'No additional matches found.'
          : `Found ${resultCount} result${resultCount === 1 ? '' : 's'}.`,
      searchQuery,
      resultCount,
      elapsedMs: Date.now() - startedAt,
    });
    emitSuggestionProgress(onProgress, {
      operationId,
      phase: 'done',
      message: 'Suggestions ready.',
      searchQuery,
      resultCount,
      elapsedMs: Date.now() - startedAt,
    });
  };

  const runContinuationSearch = async (
    continuation: VideoSearchContinuation
  ): Promise<VideoSuggestionChatResult> => {
    try {
      const outcome = await runVideoSearch({
        continuation,
        excludeUrls,
        operationId,
        onProgress,
        startedAt,
        signal,
      });
      const nextContinuationId = persistVideoSearchContinuation(
        outcome.continuation,
        activeContinuationId
      );

      emitDone(outcome.searchQuery, outcome.results.length);
      return {
        success: true,
        assistantMessage: DEFAULT_FOLLOW_UP,
        searchQuery: outcome.searchQuery,
        youtubeRegionCode: outcome.continuation.youtubeRegionCode,
        youtubeSearchLanguage: outcome.continuation.youtubeSearchLanguage,
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
        `[video-suggestions] Continuation search failed (${operationId}):`,
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
        assistantMessage: SEARCH_FAILED,
        searchQuery:
          continuation.retrievalQueries[0] || continuation.intentQuery,
        results: [],
        resolvedModel: observedResolvedModel,
        error: detail,
      };
    }
  };

  // "Search more": serve buffered results / re-run the stored plan.
  // No model calls on this path.
  const storedContinuation = getVideoSearchContinuation(activeContinuationId);
  if (storedContinuation) {
    return runContinuationSearch(storedContinuation);
  }

  // Explicit query override (e.g. re-running a saved search): direct
  // retrieval, no model calls.
  if (queryOverride) {
    return runContinuationSearch(
      createVideoSearchContinuation({
        recency: preferredRecency,
        translationPhase: suggestionTranslationPhase,
        model: resolvedModel,
        maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
        intentQuery: queryOverride,
        youtubeRegionCode: requestYoutubeRegionCode,
        youtubeSearchLanguage: requestYoutubeSearchLanguage,
        retrievalQueries: [queryOverride],
        retrievalSeedUrls: [],
        selectedChannels: [],
        iteration: 0,
      })
    );
  }

  // Empty conversation: greet with the canned starter question instead of
  // spending a model call.
  if (!hasUserMessage) {
    emitDone('', 0);
    return {
      success: true,
      assistantMessage: STARTER_QUESTION,
      searchQuery: '',
      results: [],
      resolvedModel: observedResolvedModel,
    };
  }

  try {
    const contextBlock = buildAgentContextBlock({
      preferredRecency,
      includeDownloadHistory: Boolean(
        request.contextToggles?.includeDownloadHistory
      ),
      includeWatchedChannels: Boolean(
        request.contextToggles?.includeWatchedChannels
      ),
      recentDownloadTitles: Array.isArray(request.recentDownloadTitles)
        ? request.recentDownloadTitles
            .map(value => compactText(value))
            .filter(Boolean)
            .slice(0, 8)
        : [],
      recentChannelNames: Array.isArray(request.recentChannelNames)
        ? request.recentChannelNames
            .map(value => compactText(value))
            .filter(Boolean)
            .slice(0, 8)
        : [],
      savedTopic: savedPreferences?.topic,
    });

    const outcome = await runVideoSearchAgent({
      operationId,
      model: resolvedModel,
      translationPhase: suggestionTranslationPhase,
      signal,
      history,
      targetCountry,
      youtubeRegionCode: requestYoutubeRegionCode,
      youtubeSearchLanguage: requestYoutubeSearchLanguage,
      preferredRecency,
      excludeUrls,
      preferredLanguage: request.preferredLanguage,
      preferredLanguageName: request.preferredLanguageName,
      savedPreferences,
      contextBlock,
      maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
      onProgress,
      startedAt,
      onResolvedModel: observeResolvedModel,
    });

    // Store leftover candidates so "search more" pages through them
    // without another agent run.
    if (outcome.queriesTried.length > 0) {
      const presentedUrls = new Set(
        outcome.results.map(
          item => normalizeYoutubeWatchUrl(item.url) || compactText(item.url)
        )
      );
      const pendingResults = outcome.candidatePool.filter(item => {
        const url = normalizeYoutubeWatchUrl(item.url) || compactText(item.url);
        return Boolean(url) && !presentedUrls.has(url);
      });
      const channels = uniqueTexts(
        outcome.results
          .map(item => compactText(item.channel || ''))
          .filter(Boolean)
      ).slice(0, 6);
      activeContinuationId = persistVideoSearchContinuation(
        createVideoSearchContinuation({
          recency: preferredRecency,
          translationPhase: suggestionTranslationPhase,
          model: resolvedModel,
          maxResults: VIDEO_SUGGESTION_BATCH_SIZE,
          intentQuery: outcome.searchQuery,
          youtubeRegionCode:
            outcome.youtubeRegionCode || requestYoutubeRegionCode,
          youtubeSearchLanguage:
            outcome.youtubeSearchLanguage || requestYoutubeSearchLanguage,
          retrievalQueries: outcome.queriesTried,
          retrievalSeedUrls: [],
          selectedChannels: channels,
          iteration: 1,
          pendingResults,
        }),
        activeContinuationId
      );
    }

    if (outcome.lowConfidenceReason) {
      emitSuggestionProgress(onProgress, {
        operationId,
        phase: 'finalizing',
        message: `${describeLowConfidenceReason(
          outcome.lowConfidenceReason
        )} Try a broader topic, add one more detail, or change recency.`,
        searchQuery: outcome.searchQuery,
        resultCount: 0,
        elapsedMs: Date.now() - startedAt,
      });
    }
    emitDone(outcome.searchQuery, outcome.results.length);

    return {
      success: true,
      assistantMessage: compactText(outcome.assistantMessage),
      searchQuery: outcome.searchQuery,
      youtubeRegionCode: outcome.youtubeRegionCode,
      youtubeSearchLanguage: outcome.youtubeSearchLanguage,
      results: outcome.results,
      capturedPreferences: outcome.capturedPreferences,
      continuationId: activeContinuationId,
      resolvedModel: observedResolvedModel,
      error: outcome.lowConfidenceReason
        ? lowConfidenceErrorKey(outcome.lowConfidenceReason)
        : undefined,
    };
  } catch (error: any) {
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
      assistantMessage: '__i18n__:input.videoSuggestion.genericError',
      searchQuery: '',
      results: [],
      resolvedModel: observedResolvedModel,
      error: error?.message || 'Failed to suggest videos',
    };
  }
}
