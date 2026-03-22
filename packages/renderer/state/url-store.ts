import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VideoQuality, ProcessUrlResult } from '@shared-types/app';
import * as UrlIPC from '@ipc/url';
import { i18n } from '../i18n';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';
import { useUIStore } from './ui-store';
import { openDownloadSwitchConfirm } from './modal-store';
import { upsertLocalVideoSuggestionHistoryItem } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import { mountedSubtitleMatchesVideoSource } from '../utils/subtitle-source-association';

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
  completedFilePath: string | null;
};

export type UrlErrorKind = 'validation' | 'operation' | 'unknown';

const VALIDATION_ERROR_HINTS: RegExp[] = [
  /\bplease enter a valid url\b/i,
  /\binvalid url\b/i,
  /\burl format appears invalid\b/i,
  /\bno srt file available\b/i,
  /\bno subtitles available\b/i,
];

const OPERATION_ERROR_HINT =
  /\b(error|failed|failure|fatal|exception|crash|panic|timeout|timed out)\b/i;

function inferErrorKind(message: string): UrlErrorKind {
  if (VALIDATION_ERROR_HINTS.some(re => re.test(message))) {
    return 'validation';
  }
  if (OPERATION_ERROR_HINT.test(message)) {
    return 'operation';
  }
  return 'unknown';
}

interface UrlState {
  urlInput: string;
  downloadQuality: VideoQuality;
  download: DownloadTask;
  error: string | null;
  errorKind: UrlErrorKind | null;
  inputMode: 'url' | 'file';
  needCookies: boolean;
  setUrlInput: (urlInput: string) => void;
  setDownloadQuality: (downloadQuality: VideoQuality) => void;
  clearError: () => void;
  setError: (msg: string, kind?: UrlErrorKind) => void;
  setValidationError: (msg: string) => void;
  setOperationError: (msg: string) => void;
  downloadMedia: (options?: {
    preserveSubtitles?: boolean;
    url?: string;
  }) => Promise<ProcessUrlResult | void>;
  setDownload: (patch: Partial<DownloadTask>) => void;
  setInputMode: (mode: 'url' | 'file') => void;
  setNeedCookies: (v: boolean) => void;
}

const initialDownload: DownloadTask = {
  id: null,
  stage: '',
  percent: 0,
  inProgress: false,
  completedFilePath: null,
};

export const useUrlStore = create<UrlState>()(
  immer<UrlState>((set, get) => ({
    urlInput: '',
    downloadQuality: getInitialQuality(),
    download: initialDownload,
    error: null as string | null,
    errorKind: null as UrlErrorKind | null,
    inputMode: 'url',
    needCookies: false,

    setUrlInput: urlInput => {
      set(state => {
        state.error = null;
        state.errorKind = null;
        state.urlInput = urlInput;
      });
    },
    setDownloadQuality: downloadQuality => {
      localStorage.setItem(SAVED_QUALITY_KEY, downloadQuality);
      set({ downloadQuality });
    },
    clearError: () => set({ error: null, errorKind: null }),
    setError: (msg, kind) =>
      set(state => {
        const text = String(msg || '').trim();
        const resolvedKind = text ? (kind ?? inferErrorKind(text)) : null;
        state.error = text || null;
        state.errorKind = resolvedKind;
      }),
    setValidationError: msg =>
      set(state => {
        const text = String(msg || '').trim();
        state.error = text || null;
        state.errorKind = text ? 'validation' : null;
      }),
    setOperationError: msg =>
      set(state => {
        const text = String(msg || '').trim();
        state.error = text || null;
        state.errorKind = text ? 'operation' : null;
      }),

    async downloadMedia(options) {
      set({ needCookies: false });
      return downloadMediaInternal(set, get, options);
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
  get: any,
  options?: { preserveSubtitles?: boolean; url?: string }
): Promise<ProcessUrlResult | void> {
  const { urlInput, downloadQuality } = get();
  const requestedUrl = String(options?.url ?? urlInput ?? '').trim();
  const preserveSubtitles = Boolean(options?.preserveSubtitles);
  const opId = `download-${Date.now()}`;
  let shouldDiscardPendingResult = false;
  const cancelledResult = (): ProcessUrlResult => ({
    success: false,
    cancelled: true,
    operationId: opId,
  });
  const discardProcessedUrl = async (): Promise<void> => {
    try {
      await UrlIPC.discardProcessedUrl(opId);
    } catch (error) {
      console.warn(
        `[url-store] Failed to discard processed URL result for ${opId}:`,
        error
      );
    }
  };
  const acceptProcessedUrl = async (): Promise<boolean> => {
    try {
      const result = await UrlIPC.acceptProcessedUrl(opId);
      if (!result.success) {
        console.warn(
          `[url-store] Processed URL result for ${opId} could not be accepted: ${result.error || 'unknown error'}`
        );
      }
      return result.success;
    } catch (error) {
      console.warn(
        `[url-store] Failed to accept processed URL result for ${opId}:`,
        error
      );
      return false;
    }
  };
  const cleanupAcceptedProcessedUrl = async (
    filePath: string
  ): Promise<void> => {
    try {
      const result = await UrlIPC.cleanupAcceptedProcessedUrl({
        operationId: opId,
        filePath,
      });
      if (!result.success) {
        console.warn(
          `[url-store] Accepted processed URL result for ${opId} could not be scheduled for cleanup: ${result.error || 'unknown error'}`
        );
      }
    } catch (error) {
      console.warn(
        `[url-store] Failed to schedule cleanup for accepted processed URL result ${opId}:`,
        error
      );
    }
  };
  const isCurrentDownloadCancelledOrStale = (): boolean => {
    const current = get().download;
    return current.id !== opId || current.stage === 'Cancelled';
  };
  const getMountedSourcePath = () => {
    const { originalPath, path } = useVideoStore.getState();
    const normalized = String(originalPath || path || '').trim();
    return normalized || null;
  };
  if (!requestedUrl) {
    set((state: UrlState) => {
      state.error = 'Please enter a valid URL';
      state.errorKind = 'validation';
    });
    return;
  }
  set((state: UrlState) => {
    state.download = {
      ...state.download,
      id: opId,
      stage: i18n.t('input.downloading'),
      percent: 0,
      inProgress: true,
    };
    state.urlInput = requestedUrl;
    state.error = null;
    state.errorKind = null;
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
        state.errorKind = null;
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
        state.errorKind = null;
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
        const message = `Download error: ${p.error}`;
        state.error = message;
        state.errorKind = inferErrorKind(message);
      });
  });

  try {
    const res = await UrlIPC.download({
      url: requestedUrl,
      quality: downloadQuality,
      operationId: opId,
    });

    // User cancellation should always win, even if the backend eventually
    // resolves as NeedCookies (race between cancel and captcha detection).
    if (isCurrentDownloadCancelledOrStale()) {
      if (res.success && (res.videoPath || res.filePath)) {
        await discardProcessedUrl();
      }
      return cancelledResult();
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
          state.errorKind = null;
        } else if (res.error === 'NeedCookies') {
          state.error = null;
          state.errorKind = null;
        } else {
          state.needCookies = false;
          const message = res.error || 'Failed to process URL';
          state.error = message;
          state.errorKind = inferErrorKind(message);
        }
      });
      return res;
    }

    const {
      order: existingSubs,
      origin: subsOrigin,
      libraryEntryId,
    } = useSubStore.getState();
    const preserveMountedDiskSubs =
      existingSubs.length > 0 && subsOrigin === 'disk' && !libraryEntryId;
    const hasMountedSource = Boolean(getMountedSourcePath());
    const shouldSwitchToDownloaded =
      !hasMountedSource || (await openDownloadSwitchConfirm());

    if (isCurrentDownloadCancelledOrStale()) {
      await discardProcessedUrl();
      return cancelledResult();
    }

    shouldDiscardPendingResult = true;
    const accepted = await acceptProcessedUrl();
    if (!accepted) {
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        state.download.stage = 'Cancelled';
        state.download.percent = 100;
        state.error = null;
        state.errorKind = null;
      });
      return cancelledResult();
    }
    shouldDiscardPendingResult = false;

    if (isCurrentDownloadCancelledOrStale()) {
      await cleanupAcceptedProcessedUrl(finalPath);
      return cancelledResult();
    }

    const derivedTitle =
      String(res.title || '').trim() ||
      String(filename || '')
        .replace(/\.[^/.]+$/, '')
        .trim() ||
      requestedUrl;
    upsertLocalVideoSuggestionHistoryItem({
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceUrl: requestedUrl,
      title: derivedTitle,
      thumbnailUrl: String(res.thumbnailUrl || '').trim() || undefined,
      channel: String(res.channel || '').trim() || undefined,
      channelUrl: String(res.channelUrl || '').trim() || undefined,
      durationSec:
        typeof res.durationSec === 'number' && Number.isFinite(res.durationSec)
          ? res.durationSec
          : undefined,
      uploadedAt: String(res.uploadedAt || '').trim() || undefined,
      downloadedAtIso: new Date().toISOString(),
      localPath: finalPath,
    });

    let mountErrorMessage: string | null = null;

    set((state: UrlState) => {
      state.needCookies = false;
      state.download.stage = 'Completed';
      state.download.percent = 100;
      state.download.inProgress = false;
      state.download.completedFilePath = finalPath;
      state.error = null;
      state.errorKind = null;
      state.urlInput = '';
    });

    if (shouldSwitchToDownloaded) {
      try {
        if (preserveSubtitles) {
          await useVideoStore.getState().mountFilePreserveSubs({
            path: finalPath,
            name: filename,
            sourceUrl: requestedUrl,
          });
        } else {
          await useVideoStore.getState().setFile(
            {
              path: finalPath,
              name: filename,
              sourceUrl: requestedUrl,
            },
            {
              skipStoredSubtitleAutoMount: preserveMountedDiskSubs,
            }
          );
        }

        if (!preserveSubtitles && !preserveMountedDiskSubs) {
          const autoMountedForCurrentVideo = mountedSubtitleMatchesVideoSource(
            useSubStore.getState(),
            {
              sourceVideoPath: finalPath,
              sourceVideoAssetIdentity:
                useVideoStore.getState().sourceAssetIdentity ?? null,
            }
          );
          if (!autoMountedForCurrentVideo) {
            useSubStore.getState().load([]);
          }
        }
        useUIStore.getState().setInputMode('file');
      } catch (err: any) {
        mountErrorMessage =
          err?.message ||
          'Downloaded file was saved but could not be opened automatically.';
      }
    }

    if (mountErrorMessage && get().download.id === opId) {
      set((state: UrlState) => {
        state.error = mountErrorMessage;
        state.errorKind = inferErrorKind(mountErrorMessage);
      });
    }

    return res;
  } catch (err: any) {
    if (shouldDiscardPendingResult) {
      await discardProcessedUrl();
    }
    if (isCurrentDownloadCancelledOrStale()) {
      return;
    }

    set((state: UrlState) => {
      state.needCookies = err?.message === 'NeedCookies';
      const message =
        err?.message === 'NeedCookies' ? null : err?.message || String(err);
      state.error = message;
      state.errorKind = message ? inferErrorKind(message) : null;
      state.download.stage =
        err?.message === 'NeedCookies' ? 'NeedCookies' : 'Error';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
  } finally {
    offProgress();
  }
}
