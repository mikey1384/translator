import type {
  ProcessUrlOptions,
  UrlProgressCallback,
  ProcessUrlResult,
} from '@shared-types/app';

export function download<
  T extends ProcessUrlOptions,
>(options: T): Promise<ProcessUrlResult> {
  return window.electron.processUrl(options);
}

export const downloadUrl = (o: ProcessUrlOptions) => download(o);

export function onProgress(callback: UrlProgressCallback): () => void {
  return window.electron.onProcessUrlProgress(callback);
}
