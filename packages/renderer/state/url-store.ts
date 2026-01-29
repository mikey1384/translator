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
  cookiesBrowser: string; // 'auto' | 'chrome' | 'safari' | 'firefox' | 'edge'
  cookieBannerSuppressed: boolean;
  setUrlInput: (urlInput: string) => void;
  setDownloadQuality: (downloadQuality: VideoQuality) => void;
  clearError: () => void;
  setError: (msg: string) => void;
  downloadMedia: () => Promise<ProcessUrlResult | void>;
  setDownload: (patch: Partial<DownloadTask>) => void;
  setInputMode: (mode: 'url' | 'file') => void;
  setNeedCookies: (v: boolean) => void;
  setCookiesBrowser: (v: string) => void;
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
    cookiesBrowser: '',
    cookieBannerSuppressed: false,

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
      set({ needCookies: false, cookieBannerSuppressed: false });
      return downloadMediaInternal(set, get);
    },

    retryWithCookies: async () => {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download = { ...initialDownload, percent: 1 };
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

    setCookiesBrowser: v => set({ cookiesBrowser: v }),

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
          if (!state.cookieBannerSuppressed) {
            state.needCookies = true;
            state.download.inProgress = false;
            state.download.stage = 'NeedCookies';
            state.download.percent = 100;
          }
        });
        return;
      }
      if (stage === 'Completed' || stage === 'Error' || stage === 'Cancelled') {
        set(state => {
          state.needCookies = false;
          if (stage === 'Cancelled') state.cookieBannerSuppressed = true;
          if (stage === 'Cancelled') state.error = null;
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
  let cookiesBrowser = get().cookiesBrowser;
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
    if (p.stage === 'NeedCookies') {
      set((state: UrlState) => {
        state.needCookies = true;
        state.download.inProgress = false;
        state.download.stage = 'NeedCookies';
      });
      return;
    }
    if (p.stage === 'Cancelled') {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        state.download.stage = 'Cancelled';
        state.download.percent = 100;
      });
      return;
    }
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
    const shouldUseCookies = opts.useCookies === true;
    // Load persisted browser preference for UI, but do not force cookies unless explicitly requested
    try {
      const preferred = await (
        window as any
      ).electron.getPreferredCookiesBrowser();
      if (preferred && typeof preferred === 'string' && preferred !== 'auto') {
        if (!cookiesBrowser) {
          cookiesBrowser = preferred;
          set((state: UrlState) => {
            state.cookiesBrowser = preferred;
          });
        }
      }
    } catch {
      // ignore preference errors
    }
    if (shouldUseCookies && !cookiesBrowser) {
      try {
        cookiesBrowser = await (
          window as any
        ).electron.getDefaultCookieBrowser?.();
      } catch {
        // ignore default failures
      }
    }
    const res = await UrlIPC.download({
      url: urlInput,
      quality: downloadQuality,
      operationId: opId,
      useCookies: shouldUseCookies,
      cookiesBrowser,
    });

    const cookiesBrowserUsed =
      (res as any)?.cookiesBrowserUsed &&
      typeof (res as any).cookiesBrowserUsed === 'string'
        ? ((res as any).cookiesBrowserUsed as string)
        : '';
    if (cookiesBrowserUsed) {
      cookiesBrowser = cookiesBrowserUsed;
      set((state: UrlState) => {
        state.cookiesBrowser = cookiesBrowserUsed;
      });
    }

    const finalPath = res.videoPath ?? res.filePath;
    const filename = res.filename;

    if (res.cancelled || !finalPath || !filename) {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        // Preserve NeedCookies stage if backend returned that special case
        if (res.error === 'NeedCookies') {
          state.needCookies = true;
          state.download.stage = 'NeedCookies';
        } else {
          state.download.stage = res.cancelled ? 'Cancelled' : 'Error';
        }
        state.download.percent = 100;
        if (res.cancelled) state.error = null;
        else if (res.error === 'NeedCookies')
          state.error = null; // banner handles it
        else state.error = res.error || 'Failed to process URL';
        if (res.cancelled) state.cookieBannerSuppressed = true;
      });
      return res;
    }

    const { order: existingSubs, origin: subsOrigin } = useSubStore.getState();
    const preserveMountedDiskSubs =
      existingSubs.length > 0 && subsOrigin === 'disk';

    await useVideoStore
      .getState()
      .setFile({ path: finalPath!, name: filename! });

    if (!preserveMountedDiskSubs) {
      useSubStore.getState().load([]);
    }

    set((state: UrlState) => {
      state.download.stage = 'Completed';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
    // Persist cookie browser preference if we used cookies for this run
    try {
      if (opts.useCookies) {
        const currentBrowser = get().cookiesBrowser || cookiesBrowser;
        if (currentBrowser) {
          await (window as any).electron.setPreferredCookiesBrowser(
            currentBrowser
          );
        }
      }
    } catch {
      // ignore persistence errors
    }
    set((state: UrlState) => {
      state.urlInput = '';
    });
    return res;
  } catch (err: any) {
    const { needCookies } = get();
    if (needCookies) {
      // Do not mark as error; show cookies banner and stop the spinner
      set((state: UrlState) => {
        state.download.inProgress = false;
        if (!state.cookieBannerSuppressed) state.download.stage = 'NeedCookies';
      });
    } else {
      set((state: UrlState) => {
        state.error = err.message || String(err);
        state.download.stage = 'Error';
        state.download.percent = 100;
        state.download.inProgress = false;
      });
    }
  } finally {
    offProgress();
  }
}
