import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TFunction } from 'i18next';
import {
  onVideoSuggestionProgress,
  suggestVideos,
} from '../../../../ipc/video-suggestions.js';
import * as OperationIPC from '../../../../ipc/operation.js';
import type {
  PipelineStageProgress,
  PipelineStageState,
} from './VideoSuggestionPanel.types.js';
import type {
  VideoSuggestionMessage,
  VideoSuggestionModelPreference,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionRecency,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import {
  createInitialPipelineStages,
  inferStageFromMessage,
  isMatchingOperationId,
  isPipelineStageKey,
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
  requestPreferences: VideoSuggestionPreferenceSlots;
  savedPreferences: VideoSuggestionPreferenceSlots;
  t: TFunction;
};

type UseVideoSuggestionFlowResult = {
  activeTraceLines: string[];
  cancelSearch: () => Promise<void>;
  cancelling: boolean;
  clearedStageCount: number;
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
  showQuickStartAction: boolean;
  searchMore: () => Promise<void>;
  searchQuery: string;
  resetChat: () => void;
  sendMessage: () => Promise<void>;
  setError: (next: string | null) => void;
  setInput: (next: string) => void;
  setMessages: Dispatch<SetStateAction<VideoSuggestionMessage[]>>;
  setResults: Dispatch<SetStateAction<VideoSuggestionResultItem[]>>;
  showLiveActivity: boolean;
  streamingPreview: string;
  runQuickStartSearch: () => Promise<void>;
};

const MAX_LOADING_TRACE_BUFFER = 28;

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
  for (const raw of [
    savedPreferences.topic,
    savedPreferences.creator,
    savedPreferences.subtopic,
  ]) {
    const text = compactText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(text);
  }
  return values.slice(0, 3).join(', ');
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
  requestPreferences,
  savedPreferences,
  t,
}: UseVideoSuggestionFlowParams): UseVideoSuggestionFlowResult {
  const [messages, setMessages] = useState<VideoSuggestionMessage[]>([]);
  const [input, setInput] = useState('');
  const [results, setResults] = useState<VideoSuggestionResultItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<'chat' | 'more' | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [loadingElapsedSec, setLoadingElapsedSec] = useState(0);
  const [streamingStatus, setStreamingStatus] = useState('');
  const [streamingPreview, setStreamingPreview] = useState('');
  const [loadingTrace, setLoadingTrace] = useState<string[]>([]);
  const [pipelineStages, setPipelineStages] = useState<PipelineStageProgress[]>(
    () => createInitialPipelineStages()
  );
  const [error, setErrorState] = useState<string | null>(null);
  const [showQuickStartAction, setShowQuickStartAction] = useState(false);
  const [resolvedModelRuntime, setResolvedModelRuntime] = useState<
    string | null
  >(null);
  const [continuationId, setContinuationId] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const resultsRef = useRef<VideoSuggestionResultItem[]>([]);
  const activeOperationIdRef = useRef<string | null>(null);
  const cancellingOperationIdRef = useRef<string | null>(null);
  const lastRequestPreferencesRef = useRef<VideoSuggestionPreferenceSlots>({});
  const lastTraceKeyRef = useRef('');

  const setError = useCallback((next: string | null) => {
    setErrorState(next);
  }, []);

  const stopLoadingState = useCallback(() => {
    setLoading(false);
    setLoadingMode(null);
    setStreamingStatus('');
  }, []);

  const resetLiveActivityState = useCallback(() => {
    lastTraceKeyRef.current = '';
    stopLoadingState();
    setLoadingElapsedSec(0);
    setStreamingPreview('');
    setLoadingTrace([]);
    setPipelineStages(createInitialPipelineStages());
  }, [stopLoadingState]);

  const markPipelineClearedThroughRetrieval = useCallback(() => {
    setPipelineStages(prev =>
      prev.map(stage => {
        if (stage.state === 'cleared') return stage;
        if (stage.key === 'retrieval') {
          return {
            ...stage,
            state: 'cleared',
            outcome:
              stage.outcome ||
              t('input.videoSuggestion.retrievalReady', 'Results ready.'),
          };
        }
        return {
          ...stage,
          state: 'cleared',
        };
      })
    );
  }, [t]);

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
        'Still searching and ranking videos...'
      );
    }
    return t(
      'input.videoSuggestion.searchingVeryLong',
      'Taking longer than usual, but still running.'
    );
  }, [loadingElapsedSec, streamingStatus, t]);

  const clearedStageCount = useMemo(
    () => pipelineStages.filter(stage => stage.state === 'cleared').length,
    [pipelineStages]
  );

  const runningStage = useMemo(
    () => pipelineStages.find(stage => stage.state === 'running') || null,
    [pipelineStages]
  );

  const activeTraceLines = useMemo(
    () => loadingTrace.slice(-10),
    [loadingTrace]
  );

  const showLiveActivity = useMemo(
    () =>
      loading ||
      activeTraceLines.length > 0 ||
      pipelineStages.some(
        stage => stage.state !== 'pending' || stage.outcome.trim().length > 0
      ),
    [activeTraceLines.length, loading, pipelineStages]
  );

  const beginLoadingOperation = useCallback((operationId: string) => {
    activeOperationIdRef.current = operationId;
    lastTraceKeyRef.current = '';
    setLoadingElapsedSec(0);
    setStreamingStatus('');
    setStreamingPreview('');
    setLoadingTrace([]);
    setPipelineStages(createInitialPipelineStages());
    setResolvedModelRuntime(null);
  }, []);

  const cancelSearch = useCallback(async () => {
    const operationId = activeOperationIdRef.current;
    if (!operationId || cancelling) return;

    setCancelling(true);
    cancellingOperationIdRef.current = operationId;
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

      requestIdRef.current += 1;
      activeOperationIdRef.current = null;
      resetLiveActivityState();
      setErrorState(null);
    } catch (err: any) {
      cancellingOperationIdRef.current = null;
      setErrorState(
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
      if (cancellingOperationIdRef.current === operationId) {
        cancellingOperationIdRef.current = null;
      }
      setCancelling(false);
    }
  }, [cancelling, resetLiveActivityState, t]);

  const savedPreferenceSummary = useMemo(
    () => buildSavedPreferenceSummary(savedPreferences),
    [savedPreferences]
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

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    const unsubscribe = onVideoSuggestionProgress(progress => {
      const activeOperationId = activeOperationIdRef.current;
      if (!isMatchingOperationId(activeOperationId, progress?.operationId)) {
        return;
      }

      if (
        typeof progress?.elapsedMs === 'number' &&
        Number.isFinite(progress.elapsedMs)
      ) {
        setLoadingElapsedSec(
          Math.max(0, Math.floor(progress.elapsedMs / 1000))
        );
      }

      const progressMessage =
        typeof progress?.message === 'string' ? progress.message.trim() : '';

      if (progressMessage) {
        setStreamingStatus(progressMessage);
        const phase = typeof progress?.phase === 'string' ? progress.phase : '';
        const elapsedSecForLine =
          typeof progress?.elapsedMs === 'number' &&
          Number.isFinite(progress.elapsedMs)
            ? Math.max(0, Math.floor(progress.elapsedMs / 1000))
            : null;
        const prefixedLine = `${elapsedSecForLine != null ? `${elapsedSecForLine}s · ` : ''}${phase ? `[${phase}] ` : ''}${progressMessage}`;
        const traceKey = `${phase}|${progressMessage}`;
        setLoadingTrace(prev => {
          const isRepeat = lastTraceKeyRef.current === traceKey;
          if (isRepeat) {
            if (prev.length === 0) return prev;
            const next = [...prev];
            next[next.length - 1] = prefixedLine;
            return next;
          }
          lastTraceKeyRef.current = traceKey;
          return [...prev, prefixedLine].slice(-MAX_LOADING_TRACE_BUFFER);
        });
      }

      const stageFromPayload = isPipelineStageKey(progress?.stageKey)
        ? {
            key: progress.stageKey,
            state:
              progress?.stageState === 'cleared'
                ? ('cleared' as const)
                : progress?.stageState === 'running'
                  ? ('running' as const)
                  : ('pending' as const),
          }
        : null;

      const stageFromMessage =
        !stageFromPayload && progressMessage
          ? inferStageFromMessage(progressMessage)
          : null;

      const stageUpdate = stageFromPayload || stageFromMessage;

      if (stageUpdate) {
        const outcomeRaw =
          typeof progress?.stageOutcome === 'string'
            ? progress.stageOutcome.trim()
            : '';
        const outcome =
          outcomeRaw ||
          (stageUpdate.state === 'cleared' ? progressMessage : '');

        setPipelineStages(prev =>
          prev.map(stage => {
            if (stage.key !== stageUpdate.key) return stage;
            if (stage.state === 'cleared' && stageUpdate.state !== 'cleared') {
              return stage;
            }
            return {
              ...stage,
              state: stageUpdate.state as PipelineStageState,
              outcome: outcome || stage.outcome,
            };
          })
        );
      }

      const streamedQuery =
        typeof progress?.searchQuery === 'string'
          ? progress.searchQuery.trim()
          : '';
      if (streamedQuery) {
        setSearchQuery(streamedQuery);
      }

      const preview =
        typeof progress?.assistantPreview === 'string'
          ? progress.assistantPreview
          : '';
      if (preview.trim()) {
        const normalizedPreview = preview.trim();
        setLoadingTrace(prev => {
          if (prev[prev.length - 1] === normalizedPreview) return prev;
          return [...prev, normalizedPreview].slice(-MAX_LOADING_TRACE_BUFFER);
        });
        setStreamingPreview(normalizedPreview);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(
    () => () => {
      const operationId = activeOperationIdRef.current;
      if (!operationId) return;
      void OperationIPC.cancel(operationId).catch(() => void 0);
    },
    []
  );

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    setLoadingElapsedSec(0);
    const timer = window.setInterval(() => {
      setLoadingElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [loading]);

  useEffect(() => {
    if (!prefsLoaded || !open) return;
    if (messages.length > 0 || resultsRef.current.length > 0) return;
    if (searchQuery.trim() || loading) return;

    setMessages([
      {
        role: 'assistant',
        content: starterQuestionWithMemory || starterQuestionDefault,
      },
    ]);
    setShowQuickStartAction(Boolean(starterQuestionWithMemory));
    setErrorState(null);
  }, [
    loading,
    messages.length,
    open,
    prefsLoaded,
    searchQuery,
    starterQuestionDefault,
    starterQuestionWithMemory,
  ]);

  const submitMessage = useCallback(
    async (
      trimmed: string,
      preferencesForRequest: VideoSuggestionPreferenceSlots = requestPreferences
    ) => {
      const safeText = trimmed.trim();
      if (!safeText || loading) return;

      setShowQuickStartAction(false);
      const normalizedHistory = normalizeMessagesForPlanner(messages, t);
      const nextHistory: VideoSuggestionMessage[] = [
        ...normalizedHistory,
        { role: 'user', content: safeText },
      ];

      setMessages(nextHistory);
      setLoading(true);
      setLoadingMode('chat');
      setErrorState(null);
      setContinuationId(null);
      lastRequestPreferencesRef.current = preferencesForRequest;

      const id = ++requestIdRef.current;
      const operationId = `video-suggest-chat-${Date.now()}`;
      beginLoadingOperation(operationId);

      try {
        const res = await suggestVideos({
          history: nextHistory,
          modelPreference,
          preferredLanguage,
          preferredLanguageName,
          preferredCountry,
          preferredRecency,
          savedPreferences: preferencesForRequest,
          operationId,
        });

        if (id !== requestIdRef.current) return;

        onCapturePreferences(res?.capturedPreferences);

        if (
          typeof res?.resolvedModel === 'string' &&
          res.resolvedModel.trim()
        ) {
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
        const nextResults = res?.results || [];
        const hideGenericFollowUp =
          nextResults.length > 0 &&
          !res?.needsMoreContext &&
          assistantText === defaultFollowUp;

        setMessages(prev => [
          ...normalizeMessagesForPlanner(prev, t),
          ...(hideGenericFollowUp
            ? []
            : [{ role: 'assistant' as const, content: assistantText }]),
        ]);

        setResults(nextResults);
        setSearchQuery((res?.searchQuery || '').trim());
        if (nextResults.length > 0) {
          markPipelineClearedThroughRetrieval();
          onResultsReady();
        }

        if (typeof res?.error === 'string' && res.error.trim()) {
          setErrorState(
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
        if (cancellingOperationIdRef.current === operationId) return;
        if (id !== requestIdRef.current) return;

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
        setErrorState(
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
          cancellingOperationIdRef.current === operationId;
        if (!cancelledOperation && id === requestIdRef.current) {
          stopLoadingState();
          if (activeOperationIdRef.current === operationId) {
            activeOperationIdRef.current = null;
          }
        }
      }
    },
    [
      beginLoadingOperation,
      loading,
      markPipelineClearedThroughRetrieval,
      messages,
      modelPreference,
      onCapturePreferences,
      onResultsReady,
      preferredCountry,
      preferredLanguage,
      preferredLanguageName,
      preferredRecency,
      requestPreferences,
      stopLoadingState,
      t,
    ]
  );

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput('');
    await submitMessage(trimmed);
  }, [input, submitMessage]);

  const runQuickStartSearch = useCallback(async () => {
    if (!savedPreferenceSummary || loading) return;
    const quickPrompt = t(
      'input.videoSuggestion.quickStartUserMessage',
      'Use my last saved preferences and find videos now: {{summary}}',
      { summary: savedPreferenceSummary }
    );
    await submitMessage(quickPrompt, savedPreferences);
  }, [loading, savedPreferenceSummary, savedPreferences, submitMessage, t]);

  const searchMore = useCallback(async () => {
    if (loading || (!continuationId && !searchQuery.trim())) return;

    setShowQuickStartAction(false);
    const id = ++requestIdRef.current;
    const operationId = `video-suggest-more-${Date.now()}`;
    const normalizedHistory = normalizeMessagesForPlanner(messages, t);
    const continuationPreferences =
      lastRequestPreferencesRef.current.topic ||
      lastRequestPreferencesRef.current.creator ||
      lastRequestPreferencesRef.current.subtopic
        ? lastRequestPreferencesRef.current
        : requestPreferences;

    setLoading(true);
    setLoadingMode('more');
    setErrorState(null);
    beginLoadingOperation(operationId);

    try {
      const res = await suggestVideos({
        history: normalizedHistory,
        modelPreference,
        preferredLanguage,
        preferredLanguageName,
        preferredCountry,
        preferredRecency,
        savedPreferences: continuationPreferences,
        continuationId: continuationId || undefined,
        searchQueryOverride: searchQuery,
        excludeUrls: results.map(item => item.url),
        operationId,
      });

      if (id !== requestIdRef.current) return;

      onCapturePreferences(res?.capturedPreferences);

      if (typeof res?.resolvedModel === 'string' && res.resolvedModel.trim()) {
        setResolvedModelRuntime(res.resolvedModel.trim());
      }
      setContinuationId(
        normalizeContinuationId(res?.continuationId) || continuationId
      );

      const incoming = Array.isArray(res?.results) ? res.results : [];
      const currentResults = resultsRef.current;
      const seen = new Set(currentResults.map(item => item.url));
      const fresh: VideoSuggestionResultItem[] = [];
      for (const item of incoming) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        fresh.push(item);
      }

      if (fresh.length > 0) {
        const nextResults = [...currentResults, ...fresh];
        resultsRef.current = nextResults;
        setResults(nextResults);
        markPipelineClearedThroughRetrieval();
        onResultsReady();
      } else {
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
        setErrorState(
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
      if (cancellingOperationIdRef.current === operationId) return;
      if (id !== requestIdRef.current) return;
      setErrorState(
        resolveErrorText(
          err?.message,
          t('input.videoSuggestion.requestFailed', 'Suggestion request failed'),
          t
        )
      );
    } finally {
      const cancelledOperation =
        cancellingOperationIdRef.current === operationId;
      if (!cancelledOperation && id === requestIdRef.current) {
        stopLoadingState();
        if (activeOperationIdRef.current === operationId) {
          activeOperationIdRef.current = null;
        }
      }
    }
  }, [
    beginLoadingOperation,
    loading,
    messages,
    modelPreference,
    onCapturePreferences,
    markPipelineClearedThroughRetrieval,
    onResultsReady,
    continuationId,
    preferredCountry,
    preferredLanguage,
    preferredLanguageName,
    preferredRecency,
    requestPreferences,
    results,
    searchQuery,
    stopLoadingState,
    t,
  ]);

  const resetChat = useCallback(() => {
    requestIdRef.current += 1;
    activeOperationIdRef.current = null;
    cancellingOperationIdRef.current = null;
    resetLiveActivityState();
    setErrorState(null);
    setInput('');
    setMessages([
      {
        role: 'assistant',
        content: starterQuestionWithMemory || starterQuestionDefault,
      },
    ]);
    setSearchQuery('');
    setContinuationId(null);
    setResolvedModelRuntime(null);
    resultsRef.current = [];
    setResults([]);
    setShowQuickStartAction(Boolean(starterQuestionWithMemory));
  }, [
    resetLiveActivityState,
    starterQuestionDefault,
    starterQuestionWithMemory,
  ]);

  return {
    activeTraceLines,
    cancelSearch,
    cancelling,
    clearedStageCount,
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
    showQuickStartAction,
    searchMore,
    searchQuery,
    resetChat,
    sendMessage,
    setError,
    setInput,
    setMessages,
    setResults,
    showLiveActivity,
    streamingPreview,
    runQuickStartSearch,
  };
}
