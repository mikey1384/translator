import { useAiStore } from '../state/ai-store';
import { hasApiKeyModeActiveCoverage } from '../state/byo-runtime';
import * as SystemIPC from '../ipc/system';
import { BoundedRecentMap } from './bounded-recent-map';

const MAX_RECENT_CREDIT_REFRESH_OPERATIONS = 2048;
const stage5CreditRefreshOperations = new BoundedRecentMap<string, boolean>(
  MAX_RECENT_CREDIT_REFRESH_OPERATIONS
);

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

/**
 * Refresh the balance after a paid call that has no operation id of its own
 * (AI video search, the most expensive single action), so the pill and card
 * don't keep showing the pre-search balance. Skipped when API keys pay.
 */
export function refreshStage5CreditsAfterPaidCall(): void {
  if (shouldSkipStage5CreditRefresh()) return;
  void SystemIPC.refreshCreditSnapshot(true).catch(error => {
    console.warn('[credits] Balance refresh after a paid call failed:', error);
  });
}
