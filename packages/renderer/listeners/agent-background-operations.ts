export type AgentBackgroundProgress = {
  operationId?: string | null;
  percent?: number;
  stage?: string;
  error?: string;
};

type ProgressHandler = (progress: AgentBackgroundProgress) => void;
type AgentHistoryOperationKind = 'transcription' | 'translation' | 'merge';

const AGENT_HISTORY_OPERATION_PATTERN =
  /^agent-history:(transcription|translation|merge):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAgentHistoryOperationId(
  kind: AgentHistoryOperationKind
): string {
  return `agent-history:${kind}:${globalThis.crypto.randomUUID()}`;
}

export function isAgentHistoryOperationId(value: unknown): value is string {
  return (
    typeof value === 'string' && AGENT_HISTORY_OPERATION_PATTERN.test(value)
  );
}

/**
 * Routes progress for agent-owned, non-mounted jobs away from the global UI
 * progress listener. The reserved, fully structured operation identity keeps
 * trailing IPC packets classified without retaining an unbounded tombstone
 * set for every completed job.
 */
export class AgentBackgroundOperationRouter {
  private readonly activeHandlers = new Map<string, ProgressHandler>();

  register(operationId: string, handler: ProgressHandler): () => void {
    if (
      !isAgentHistoryOperationId(operationId) ||
      this.activeHandlers.has(operationId)
    ) {
      throw new Error(
        `Background agent operation identity is invalid or already active: ${operationId}`
      );
    }

    this.activeHandlers.set(operationId, handler);
    let active = true;

    return () => {
      if (!active) return;
      active = false;
      if (this.activeHandlers.get(operationId) === handler) {
        this.activeHandlers.delete(operationId);
      }
    };
  }

  route<T extends AgentBackgroundProgress>(progress: T): boolean {
    const operationId =
      typeof progress?.operationId === 'string' ? progress.operationId : '';
    if (!isAgentHistoryOperationId(operationId)) return false;

    try {
      this.activeHandlers.get(operationId)?.(progress);
    } catch {
      // Classification is the safety boundary. A progress observer failure
      // must not let this packet fall through and mutate mounted UI state.
    }
    return true;
  }

  isActive(operationId: string): boolean {
    return this.activeHandlers.has(operationId);
  }
}

export const agentBackgroundOperations = new AgentBackgroundOperationRouter();
