import { useAiStore } from '../state/ai-store';
import { hasApiKeyModeActiveCoverage } from '../state/byo-runtime';

const stage5CreditRefreshOperations = new Map<string, boolean>();

export function isCreditRefreshableOperation(operationId: string): boolean {
  return (
    operationId.startsWith('translate-') ||
    operationId.startsWith('transcribe-') ||
    operationId.startsWith('dub-')
  );
}

function shouldSkipStage5CreditRefresh(): boolean {
  try {
    return hasApiKeyModeActiveCoverage(useAiStore.getState());
  } catch {
    return false;
  }
}

export function registerStage5CreditRefreshOperation(
  operationId?: string | null
): void {
  if (!operationId || !isCreditRefreshableOperation(operationId)) {
    return;
  }

  stage5CreditRefreshOperations.set(
    operationId,
    !shouldSkipStage5CreditRefresh()
  );
}

export function shouldRefreshStage5CreditsForOperation(
  operationId?: string | null
): boolean {
  if (!operationId || !isCreditRefreshableOperation(operationId)) {
    return false;
  }

  const pinned = stage5CreditRefreshOperations.get(operationId);
  if (typeof pinned === 'boolean') {
    return pinned;
  }

  const shouldRefresh = !shouldSkipStage5CreditRefresh();
  stage5CreditRefreshOperations.set(operationId, shouldRefresh);
  return shouldRefresh;
}
