import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import * as OperationIPC from '../ipc/operation';
import { useHighlightGenerationRequestStore } from './highlight-generation-request-store';
import { useTaskStore } from './task-store';

export interface HighlightWorkflowRuntime {
  running: boolean;
  requiresTranscription: boolean;
  transcriptionOperationId: string | null;
  summaryStarted: boolean;
  awaitingSummaryStart: boolean;
  isCancelling: boolean;
  requestId: number | null;
  sourceKey: string | null;
  runToken: number;
}

type State = HighlightWorkflowRuntime;

interface Actions {
  startWorkflow(options: {
    requiresTranscription: boolean;
    transcriptionOperationId: string | null;
    sourceKey: string | null;
  }): number;
  setAwaitingSummaryStart(requestId: number): void;
  resetRuntime(): void;
  cancelActiveWorkflow(): Promise<void>;
  reconcileRuntime(): void;
}

const initialRuntime: HighlightWorkflowRuntime = {
  running: false,
  requiresTranscription: false,
  transcriptionOperationId: null,
  summaryStarted: false,
  awaitingSummaryStart: false,
  isCancelling: false,
  requestId: null,
  sourceKey: null,
  runToken: 0,
};

function findActiveGenerateSubtitlesRequestId(): {
  requestId: number;
  summaryOperationId: string | null;
} | null {
  const requestState = useHighlightGenerationRequestStore.getState();

  for (const [requestId, request] of Object.entries(
    requestState.pendingRequests
  )) {
    if (request.source !== 'generate-subtitles') continue;
    return {
      requestId: Number(requestId),
      summaryOperationId: null,
    };
  }

  for (const [requestId, request] of Object.entries(
    requestState.claimedRequests
  )) {
    if (request.source !== 'generate-subtitles' || request.cancelled) continue;
    return {
      requestId: Number(requestId),
      summaryOperationId: request.summaryOperationId ?? null,
    };
  }

  return null;
}

export const useHighlightWorkflowStore = createWithEqualityFn<
  State & Actions
>()(
  immer((set, get) => ({
    ...initialRuntime,

    startWorkflow: ({
      requiresTranscription,
      transcriptionOperationId,
      sourceKey,
    }) => {
      let nextRunToken = 0;
      set(state => {
        state.runToken += 1;
        nextRunToken = state.runToken;
        state.running = true;
        state.requiresTranscription = requiresTranscription;
        state.transcriptionOperationId = transcriptionOperationId;
        state.summaryStarted = false;
        state.awaitingSummaryStart = false;
        state.isCancelling = false;
        state.requestId = null;
        state.sourceKey = sourceKey;
      });
      return nextRunToken;
    },

    setAwaitingSummaryStart: requestId =>
      set(state => {
        if (!state.running) return;
        state.requestId = requestId;
        state.awaitingSummaryStart = true;
        state.summaryStarted = false;
      }),

    resetRuntime: () =>
      set(state => {
        Object.assign(state, {
          ...initialRuntime,
          runToken: state.runToken,
        });
      }),

    cancelActiveWorkflow: async () => {
      const { running, isCancelling, requestId, transcriptionOperationId } =
        get();
      if (!running || isCancelling) return;

      set(state => {
        state.isCancelling = true;
        state.runToken += 1;
      });

      const readClaimedRequest = () =>
        requestId == null
          ? null
          : useHighlightGenerationRequestStore
              .getState()
              .getClaimedRequest(requestId);
      const claimedBeforeCancel = readClaimedRequest();

      const tryCancelOperation = async (
        operationId: string,
        kind: 'transcription' | 'summary'
      ): Promise<boolean> => {
        try {
          const result = await OperationIPC.cancel(operationId);
          if (result?.success === true) {
            return true;
          }
          console.error(
            `[highlight-workflow-store] ${kind} cancel was refused for ${operationId}: ${result?.error || result?.message || 'unknown error'}`
          );
          return false;
        } catch (error) {
          console.error(
            `[highlight-workflow-store] Failed to cancel ${kind} operation ${operationId}:`,
            error
          );
          return false;
        }
      };

      const getLiveOwnedSummaryOperationId = (): string | null => {
        const claimedRequest = readClaimedRequest();
        const summaryOperationId =
          claimedRequest?.summaryOperationId ??
          claimedBeforeCancel?.summaryOperationId ??
          null;
        if (!summaryOperationId) return null;

        const liveSummary = useTaskStore.getState().summary;
        if (!liveSummary.inProgress || liveSummary.id !== summaryOperationId) {
          return null;
        }
        return summaryOperationId;
      };

      try {
        const liveTranscription = useTaskStore.getState().transcription;
        const hasLiveOwnedTranscription =
          Boolean(transcriptionOperationId) &&
          liveTranscription.inProgress &&
          liveTranscription.id === transcriptionOperationId;
        const transcriptionCancelled = hasLiveOwnedTranscription
          ? await tryCancelOperation(transcriptionOperationId!, 'transcription')
          : true;

        let liveOwnedSummaryOperationId = getLiveOwnedSummaryOperationId();
        let summaryCancelled = true;
        if (liveOwnedSummaryOperationId) {
          summaryCancelled = await tryCancelOperation(
            liveOwnedSummaryOperationId,
            'summary'
          );
        } else {
          await Promise.resolve();
          liveOwnedSummaryOperationId = getLiveOwnedSummaryOperationId();
          if (liveOwnedSummaryOperationId) {
            summaryCancelled = await tryCancelOperation(
              liveOwnedSummaryOperationId,
              'summary'
            );
          }
        }

        const shouldCancelRequestBookkeeping =
          requestId != null && transcriptionCancelled && summaryCancelled;
        if (shouldCancelRequestBookkeeping) {
          useHighlightGenerationRequestStore
            .getState()
            .cancelRequest(requestId);
        }
      } finally {
        set(state => {
          state.isCancelling = false;
        });
        get().reconcileRuntime();
      }
    },

    reconcileRuntime: () => {
      const liveTranscription = useTaskStore.getState().transcription;
      const liveSummary = useTaskStore.getState().summary;
      const requestState = useHighlightGenerationRequestStore.getState();
      const runtime = get();

      const reconstructedRequest = findActiveGenerateSubtitlesRequestId();
      const effectiveRequestId =
        runtime.requestId ?? reconstructedRequest?.requestId ?? null;
      const claimedRequest =
        effectiveRequestId == null
          ? null
          : requestState.getClaimedRequest(effectiveRequestId);
      const summaryOperationId =
        claimedRequest?.summaryOperationId ??
        reconstructedRequest?.summaryOperationId ??
        null;
      const requestActive =
        effectiveRequestId != null
          ? requestState.isRequestActive(effectiveRequestId)
          : false;
      const requestSettled =
        effectiveRequestId != null
          ? requestState.isRequestSettled(effectiveRequestId)
          : true;

      const activeHighlightTranscriptionId =
        runtime.transcriptionOperationId &&
        liveTranscription.inProgress &&
        liveTranscription.workflowOwner === 'highlight' &&
        liveTranscription.id === runtime.transcriptionOperationId
          ? runtime.transcriptionOperationId
          : !runtime.running &&
              liveTranscription.inProgress &&
              liveTranscription.workflowOwner === 'highlight' &&
              liveTranscription.id
            ? liveTranscription.id
            : null;

      const highlightTranscriptionActive = Boolean(
        activeHighlightTranscriptionId
      );
      const highlightSummaryActive =
        Boolean(summaryOperationId) &&
        liveSummary.inProgress &&
        liveSummary.id === summaryOperationId;

      const shouldRemainRunning =
        highlightTranscriptionActive ||
        requestActive ||
        highlightSummaryActive ||
        (runtime.isCancelling && effectiveRequestId != null && !requestSettled);

      if (!shouldRemainRunning) {
        set(state => {
          Object.assign(state, {
            ...initialRuntime,
            runToken: state.runToken,
          });
        });
        return;
      }

      set(state => {
        state.running = true;
        state.requiresTranscription =
          state.requiresTranscription || highlightTranscriptionActive;
        state.transcriptionOperationId =
          activeHighlightTranscriptionId ?? state.transcriptionOperationId;
        state.requestId = effectiveRequestId;
        state.summaryStarted = Boolean(summaryOperationId);
        state.awaitingSummaryStart = requestActive && !summaryOperationId;
      });
    },
  }))
);
