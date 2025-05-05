import type { CancelOperationResult } from '@shared-types/app';

export function cancel(operationId: string): Promise<CancelOperationResult> {
  return window.electron.cancelOperation(operationId);
}
