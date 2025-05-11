import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { VideoQuality, ProcessUrlResult } from '@shared-types/app';
import * as UrlIPC from '../ipc/url';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';
import { STARTING_STAGE } from '../../shared/constants';

type DownloadTask = {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
};

interface UrlState {
  cancellingDownload: boolean;
  urlInput: string;
  downloadQuality: VideoQuality;
  download: DownloadTask;
  error: string | null;
  inputMode: 'url' | 'file';
  setUrlInput: (urlInput: string) => void;
  setDownloadQuality: (downloadQuality: VideoQuality) => void;
  clearError: () => void;
  setError: (msg: string) => void;
  downloadMedia: () => Promise<ProcessUrlResult | void>;
  setDownload: (patch: Partial<DownloadTask>) => void;
  setCancellingDownload: (cancellingDownload: boolean) => void;
  setInputMode: (mode: 'url' | 'file') => void;
  onDownloadProgress: ({
    percent,
    stage,
    operationId,
  }: {
    percent: number;
    stage: string;
    operationId: string;
  }) => void;
}

const initialDownload: DownloadTask = {
  id: null,
  stage: '',
  percent: 0,
  inProgress: false,
};

export const useUrlStore = create<UrlState>()(
  immer((set, get) => ({
    urlInput: '',
    cancellingDownload: false as boolean,
    downloadQuality: 'mid' as VideoQuality,
    download: initialDownload,
    error: null,
    inputMode: 'url',

    setUrlInput: urlInput => {
      set(state => {
        state.error = null;
        state.urlInput = urlInput;
      });
    },
    setDownloadQuality: downloadQuality => set({ downloadQuality }),
    clearError: () => set({ error: null }),
    setError: msg => set({ error: msg }),

    async downloadMedia() {
      const { urlInput, downloadQuality } = get();
      if (!urlInput.trim()) {
        set({ error: 'Please enter a valid URL' });
        return;
      }

      const opId = `download-${Date.now()}`;
      set(state => {
        state.download = {
          id: opId,
          stage: STARTING_STAGE,
          percent: 0,
          inProgress: true,
        };
        state.error = null;
      });

      const offProgress = UrlIPC.onProgress(p => {
        if (p.operationId !== opId) return;
        set(state => {
          state.download.percent = p.percent ?? 0;
          state.download.stage = p.stage ?? '';
          state.download.inProgress = (p.percent ?? 0) < 100 && !p.error;
        });
        if (p.error) set({ error: `Download error: ${p.error}` });
      });

      try {
        const res = await UrlIPC.download({
          url: urlInput,
          quality: downloadQuality,
          operationId: opId,
        });

        const finalPath = res.videoPath ?? res.filePath;
        const filename = res.filename;

        if (res.cancelled || !finalPath || !filename) {
          set(state => {
            state.download.inProgress = false;
            state.download.stage = res.cancelled ? 'Cancelled' : 'Error';
            state.download.percent = 100;
            if (!res.cancelled)
              state.error = res.error || 'Failed to process URL';
          });
          return res;
        }

        await useVideoStore
          .getState()
          .setFile({ path: finalPath!, name: filename! });
        useSubStore.getState().load([]);

        set(state => {
          state.download.stage = 'Completed';
          state.download.percent = 100;
          state.download.inProgress = false;
        });
        set({ urlInput: '' });
        return res;
      } catch (err: any) {
        set(state => {
          state.error = err.message || String(err);
          state.download.stage = 'Error';
          state.download.percent = 100;
          state.download.inProgress = false;
        });
      } finally {
        offProgress();
      }
    },

    setCancellingDownload: cancellingDownload => set({ cancellingDownload }),

    setDownload: patch =>
      set(s => {
        Object.assign(s.download, patch);
      }),

    setInputMode: mode => set({ inputMode: mode }),

    onDownloadProgress: ({
      percent,
      stage,
      operationId,
    }: {
      percent: number;
      stage: string;
      operationId: string;
    }) => {
      console.log('[url-store] download progress', { percent, stage });
      useUrlStore.getState().setDownload({
        percent,
        stage,
        inProgress: percent < 100,
        id: operationId,
      });
    },
  }))
);
