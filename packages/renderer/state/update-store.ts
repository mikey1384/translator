import { create } from 'zustand';
import * as UpdateIPC from '@ipc/update';

interface UpdateState {
  available: boolean;
  downloading: boolean;
  percent: number;
  downloaded: boolean;
  error?: string;
  updateInfo?: any;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  cleanup: () => void;
}

export const useUpdateStore = create<UpdateState>(set => {
  const unsubAvailable = UpdateIPC.onUpdateAvailable(info => {
    set({ available: true, updateInfo: info, error: undefined });
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
    error: undefined,
    updateInfo: undefined,

    check: async () => {
      try {
        await UpdateIPC.checkForUpdates();
      } catch (err: any) {
        set({ error: err.message || 'Failed to check for updates' });
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
      try {
        await UpdateIPC.installUpdate();
      } catch (err: any) {
        set({ error: err.message || 'Failed to install update' });
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
