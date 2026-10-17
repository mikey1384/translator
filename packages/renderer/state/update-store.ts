import { create } from 'zustand';
import * as UpdateIPC from '@ipc/update';

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'none'
  | 'error';

interface UpdateState {
  available: boolean;
  downloading: boolean;
  percent: number;
  downloaded: boolean;
  installing: boolean;
  error?: string;
  updateInfo?: any;
  /** Result of the latest check, for screens that report it to the user. */
  checkStatus: UpdateCheckStatus;
  check: () => Promise<UpdateCheckStatus>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  cleanup: () => void;
}

export const useUpdateStore = create<UpdateState>(set => {
  const unsubAvailable = UpdateIPC.onUpdateAvailable(info => {
    set({
      available: true,
      updateInfo: info,
      error: undefined,
      checkStatus: 'available',
    });
  });

  const unsubProgress = UpdateIPC.onUpdateProgress(percent => {
    set({ downloading: true, percent });
  });

  const unsubDownloaded = UpdateIPC.onUpdateDownloaded(() => {
    set({ downloaded: true, downloading: false, percent: 100 });
  });

  const unsubError = UpdateIPC.onUpdateError(msg => {
    set({ error: msg, downloading: false });
  });

  // Clean up on hot reload during development
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    });
  }

  return {
    available: false,
    downloading: false,
    percent: 0,
    downloaded: false,
    installing: false,
    error: undefined,
    updateInfo: undefined,
    checkStatus: 'idle',

    check: async (): Promise<UpdateCheckStatus> => {
      // Avoid re-checking while a download is in progress or already downloaded
      const s = useUpdateStore.getState();
      if (s.downloading || s.downloaded) return 'available';
      set({ checkStatus: 'checking' });
      try {
        const result = await UpdateIPC.checkForUpdates();
        const status: UpdateCheckStatus =
          result?.available || useUpdateStore.getState().available
            ? 'available'
            : 'none';
        set({ checkStatus: status });
        return status;
      } catch (err: any) {
        set({
          error: err?.message || 'Failed to check for updates',
          checkStatus: 'error',
        });
        return 'error';
      }
    },

    download: async () => {
      try {
        set({ downloading: true, percent: 0, error: undefined });
        await UpdateIPC.downloadUpdate();
      } catch (err: any) {
        set({
          error: err.message || 'Failed to download update',
          downloading: false,
        });
      }
    },

    install: async () => {
      const s = useUpdateStore.getState();
      if (s.installing) return;

      try {
        set({ installing: true, error: undefined });
        await UpdateIPC.installUpdate();
      } catch (err: any) {
        set({
          installing: false,
          error: err.message || 'Failed to install update',
        });
      }
    },

    cleanup: () => {
      unsubAvailable();
      unsubProgress();
      unsubDownloaded();
      unsubError();
    },
  };
});
