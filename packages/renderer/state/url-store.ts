import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VideoQuality, ProcessUrlResult } from '@shared-types/app';
import * as UrlIPC from '@ipc/url';
import { i18n } from '../i18n';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';

const SAVED_QUALITY_KEY = 'savedDownloadQuality';

type DownloadTask = {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
};

interface UrlState {
  urlInput: string;
  downloadQuality: VideoQuality;
  download: DownloadTask;
  error: string | null;
  inputMode: 'url' | 'file';
  needCookies: boolean;
  setUrlInput: (urlInput: string) => void;
  setDownloadQuality: (downloadQuality: VideoQuality) => void;
  clearError: () => void;
  setError: (msg: string) => void;
  downloadMedia: () => Promise<ProcessUrlResult | void>;
  setDownload: (patch: Partial<DownloadTask>) => void;
  setInputMode: (mode: 'url' | 'file') => void;
  setNeedCookies: (v: boolean) => void;
  retryWithCookies: () => Promise<ProcessUrlResult | void>;
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
  immer<UrlState>((set, get) => ({
    urlInput: '',
    downloadQuality:
      (localStorage.getItem(SAVED_QUALITY_KEY) as VideoQuality) ?? 'mid',
    download: initialDownload,
    error: null as string | null,
    inputMode: 'url',
    needCookies: false,

    setUrlInput: urlInput => {
      set(state => {
        state.error = null;
        state.urlInput = urlInput;
      });
    },
    setDownloadQuality: downloadQuality => {
      localStorage.setItem(SAVED_QUALITY_KEY, downloadQuality);
      set({ downloadQuality });
    },
    clearError: () => set({ error: null }),
    setError: msg => set({ error: msg }),

    async downloadMedia() {
      set({ needCookies: false });
      return downloadMediaInternal(set, get);
    },

    retryWithCookies: async () => {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download = initialDownload;
        state.download.percent = 1;
        state.error = null;
      });
      return downloadMediaInternal(set, get, { useCookies: true });
    },

    setDownload: patch =>
      set(s => {
        Object.assign(s.download, patch);
      }),

    setInputMode: mode => set({ inputMode: mode }),

    setNeedCookies: v => set({ needCookies: v }),

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
      if (stage === 'NeedCookies') {
        set(state => {
          state.needCookies = true;
        });
        return;
      }
      if (stage === 'Completed' || stage === 'Error') {
        set(state => {
          state.needCookies = false;
        });
      }
      set(state => {
        state.download.percent = percent;
        state.download.stage = stage;
        state.download.inProgress = percent < 100;
        state.download.id = operationId;
      });
    },
  }))
);

async function downloadMediaInternal(
  set: any,
  get: any,
  opts: { useCookies?: boolean } = {}
): Promise<ProcessUrlResult | void> {
  const { urlInput, downloadQuality } = get();
  if (!urlInput.trim()) {
    set((state: UrlState) => {
      state.error = 'Please enter a valid URL';
    });
    return;
  }

  const opId = `download-${Date.now()}`;
  set((state: UrlState) => {
    state.download = {
      id: opId,
      stage: i18n.t('input.downloading'),
      percent: 0,
      inProgress: true,
    };
    state.error = null;
  });

  const offProgress = UrlIPC.onProgress(p => {
    if (p.operationId !== opId) return;
    if (p.stage === 'NeedCookies') return;
    set((state: UrlState) => {
      state.download.percent = p.percent ?? 0;
      state.download.stage = p.stage ?? '';
      state.download.inProgress = (p.percent ?? 0) < 100 && !p.error;
    });
    if (p.error)
      set((state: UrlState) => {
        state.error = `Download error: ${p.error}`;
      });
  });

  try {
    const res = await UrlIPC.download({
      url: urlInput,
      quality: downloadQuality,
      operationId: opId,
      useCookies: opts.useCookies ?? false,
    });

    const finalPath = res.videoPath ?? res.filePath;
    const filename = res.filename;

    if (res.cancelled || !finalPath || !filename) {
      set((state: UrlState) => {
        state.download.inProgress = false;
        state.download.stage = res.cancelled ? 'Cancelled' : 'Error';
        state.download.percent = 100;
        if (!res.cancelled) state.error = res.error || 'Failed to process URL';
      });
      return res;
    }

    await useVideoStore
      .getState()
      .setFile({ path: finalPath!, name: filename! });
    useSubStore.getState().load([]);

    set((state: UrlState) => {
      state.download.stage = 'Completed';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
    set((state: UrlState) => {
      state.urlInput = '';
    });
    return res;
  } catch (err: any) {
    set((state: UrlState) => {
      state.error = err.message || String(err);
      state.download.stage = 'Error';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
  } finally {
    offProgress();
  }
}
