import type { RenderCancelRequestResult } from '../../ipc/subtitles';

type MainCancellationResult = {
  success: boolean;
};

type MergeCancellationDependencies = {
  cancelMainOperation: (operationId: string) => Promise<MainCancellationResult>;
  cancelSubtitleRender: (
    operationId: string
  ) => Promise<RenderCancelRequestResult>;
};

const PRESET_ENCODING_OPERATION_SUFFIX = /-encode-\d+$/;

export function usesMainProcessMergeCancellation(operationId: string): boolean {
  return PRESET_ENCODING_OPERATION_SUFFIX.test(operationId);
}

export async function cancelMergeOperation(
  operationId: string,
  dependencies: MergeCancellationDependencies
): Promise<RenderCancelRequestResult> {
  if (!usesMainProcessMergeCancellation(operationId)) {
    return dependencies.cancelSubtitleRender(operationId);
  }

  const result = await dependencies.cancelMainOperation(operationId);
  return {
    accepted: result.success,
    reason: result.success ? 'accepted' : 'not_found',
  };
}
