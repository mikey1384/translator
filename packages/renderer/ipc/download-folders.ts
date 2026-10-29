import type {
  DownloadFolderRequest,
  DownloadFolderResult,
} from '@shared-types/app';

export function downloadFolder(
  request: DownloadFolderRequest
): Promise<DownloadFolderResult> {
  return window.electron.downloadFolder(request);
}
export function onDownloadFoldersChanged(callback: () => void): () => void {
  return window.electron.onDownloadFoldersChanged(callback);
}
export function onPrivateLibraryPurge(
  callback: (payload: {
    id: string;
    paths: string[];
    sourceUrl?: string;
  }) => Promise<void>
): (() => void) | undefined {
  if (typeof window === 'undefined') return;
  return window.electron?.onPrivateLibraryPurge?.(callback);
}
