export interface PostInstallUpdateNotice {
  version: string;
  releaseName?: string;
  releaseDate?: string;
  notes: string;
}
export interface UpdateRequiredNotice {
  error: 'update-required';
  message: string;
  minVersion?: string;
  clientVersion?: string;
  downloadUrl?: string;
  source?: 'stage5-api' | 'relay' | 'unknown';
}

export function checkForUpdates(): Promise<any> {
  return window.electron.updateCheck();
}

export function downloadUpdate(): Promise<void> {
  return window.electron.updateDownload();
}

export function installUpdate(): Promise<void> {
  return window.electron.updateInstall();
}

export function getPostInstallNotice(): Promise<PostInstallUpdateNotice | null> {
  return window.electron.updateGetPostInstallNotice();
}

export function clearPostInstallNotice(version?: string): Promise<void> {
  return window.electron.updateClearPostInstallNotice(version);
}

export function getRequiredNotice(): Promise<UpdateRequiredNotice | null> {
  return window.electron.updateGetRequiredNotice();
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

export function onUpdateRequired(
  callback: (payload: UpdateRequiredNotice) => void
): () => void {
  return window.electron.onUpdateRequired(callback);
}
