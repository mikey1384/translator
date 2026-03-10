import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { TFunction } from 'i18next';
import { shallow } from 'zustand/shallow';
import { suggestVideos } from '../../../../ipc/video-suggestions.js';
import * as OperationIPC from '../../../../ipc/operation.js';
import {
  ensureVideoSuggestionStoreRuntime,
  useVideoSuggestionStore,
} from '../../../../state/video-suggestion-store.js';
import type { PipelineStageProgress } from './VideoSuggestionPanel.types.js';
import type {
  VideoSuggestionContextToggles,
  VideoSuggestionMessage,
  VideoSuggestionModelPreference,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import {
  buildSuggestedFollowUpPrompts,
  normalizeMessagesForPlanner,
  resolveAssistantMessage,
  resolveErrorText,
} from './video-suggestion-helpers.js';

type UseVideoSuggestionFlowParams = {
  modelPreference: VideoSuggestionModelPreference;
  onCapturePreferences: (
    captured: VideoSuggestionPreferenceSlots | undefined
  ) => void;
  onResultsReady: () => void;
  open: boolean;
  preferredCountry: string;
  preferredLanguage: string;
  preferredLanguageName: string;
  preferredRecency: VideoSuggestionRecency;
  prefsLoaded: boolean;
  recentChannelNames: string[];
  recentDownloadTitles: string[];
  requestPreferences: VideoSuggestionPreferenceSlots;
  savedPreferences: VideoSuggestionPreferenceSlots;
  contextToggles: VideoSuggestionContextToggles;
  t: TFunction;
};

type UseVideoSuggestionFlowResult = {
  activeTraceLines: string[];
  cancelSearch: () => Promise<void>;
  cancelling: boolean;
  clearedStageCount: number;
  continuationId: string | null;
  error: string | null;
  input: string;
  loading: boolean;
  loadingElapsedSec: number;
  loadingMessage: string;
  loadingMode: 'chat' | 'more' | null;
  messages: VideoSuggestionMessage[];
  pipelineStages: PipelineStageProgress[];
  resolvedModelRuntime: string | null;
  results: VideoSuggestionResultItem[];
  runningStage: PipelineStageProgress | null;
  suggestedFollowUpPrompts: string[];
  showQuickStartAction: boolean;
  searchMore: () => Promise<void>;
  searchQuery: string;
  resetChat: () => void;
  sendMessage: () => Promise<void>;
  setError: (next: string | null) => void;
  setInput: (next: string) => void;
  showLiveActivity: boolean;
  streamingPreview: string;
  runQuickStartSearch: () => Promise<void>;
};

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeContinuationId(value: unknown): string | null {
  const normalized = compactText(value);
  return normalized || null;
}

function buildSavedPreferenceSummary(
  savedPreferences: VideoSuggestionPreferenceSlots
): string {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of [savedPreferences.topic]) {
    const text = compactText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(text);
  }
  return values.slice(0, 3).join(', ');
}

function buildImplicitSearchPrompt(
  preferenceSummary: string,
  t: TFunction
): string {
  if (preferenceSummary) {
    return t(
      'input.videoSuggestion.defaultSearchUserMessageWithSummary',
      'Find videos for me now using {{summary}} as guidance.',
      { summary: preferenceSummary }
    );
  }
  return t(
    'input.videoSuggestion.defaultSearchUserMessage',
    'Find videos for me now.'
  );
}

export default function useVideoSuggestionFlow({
  modelPreference,
  onCapturePreferences,
  onResultsReady,
  open,
  preferredCountry,
  preferredLanguage,
  preferredLanguageName,
  preferredRecency,
  prefsLoaded,
  recentChannelNames,
  recentDownloadTitles,
  requestPreferences,
  savedPreferences,
  contextToggles,
  t,
}: UseVideoSuggestionFlowParams): UseVideoSuggestionFlowResult {
  const mountedRef = useRef(true);
  const {
    activeTraceLines,
    cancelling,
    continuationId,
    error,
    input,
    loading,
    loadingElapsedSec,
    loadingMode,
    messages,
    pipelineStages,
    resolvedModelRuntime,
    results,
    runningStage,
    searchQuery,
    showQuickStartAction,
    streamingPreview,
    streamingStatus,
    setCancellingOperation,
    setContinuationId,
    setError,
    setInput,
    setLastRequestPreferences,
    setMessages,
    setResolvedModelRuntime,
    setResults,
    setSearchQuery,
    setShowQuickStartAction,
    startOperation,
    finishOperation,
  } = useVideoSuggestionStore(
    state => ({
      activeTraceLines: state.loadingTrace.slice(-10),
      cancelling: state.cancelling,
      continuationId: state.continuationId,
      error: state.error,
      input: state.input,
      loading: state.loading,
      loadingElapsedSec: state.loadingElapsedSec,
      loadingMode: state.loadingMode,
      messages: state.messages,
      pipelineStages: state.pipelineStages,
      resolvedModelRuntime: state.resolvedModelRuntime,
      results: state.results,
      runningStage:
        state.pipelineStages.find(stage => stage.state === 'running') || null,
      searchQuery: state.searchQuery,
      showQuickStartAction: state.showQuickStartAction,
      streamingPreview: state.streamingPreview,
      streamingStatus: state.streamingStatus,
      setCancellingOperation: state.setCancellingOperation,
      setContinuationId: state.setContinuationId,
      setError: state.setError,
      setInput: state.setInput,
      setLastRequestPreferences: state.setLastRequestPreferences,
      setMessages: state.setMessages,
      setResolvedModelRuntime: state.setResolvedModelRuntime,
      setResults: state.setResults,
      setSearchQuery: state.setSearchQuery,
      setShowQuickStartAction: state.setShowQuickStartAction,
      startOperation: state.startOperation,
      finishOperation: state.finishOperation,
    }),
    shallow
  );

  const clearedStageCount = useMemo(
    () => pipelineStages.filter(stage => stage.state === 'cleared').length,
    [pipelineStages]
  );

  const loadingMessage = useMemo(() => {
    if (streamingStatus.trim()) return streamingStatus;
    if (loadingElapsedSec < 12) {
      return t('input.videoSuggestion.thinking', 'Thinking...');
    }
    if (loadingElapsedSec < 45) {
      return t('input.videoSuggestion.stillWorking', 'Still working...');
    }
    if (loadingElapsedSec < 120) {
      return t(
        'input.videoSuggestion.searchingLong',
        'Still searching videos...'
      );
    }
    return t(
      'input.videoSuggestion.searchingVeryLong',
      'Taking longer than usual, but still running.'
    );
  }, [loadingElapsedSec, streamingStatus, t]);

  const showLiveActivity = useMemo(
    () =>
      loading ||
      activeTraceLines.length > 0 ||
      pipelineStages.some(
        stage => stage.state !== 'pending' || stage.outcome.trim().length > 0
      ),
    [activeTraceLines.length, loading, pipelineStages]
  );

  const savedPreferenceSummary = useMemo(
    () => buildSavedPreferenceSummary(savedPreferences),
    [savedPreferences]
  );
  const requestPreferenceSummary = useMemo(
    () => buildSavedPreferenceSummary(requestPreferences),
    [requestPreferences]
  );
  const suggestedFollowUpPrompts = useMemo(
    () =>
      buildSuggestedFollowUpPrompts(
        searchQuery,
        savedPreferences,
        results,
        t,
        {
          includeDownloadHistory: Boolean(
            contextToggles.includeDownloadHistory
          ),
          includeWatchedChannels: Boolean(
            contextToggles.includeWatchedChannels
          ),
          recentDownloadTitles,
          recentChannelNames,
        }
      ),
    [
      contextToggles.includeDownloadHistory,
      contextToggles.includeWatchedChannels,
      recentChannelNames,
      recentDownloadTitles,
      results,
      savedPreferences,
      searchQuery,
      t,
    ]
  );

  const starterQuestionDefault = useMemo(
    () =>
      t(
        'input.videoSuggestion.starterQuestion',
        'What kind of videos do you want, and which country/region should I target?'
      ),
    [t]
  );

  const starterQuestionWithMemory = useMemo(
    () =>
      savedPreferenceSummary
        ? t(
            'input.videoSuggestion.starterQuestionWithMemory',
            'Last time you searched for {{summary}}. Want me to use that again?',
            { summary: savedPreferenceSummary }
          )
        : '',
    [savedPreferenceSummary, t]
  );

  const markPipelineClearedThroughRetrieval = useCallback(() => {
    useVideoSuggestionStore
      .getState()
      .markPipelineClearedThroughRetrieval(
        t('input.videoSuggestion.retrievalReady', 'Results ready.')
      );
  }, [t]);

  useEffect(() => {
    ensureVideoSuggestionStoreRuntime();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!prefsLoaded || !open) return;
    useVideoSuggestionStore
      .getState()
      .ensureStarterMessage(
        starterQuestionWithMemory || starterQuestionDefault,
        Boolean(starterQuestionWithMemory)
      );
  }, [open, prefsLoaded, starterQuestionDefault, starterQuestionWithMemory]);

  const isLatestRequest = useCallback(
    (id: number) => useVideoSuggestionStore.getState().requestId === id,
    []
  );

  const runSearch = useCallback(
    async (
      history: VideoSuggestionMessage[],
      preferencesForRequest: VideoSuggestionPreferenceSlots
    ) => {
      const id = useVideoSuggestionStore.getState().nextRequestId();
      const operationId = `video-suggest-chat-${Date.now()}`;
      const startingResultCount = useVideoSuggestionStore.getState().results.length;

      setMessages(history);
      setShowQuickStartAction(false);
      setError(null);
      setContinuationId(null);
      setLastRequestPreferences(preferencesForRequest);
      startOperation(operationId, 'chat');

      try {
        const res = await suggestVideos({
          history,
          modelPreference,
          preferredLanguage,
          preferredLanguageName,
          preferredCountry,
          preferredRecency,
          savedPreferences: preferencesForRequest,
          contextToggles,
          recentDownloadTitles,
          recentChannelNames,
          operationId,
        });

        if (!isLatestRequest(id)) return;

        if (mountedRef.current) {
          onCapturePreferences(res?.capturedPreferences);
        }

        if (typeof res?.resolvedModel === 'string' && res.resolvedModel.trim()) {
          setResolvedModelRuntime(res.resolvedModel.trim());
        }
        setContinuationId(normalizeContinuationId(res?.continuationId));

        const defaultFollowUp = t(
          'input.videoSuggestion.defaultFollowUp',
          'Tell me a bit more and I will refine the search.'
        );
        const assistantText = resolveAssistantMessage(
          res?.assistantMessage,
          defaultFollowUp,
          t
        );
        const nextResults = Array.isArray(res?.results) ? res.results : [];
        const hideGenericFollowUp =
          nextResults.length > 0 && assistantText === defaultFollowUp;
        const latestResults = useVideoSuggestionStore.getState().results;
        const streamedGrowth = latestResults.length > startingResultCount;

        setMessages(prev => [
          ...normalizeMessagesForPlanner(prev, t),
          ...(hideGenericFollowUp
            ? []
            : [{ role: 'assistant' as const, content: assistantText }]),
        ]);

        setSearchQuery((res?.searchQuery || '').trim());
        if (streamedGrowth || nextResults.length > 0) {
          markPipelineClearedThroughRetrieval();
          onResultsReady();
        }

        if (typeof res?.error === 'string' && res.error.trim()) {
          setError(
            resolveErrorText(
              res.error,
              t(
                'input.videoSuggestion.searchFailed',
                'I could not search right now. Try again in a moment.'
              ),
              t
            )
          );
        }
      } catch (err: any) {
        if (
          useVideoSuggestionStore.getState().cancellingOperationId === operationId
        ) {
          return;
        }
        if (!isLatestRequest(id)) return;

        setMessages(prev => [
          ...normalizeMessagesForPlanner(prev, t),
          {
            role: 'assistant',
            content: t(
              'input.videoSuggestion.errorMessage',
              'Something went wrong. Please try again.'
            ),
          },
        ]);
        setError(
          resolveErrorText(
            err?.message,
            t(
              'input.videoSuggestion.requestFailed',
              'Suggestion request failed'
            ),
            t
          )
        );
      } finally {
        const cancelledOperation =
          useVideoSuggestionStore.getState().cancellingOperationId === operationId;
        if (!cancelledOperation && isLatestRequest(id)) {
          finishOperation(operationId);
        }
      }
    },
    [
      finishOperation,
      isLatestRequest,
      markPipelineClearedThroughRetrieval,
      modelPreference,
      onCapturePreferences,
      onResultsReady,
      preferredCountry,
      preferredLanguage,
      preferredLanguageName,
      preferredRecency,
      setContinuationId,
      setError,
      setLastRequestPreferences,
      setMessages,
      setResolvedModelRuntime,
      setResults,
      setSearchQuery,
      setShowQuickStartAction,
      startOperation,
      contextToggles,
      recentChannelNames,
      recentDownloadTitles,
      t,
    ]
  );

  const sendMessage = useCallback(async () => {
    const currentState = useVideoSuggestionStore.getState();
    const trimmed = currentState.input.trim();
    if (currentState.loading) return;

    const implicitPrompt = buildImplicitSearchPrompt(
      requestPreferenceSummary || savedPreferenceSummary,
      t
    );
    const userPrompt = trimmed || implicitPrompt;

    setInput('');
    const nextHistory: VideoSuggestionMessage[] = [
      ...normalizeMessagesForPlanner(currentState.messages, t),
      { role: 'user', content: userPrompt },
    ];

    await runSearch(nextHistory, requestPreferences);
  }, [
    requestPreferenceSummary,
    requestPreferences,
    runSearch,
    savedPreferenceSummary,
    setInput,
    t,
  ]);

  const runQuickStartSearch = useCallback(async () => {
    if (!savedPreferenceSummary || useVideoSuggestionStore.getState().loading) {
      return;
    }

    const quickPrompt = t(
      'input.videoSuggestion.quickStartUserMessage',
      'Use my last saved preferences and find videos now: {{summary}}',
      { summary: savedPreferenceSummary }
    );
    const nextHistory: VideoSuggestionMessage[] = [
      ...normalizeMessagesForPlanner(
        useVideoSuggestionStore.getState().messages,
        t
      ),
      { role: 'user', content: quickPrompt },
    ];

    await runSearch(nextHistory, savedPreferences);
  }, [savedPreferenceSummary, savedPreferences, runSearch, t]);

  const searchMore = useCallback(async () => {
    const currentState = useVideoSuggestionStore.getState();
    if (
      currentState.loading ||
      (!currentState.continuationId && !currentState.searchQuery.trim())
    ) {
      return;
    }

    const id = currentState.nextRequestId();
    const operationId = `video-suggest-more-${Date.now()}`;
    const startingResultCount = currentState.results.length;
    const continuationPreferences =
      currentState.lastRequestPreferences.topic
        ? currentState.lastRequestPreferences
        : requestPreferences;

    setShowQuickStartAction(false);
    setError(null);
    startOperation(operationId, 'more');

    try {
      const res = await suggestVideos({
        history: normalizeMessagesForPlanner(currentState.messages, t),
        modelPreference,
        preferredLanguage,
        preferredLanguageName,
        preferredCountry,
        preferredRecency,
        savedPreferences: continuationPreferences,
        contextToggles,
        recentDownloadTitles,
        recentChannelNames,
        continuationId: currentState.continuationId || undefined,
        searchQueryOverride: currentState.searchQuery,
        excludeUrls: currentState.results.map(item => item.url),
        operationId,
      });

      if (!isLatestRequest(id)) return;

      if (mountedRef.current) {
        onCapturePreferences(res?.capturedPreferences);
      }

      if (typeof res?.resolvedModel === 'string' && res.resolvedModel.trim()) {
        setResolvedModelRuntime(res.resolvedModel.trim());
      }
      setContinuationId(
        normalizeContinuationId(res?.continuationId) || currentState.continuationId
      );
      if (typeof res?.searchQuery === 'string' && res.searchQuery.trim()) {
        setSearchQuery(res.searchQuery.trim());
      }

      const incoming = Array.isArray(res?.results) ? res.results : [];
      const latestResults = useVideoSuggestionStore.getState().results;
      const streamedGrowth = latestResults.length > startingResultCount;
      const seen = new Set(latestResults.map(item => item.url));
      const fresh: VideoSuggestionResultItem[] = [];
      for (const item of incoming) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        fresh.push(item);
      }

      if (res?.success !== false && (fresh.length > 0 || streamedGrowth)) {
        if (fresh.length > 0) {
          setResults([...latestResults, ...fresh]);
        }
        markPipelineClearedThroughRetrieval();
        onResultsReady();
      } else if (res?.success !== false) {
        setMessages(prev => [
          ...normalizeMessagesForPlanner(prev, t),
          {
            role: 'assistant',
            content: t(
              'input.videoSuggestion.noMoreResults',
              'No more distinct results found. Try adjusting country or recency.'
            ),
          },
        ]);
      }

      if (typeof res?.error === 'string' && res.error.trim()) {
        setError(
          resolveErrorText(
            res.error,
            t(
              'input.videoSuggestion.searchFailed',
              'I could not search right now. Try again in a moment.'
            ),
            t
          )
        );
      }
    } catch (err: any) {
      if (
        useVideoSuggestionStore.getState().cancellingOperationId === operationId
      ) {
        return;
      }
      if (!isLatestRequest(id)) return;
      setError(
        resolveErrorText(
          err?.message,
          t('input.videoSuggestion.requestFailed', 'Suggestion request failed'),
          t
        )
      );
    } finally {
      const cancelledOperation =
        useVideoSuggestionStore.getState().cancellingOperationId === operationId;
      if (!cancelledOperation && isLatestRequest(id)) {
        finishOperation(operationId);
      }
    }
  }, [
    finishOperation,
    isLatestRequest,
    markPipelineClearedThroughRetrieval,
    modelPreference,
    onCapturePreferences,
    onResultsReady,
      preferredCountry,
      preferredLanguage,
      preferredLanguageName,
      preferredRecency,
      contextToggles,
      recentChannelNames,
      recentDownloadTitles,
      requestPreferences,
      setContinuationId,
    setError,
    setMessages,
    setResolvedModelRuntime,
    setResults,
    setShowQuickStartAction,
    startOperation,
    t,
  ]);

  const cancelSearch = useCallback(async () => {
    const operationId = useVideoSuggestionStore.getState().activeOperationId;
    if (!operationId || useVideoSuggestionStore.getState().cancelling) return;

    setCancellingOperation(operationId);
    try {
      const result = await OperationIPC.cancel(operationId);
      if (!result?.success) {
        throw new Error(
          result?.message ||
            t(
              'input.videoSuggestion.cancelFailed',
              'Failed to cancel the current search.'
            )
        );
      }

      useVideoSuggestionStore.getState().nextRequestId();
      useVideoSuggestionStore.getState().clearActiveOperation(operationId);
      useVideoSuggestionStore.getState().resetLiveActivityState();
      setError(null);
    } catch (err: any) {
      setError(
        resolveErrorText(
          err?.message,
          t(
            'input.videoSuggestion.cancelFailed',
            'Failed to cancel the current search.'
          ),
          t
        )
      );
    } finally {
      setCancellingOperation(null);
    }
  }, [setCancellingOperation, setError, t]);

  const resetChat = useCallback(() => {
    useVideoSuggestionStore
      .getState()
      .resetSession(
        starterQuestionWithMemory || starterQuestionDefault,
        Boolean(starterQuestionWithMemory)
      );
  }, [starterQuestionDefault, starterQuestionWithMemory]);

  return {
    activeTraceLines,
    cancelSearch,
    cancelling,
    clearedStageCount,
    continuationId,
    error,
    input,
    loading,
    loadingElapsedSec,
    loadingMessage,
    loadingMode,
    messages,
    pipelineStages,
    resolvedModelRuntime,
    results,
    runningStage,
    suggestedFollowUpPrompts,
    showQuickStartAction,
    searchMore,
    searchQuery,
    resetChat,
    sendMessage,
    setError,
    setInput,
    showLiveActivity,
    streamingPreview,
    runQuickStartSearch,
  };
}
