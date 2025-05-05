import type {
  ProcessUrlOptions,
  UrlProgressCallback,
  ProcessUrlResult,
  CancelOperationResult,
} from '@shared-types/app';

export function process(options: ProcessUrlOptions): Promise<ProcessUrlResult> {
  return window.electron.processUrl(options);
}

export function cancel(operationId: string): Promise<CancelOperationResult> {
  return window.electron.cancelOperation(operationId);
}

export function onProgress(callback: UrlProgressCallback): () => void {
  return window.electron.onProcessUrlProgress(callback);
}
