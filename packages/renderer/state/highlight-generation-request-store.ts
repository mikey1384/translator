import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

export type HighlightGenerationRequestSource =
  | 'generate-subtitles'
  | 'summary-panel';

export interface HighlightGenerationRequest {
  id: number;
  source: HighlightGenerationRequestSource;
  ownerKey: string | null;
}

export interface ClaimedHighlightGenerationRequest extends HighlightGenerationRequest {
  summaryOperationId: string | null;
  cancelled: boolean;
}

interface State {
  nextRequestId: number;
  pendingRequests: Record<
    number,
    {
      source: HighlightGenerationRequestSource;
      ownerKey: string | null;
    }
  >;
  claimedRequests: Record<
    number,
    {
      source: HighlightGenerationRequestSource;
      ownerKey: string | null;
      summaryOperationId: string | null;
      cancelled: boolean;
    }
  >;
}

interface Actions {
  requestHighlights(
    source: HighlightGenerationRequestSource,
    options?: { ownerKey?: string | null }
  ): number;
  claimPendingRequest(options?: {
    expectedRequestId?: number;
    expectedSource?: HighlightGenerationRequestSource | null;
    expectedOwnerKey?: string | null;
  }): HighlightGenerationRequest | null;
  getClaimedRequest(
    requestId: number
  ): ClaimedHighlightGenerationRequest | null;
  attachSummaryOperation(requestId: number, operationId: string): void;
  isRequestActive(requestId: number): boolean;
  isRequestSettled(requestId: number): boolean;
  completeClaimedRequest(requestId: number): void;
  cancelRequest(requestId: number): void;
  clearPendingRequest(expectedRequestId?: number): void;
}

function requestMatchesTarget(
  request: {
    source: HighlightGenerationRequestSource;
    ownerKey: string | null;
  },
  source: HighlightGenerationRequestSource,
  ownerKey: string | null
): boolean {
  if (ownerKey != null) {
    return request.ownerKey === ownerKey;
  }

  return request.source === source;
}

function findActiveRequestId(
  state: State,
  source: HighlightGenerationRequestSource,
  ownerKey: string | null
): number | null {
  for (const [requestId, pending] of Object.entries(state.pendingRequests)) {
    if (!requestMatchesTarget(pending, source, ownerKey)) continue;
    return Number(requestId);
  }

  for (const [requestId, claimed] of Object.entries(state.claimedRequests)) {
    if (claimed.cancelled) continue;
    if (!requestMatchesTarget(claimed, source, ownerKey)) continue;
    return Number(requestId);
  }

  return null;
}

function findPendingRequestId(
  state: State,
  options?: {
    expectedRequestId?: number;
    expectedSource?: HighlightGenerationRequestSource | null;
    expectedOwnerKey?: string | null;
  }
): number | null {
  for (const [requestId, pending] of Object.entries(state.pendingRequests)) {
    const numericRequestId = Number(requestId);
    if (
      options?.expectedRequestId != null &&
      options.expectedRequestId !== numericRequestId
    ) {
      continue;
    }
    if (
      options?.expectedSource != null &&
      options.expectedSource !== pending.source
    ) {
      continue;
    }
    if (
      options?.expectedOwnerKey != null &&
      options.expectedOwnerKey !== pending.ownerKey
    ) {
      continue;
    }
    return numericRequestId;
  }

  return null;
}

export const useHighlightGenerationRequestStore = createWithEqualityFn<
  State & Actions
>()(
  immer((set, get) => ({
    nextRequestId: 1,
    pendingRequests: {},
    claimedRequests: {},

    requestHighlights: (source, options) => {
      let requestId = 0;
      const ownerKey = options?.ownerKey ?? null;
      set(s => {
        const existingRequestId = findActiveRequestId(s, source, ownerKey);
        if (existingRequestId != null) {
          requestId = existingRequestId;
          return;
        }
        requestId = s.nextRequestId;
        s.nextRequestId += 1;
        s.pendingRequests[requestId] = {
          source,
          ownerKey,
        };
      });
      return requestId;
    },

    claimPendingRequest: options => {
      let claimed: HighlightGenerationRequest | null = null;
      set(s => {
        const pendingRequestId = findPendingRequestId(s, options);
        if (pendingRequestId == null) return;
        const pending = s.pendingRequests[pendingRequestId];
        if (!pending) return;

        claimed = {
          id: pendingRequestId,
          source: pending.source,
          ownerKey: pending.ownerKey ?? null,
        };
        s.claimedRequests[claimed.id] = {
          source: claimed.source,
          ownerKey: claimed.ownerKey,
          summaryOperationId: null,
          cancelled: false,
        };
        delete s.pendingRequests[pendingRequestId];
      });
      return claimed;
    },

    getClaimedRequest: requestId => {
      const state = get();
      const claimed = state.claimedRequests[requestId];
      if (!claimed) return null;
      return {
        id: requestId,
        source: claimed.source,
        ownerKey: claimed.ownerKey ?? null,
        summaryOperationId: claimed.summaryOperationId ?? null,
        cancelled: Boolean(claimed.cancelled),
      };
    },

    attachSummaryOperation: (requestId, operationId) =>
      set(s => {
        if (!s.claimedRequests[requestId]) return;
        s.claimedRequests[requestId].summaryOperationId = operationId;
      }),

    isRequestActive: requestId => {
      const state = get();
      const claimed = state.claimedRequests[requestId];
      return (
        Boolean(state.pendingRequests[requestId]) ||
        Boolean(claimed && !claimed.cancelled)
      );
    },

    isRequestSettled: requestId => {
      const state = get();
      return (
        !state.pendingRequests[requestId] && !state.claimedRequests[requestId]
      );
    },

    completeClaimedRequest: requestId =>
      set(s => {
        delete s.claimedRequests[requestId];
      }),

    cancelRequest: requestId =>
      set(s => {
        delete s.pendingRequests[requestId];
        if (s.claimedRequests[requestId]) {
          s.claimedRequests[requestId].cancelled = true;
        }
      }),

    clearPendingRequest: expectedRequestId =>
      set(s => {
        if (expectedRequestId != null) {
          delete s.pendingRequests[expectedRequestId];
          return;
        }

        for (const requestId of Object.keys(s.pendingRequests)) {
          delete s.pendingRequests[Number(requestId)];
        }
      }),
  }))
);
