export function checkForUpdates(): Promise<any> {
  return window.electron.updateCheck();
}

export function downloadUpdate(): Promise<void> {
  return window.electron.updateDownload();
}

export function installUpdate(): Promise<void> {
  return window.electron.updateInstall();
}

export function onUpdateAvailable(callback: (info: any) => void): () => void {
  return window.electron.onUpdateAvailable(callback);
}

export function onUpdateProgress(
  callback: (percent: number) => void
): () => void {
  return window.electron.onUpdateProgress(callback);
}

export function onUpdateDownloaded(callback: () => void): () => void {
  return window.electron.onUpdateDownloaded(callback);
}

export function onUpdateError(callback: (msg: string) => void): () => void {
  return window.electron.onUpdateError(callback);
}
