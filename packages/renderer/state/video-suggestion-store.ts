import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { onVideoSuggestionProgress } from '../ipc/video-suggestions.js';
import type {
  VideoSuggestionMessage,
  VideoSuggestionPreferenceSlots,
  VideoSuggestionProgress,
  VideoSuggestionResultItem,
} from '@shared-types/app';
import {
  createInitialPipelineStages,
  inferStageFromMessage,
  isMatchingOperationId,
  isPipelineStageKey,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-helpers.js';
import type {
  PipelineStageProgress,
  PipelineStageState,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';

const MAX_LOADING_TRACE_BUFFER = 28;

type LoadingMode = 'chat' | 'more' | null;
type Updater<T> = T | ((prev: T) => T);

type VideoSuggestionState = {
  input: string;
  messages: VideoSuggestionMessage[];
  results: VideoSuggestionResultItem[];
  searchQuery: string;
  loading: boolean;
  loadingMode: LoadingMode;
  cancelling: boolean;
  loadingElapsedSec: number;
  loadingStartedAtMs: number | null;
  streamingStatus: string;
  streamingPreview: string;
  loadingTrace: string[];
  pipelineStages: PipelineStageProgress[];
  error: string | null;
  showQuickStartAction: boolean;
  resolvedModelRuntime: string | null;
  continuationId: string | null;
  requestId: number;
  activeOperationId: string | null;
  cancellingOperationId: string | null;
  lastRequestPreferences: VideoSuggestionPreferenceSlots;
  lastTraceKey: string;
};

type VideoSuggestionActions = {
  setInput: (value: string) => void;
  setError: (value: string | null) => void;
  setMessages: (value: Updater<VideoSuggestionMessage[]>) => void;
  setResults: (value: Updater<VideoSuggestionResultItem[]>) => void;
  setSearchQuery: (value: string) => void;
  setShowQuickStartAction: (value: boolean) => void;
  setResolvedModelRuntime: (value: string | null) => void;
  setContinuationId: (value: string | null) => void;
  setLastRequestPreferences: (value: VideoSuggestionPreferenceSlots) => void;
  setCancellingOperation: (value: string | null) => void;
  nextRequestId: () => number;
  startOperation: (operationId: string, mode: Exclude<LoadingMode, null>) => void;
  finishOperation: (operationId: string) => void;
  clearActiveOperation: (operationId?: string | null) => void;
  resetLiveActivityState: () => void;
  markPipelineClearedThroughRetrieval: (retrievalReadyText: string) => void;
  resetSession: (
    starterMessage: string,
    showQuickStartAction: boolean
  ) => void;
  ensureStarterMessage: (
    starterMessage: string,
    showQuickStartAction: boolean
  ) => void;
  applyProgress: (progress: VideoSuggestionProgress) => void;
  tickElapsed: () => void;
};

type VideoSuggestionStore = VideoSuggestionState & VideoSuggestionActions;

const initialState: VideoSuggestionState = {
  input: '',
  messages: [],
  results: [],
  searchQuery: '',
  loading: false,
  loadingMode: null,
  cancelling: false,
  loadingElapsedSec: 0,
  loadingStartedAtMs: null,
  streamingStatus: '',
  streamingPreview: '',
  loadingTrace: [],
  pipelineStages: createInitialPipelineStages(),
  error: null,
  showQuickStartAction: false,
  resolvedModelRuntime: null,
  continuationId: null,
  requestId: 0,
  activeOperationId: null,
  cancellingOperationId: null,
  lastRequestPreferences: {},
  lastTraceKey: '',
};

function resolveUpdater<T>(value: Updater<T>, prev: T): T {
  return typeof value === 'function'
    ? (value as (previous: T) => T)(prev)
    : value;
}

function resetLiveActivityState(state: VideoSuggestionState) {
  state.lastTraceKey = '';
  state.loading = false;
  state.loadingMode = null;
  state.loadingElapsedSec = 0;
  state.loadingStartedAtMs = null;
  state.streamingStatus = '';
  state.streamingPreview = '';
  state.loadingTrace = [];
  state.pipelineStages = createInitialPipelineStages();
}

function mergeSuggestionResults(
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

export const useVideoSuggestionStore =
  createWithEqualityFn<VideoSuggestionStore>()(
    immer(set => ({
      ...initialState,

      setInput: value =>
        set(state => {
          state.input = value;
        }),

      setError: value =>
        set(state => {
          state.error = value;
        }),

      setMessages: value =>
        set(state => {
          state.messages = resolveUpdater(value, state.messages);
        }),

      setResults: value =>
        set(state => {
          state.results = resolveUpdater(value, state.results);
        }),

      setSearchQuery: value =>
        set(state => {
          state.searchQuery = value;
        }),

      setShowQuickStartAction: value =>
        set(state => {
          state.showQuickStartAction = value;
        }),

      setResolvedModelRuntime: value =>
        set(state => {
          state.resolvedModelRuntime = value;
        }),

      setContinuationId: value =>
        set(state => {
          state.continuationId = value;
        }),

      setLastRequestPreferences: value =>
        set(state => {
          state.lastRequestPreferences = value;
        }),

      setCancellingOperation: value =>
        set(state => {
          state.cancellingOperationId = value;
          state.cancelling = Boolean(value);
        }),

      nextRequestId: () => {
        let nextId = 0;
        set(state => {
          state.requestId += 1;
          nextId = state.requestId;
        });
        return nextId;
      },

      startOperation: (operationId, mode) =>
        set(state => {
          state.activeOperationId = operationId;
          state.cancellingOperationId = null;
          state.cancelling = false;
          state.loading = true;
          state.loadingMode = mode;
          state.loadingElapsedSec = 0;
          state.loadingStartedAtMs = Date.now();
          state.streamingStatus = '';
          state.streamingPreview = '';
          state.loadingTrace = [];
          state.pipelineStages = createInitialPipelineStages();
          state.resolvedModelRuntime = null;
          state.lastTraceKey = '';
        }),

      finishOperation: operationId =>
        set(state => {
          if (state.activeOperationId !== operationId) return;
          state.loading = false;
          state.loadingMode = null;
          state.loadingStartedAtMs = null;
          state.streamingStatus = '';
          state.activeOperationId = null;
        }),

      clearActiveOperation: operationId =>
        set(state => {
          if (
            operationId != null &&
            state.activeOperationId &&
            state.activeOperationId !== operationId
          ) {
            return;
          }
          state.activeOperationId = null;
        }),

      resetLiveActivityState: () =>
        set(state => {
          resetLiveActivityState(state);
        }),

      markPipelineClearedThroughRetrieval: retrievalReadyText =>
        set(state => {
          state.pipelineStages = state.pipelineStages.map(stage => {
            if (stage.state === 'cleared') return stage;
            if (stage.key === 'retrieval') {
              return {
                ...stage,
                state: 'cleared',
                outcome: stage.outcome || retrievalReadyText,
              };
            }
            return {
              ...stage,
              state: 'cleared',
            };
          });
        }),

      resetSession: (starterMessage, showQuickStartAction) =>
        set(state => {
          state.requestId += 1;
          state.activeOperationId = null;
          state.cancellingOperationId = null;
          state.cancelling = false;
          resetLiveActivityState(state);
          state.error = null;
          state.input = '';
          state.messages = [
            {
              role: 'assistant',
              content: starterMessage,
            },
          ];
          state.searchQuery = '';
          state.continuationId = null;
          state.resolvedModelRuntime = null;
          state.results = [];
          state.showQuickStartAction = showQuickStartAction;
          state.lastRequestPreferences = {};
        }),

      ensureStarterMessage: (starterMessage, showQuickStartAction) =>
        set(state => {
          if (state.messages.length > 0) return;
          if (state.results.length > 0) return;
          if (state.searchQuery.trim()) return;
          if (state.loading) return;
          state.messages = [
            {
              role: 'assistant',
              content: starterMessage,
            },
          ];
          state.showQuickStartAction = showQuickStartAction;
          state.error = null;
        }),

      applyProgress: progress =>
        set(state => {
          if (
            !isMatchingOperationId(
              state.activeOperationId,
              progress?.operationId
            )
          ) {
            return;
          }

          if (
            typeof progress?.elapsedMs === 'number' &&
            Number.isFinite(progress.elapsedMs)
          ) {
            const elapsedSec = Math.max(
              0,
              Math.floor(progress.elapsedMs / 1000)
            );
            state.loadingElapsedSec = elapsedSec;
            state.loadingStartedAtMs = Date.now() - progress.elapsedMs;
          }

          const progressMessage =
            typeof progress?.message === 'string' ? progress.message.trim() : '';

          if (progressMessage) {
            state.streamingStatus = progressMessage;
            const phase =
              typeof progress?.phase === 'string' ? progress.phase : '';
            const elapsedSecForLine =
              typeof progress?.elapsedMs === 'number' &&
              Number.isFinite(progress.elapsedMs)
                ? Math.max(0, Math.floor(progress.elapsedMs / 1000))
                : null;
            const prefixedLine = `${elapsedSecForLine != null ? `${elapsedSecForLine}s · ` : ''}${phase ? `[${phase}] ` : ''}${progressMessage}`;
            const traceKey = `${phase}|${progressMessage}`;
            const isRepeat = state.lastTraceKey === traceKey;
            if (isRepeat) {
              if (state.loadingTrace.length > 0) {
                state.loadingTrace[state.loadingTrace.length - 1] = prefixedLine;
              }
            } else {
              state.lastTraceKey = traceKey;
              state.loadingTrace = [...state.loadingTrace, prefixedLine].slice(
                -MAX_LOADING_TRACE_BUFFER
              );
            }
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

            state.pipelineStages = state.pipelineStages.map(stage => {
              if (stage.key !== stageUpdate.key) return stage;
              if (stage.state === 'cleared' && stageUpdate.state !== 'cleared') {
                return stage;
              }
              return {
                ...stage,
                state: stageUpdate.state as PipelineStageState,
                outcome: outcome || stage.outcome,
              };
            });
          }

          const streamedQuery =
            typeof progress?.searchQuery === 'string'
              ? progress.searchQuery.trim()
              : '';
          if (streamedQuery) {
            state.searchQuery = streamedQuery;
          }

          const preview =
            typeof progress?.assistantPreview === 'string'
              ? progress.assistantPreview
              : '';
          if (preview.trim()) {
            const normalizedPreview = preview.trim();
            if (
              state.loadingTrace[state.loadingTrace.length - 1] !==
              normalizedPreview
            ) {
              state.loadingTrace = [
                ...state.loadingTrace,
                normalizedPreview,
              ].slice(-MAX_LOADING_TRACE_BUFFER);
            }
            state.streamingPreview = normalizedPreview;
          }

          if (Array.isArray(progress?.partialResults)) {
            state.results = mergeSuggestionResults(
              state.results,
              progress.partialResults
            );
          }
        }),

      tickElapsed: () =>
        set(state => {
          if (!state.loading || state.loadingStartedAtMs == null) return;
          const nextElapsed = Math.max(
            0,
            Math.floor((Date.now() - state.loadingStartedAtMs) / 1000)
          );
          if (nextElapsed > state.loadingElapsedSec) {
            state.loadingElapsedSec = nextElapsed;
          }
        }),
    }))
  );

let runtimeInitialized = false;

export function ensureVideoSuggestionStoreRuntime(): void {
  if (runtimeInitialized) return;
  runtimeInitialized = true;

  onVideoSuggestionProgress(progress => {
    useVideoSuggestionStore.getState().applyProgress(progress);
  });

  window.setInterval(() => {
    useVideoSuggestionStore.getState().tickElapsed();
  }, 1000);
}
