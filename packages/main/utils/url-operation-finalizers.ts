import type { ProcessUrlResult } from '@shared-types/app';

type FinalizeCancelledUrlOperationOptions = {
  operationId: string;
  discardPendingUrlResult: (operationId: string) => Promise<unknown>;
  registryFinish: (operationId: string) => boolean;
};

export async function finalizeCancelledUrlOperation(
  options: FinalizeCancelledUrlOperationOptions
): Promise<ProcessUrlResult> {
  await options.discardPendingUrlResult(options.operationId);
  options.registryFinish(options.operationId);
  return {
    success: false,
    cancelled: true,
    operationId: options.operationId,
  };
}
