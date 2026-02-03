import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VideoQuality, ProcessUrlResult } from '@shared-types/app';
import * as UrlIPC from '@ipc/url';
import { i18n } from '../i18n';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';

const SAVED_QUALITY_KEY = 'savedDownloadQuality';
const QUALITY_VALUES: VideoQuality[] = [
  'high',
  'mid',
  'low',
  '4320p',
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '480p',
  '360p',
  '240p',
];
const getInitialQuality = (): VideoQuality => {
  const stored = localStorage.getItem(SAVED_QUALITY_KEY);
  if (stored && QUALITY_VALUES.includes(stored as VideoQuality)) {
    return stored as VideoQuality;
  }
  return '1080p';
};

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
    downloadQuality: getInitialQuality(),
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

    setDownload: patch =>
      set(s => {
        Object.assign(s.download, patch);
      }),

    setInputMode: mode => set({ inputMode: mode }),
    setNeedCookies: v => set({ needCookies: v }),
  }))
);

async function downloadMediaInternal(
  set: any,
  get: any
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
    // Only allow this listener to update state for the currently active download.
    // Without this, a late Cancelled event from a previous download can overwrite
    // a new download's state if the user cancels + retries quickly.
    if (get().download.id !== opId) return;
    // Ignore late events after user-initiated cancel.
    if (get().download.stage === 'Cancelled') return;
    if (p.stage === 'NeedCookies') {
      set((state: UrlState) => {
        state.needCookies = true;
        state.download.inProgress = false;
        state.download.stage = 'NeedCookies';
        state.download.percent = 100;
        state.error = null;
      });
      return;
    }
    if (p.stage === 'Cancelled') {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        state.download.stage = 'Cancelled';
        state.download.percent = 100;
        state.error = null;
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
    const res = await UrlIPC.download({
      url: urlInput,
      quality: downloadQuality,
      operationId: opId,
    });

    // User cancellation should always win, even if the backend eventually
    // resolves as NeedCookies (race between cancel and captcha detection).
    const current = get().download;
    if (current.id !== opId || current.stage === 'Cancelled') {
      return res;
    }

    const finalPath = res.videoPath ?? res.filePath;
    const filename = res.filename;

    if (res.cancelled || !finalPath || !filename) {
      set((state: UrlState) => {
        state.needCookies = res.error === 'NeedCookies';
        state.download.inProgress = false;
        if (res.error === 'NeedCookies') state.download.stage = 'NeedCookies';
        else state.download.stage = res.cancelled ? 'Cancelled' : 'Error';
        state.download.percent = 100;
        if (res.cancelled) {
          state.needCookies = false;
          state.error = null;
        } else if (res.error === 'NeedCookies') {
          state.error = null;
        } else {
          state.needCookies = false;
          state.error = res.error || 'Failed to process URL';
        }
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
      state.needCookies = false;
      state.download.stage = 'Completed';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
    set((state: UrlState) => {
      state.urlInput = '';
    });
    return res;
  } catch (err: any) {
    const current = get().download;
    if (current.id !== opId || current.stage === 'Cancelled') {
      return;
    }

    set((state: UrlState) => {
      state.needCookies = err?.message === 'NeedCookies';
      state.error =
        err?.message === 'NeedCookies' ? null : err?.message || String(err);
      state.download.stage =
        err?.message === 'NeedCookies' ? 'NeedCookies' : 'Error';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
  } finally {
    offProgress();
  }
}
