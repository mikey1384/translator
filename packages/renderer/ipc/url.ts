import type {
  ProcessUrlOptions,
  UrlProgressCallback,
  ProcessUrlResult,
} from '@shared-types/app';

export function process(options: ProcessUrlOptions): Promise<ProcessUrlResult> {
  return window.electron.processUrl(options);
}

export function onProgress(callback: UrlProgressCallback): () => void {
  return window.electron.onProcessUrlProgress(callback);
}
