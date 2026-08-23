export type TerminalProgressKind = 'completed' | 'cancelled' | 'failed';

interface RecentTerminalOperations {
  has(operationId: string): boolean;
  set(operationId: string, value: true): unknown;
}

const COMPLETION_STAGES = new Set([
  '__i18n__:completed',
  'completed',
  'processing complete',
  'dub generation complete',
]);

const CANCELLATION_STAGES = new Set([
  '__i18n__:process_cancelled',
  'cancelled',
  'canceled',
  'process cancelled',
  'process canceled',
]);

const FAILURE_STAGES = new Set(['__i18n__:error', 'error', 'failed']);

export function normalizeProgressStage(stage: unknown): string {
  return typeof stage === 'string' ? stage.trim().toLowerCase() : '';
}

export function classifyTerminalProgress({
  stage,
  percent,
  error,
  cancelled,
}: {
  stage?: unknown;
  percent?: unknown;
  error?: unknown;
  cancelled?: unknown;
}): TerminalProgressKind | null {
  const normalizedStage = normalizeProgressStage(stage);

  if (cancelled === true || CANCELLATION_STAGES.has(normalizedStage)) {
    return 'cancelled';
  }
  if (
    (typeof error === 'string' && error.trim().length > 0) ||
    FAILURE_STAGES.has(normalizedStage)
  ) {
    return 'failed';
  }
  if (
    (typeof percent === 'number' &&
      Number.isFinite(percent) &&
      percent >= 100) ||
    COMPLETION_STAGES.has(normalizedStage)
  ) {
    return 'completed';
  }

  return null;
}

/**
 * Accepts packets until an operation reaches its first terminal outcome.
 * Subsequent terminal duplicates and late nonterminal packets are ignored so
 * they cannot restart task state or repeat settlement work.
 */
export function acceptProgressOperation(
  terminalOperations: RecentTerminalOperations,
  operationId: string | null | undefined,
  terminalKind: TerminalProgressKind | null
): boolean {
  if (!operationId) return true;
  if (terminalOperations.has(operationId)) return false;
  if (terminalKind) terminalOperations.set(operationId, true);
  return true;
}

export function isHighlightProgressTerminalStage(stage: unknown): boolean {
  const normalizedStage = normalizeProgressStage(stage);
  return (
    normalizedStage === 'ready' ||
    normalizedStage === 'cancelled' ||
    normalizedStage === 'error'
  );
}

export function classifyHighlightProgressStage(
  stage: unknown
): 'ready' | 'cancelled' | 'error' | 'cutting' | null {
  const normalizedStage = normalizeProgressStage(stage);
  if (normalizedStage === 'ready') return 'ready';
  if (normalizedStage === 'cancelled') return 'cancelled';
  if (normalizedStage === 'error') return 'error';
  return normalizedStage ? 'cutting' : null;
}
