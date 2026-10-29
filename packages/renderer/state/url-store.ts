import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  ProcessUrlPendingResultAction,
  ProcessUrlResult,
  VideoQuality,
  VideoSuggestionDownloadHistoryItem,
  WebVideoSelection,
} from '@shared-types/app';
import * as UrlIPC from '@ipc/url';
import { i18n } from '../i18n';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';
import { useUIStore } from './ui-store';
import {
  closeChangeVideo,
  openDownloadSwitchConfirm,
  openLongDownloadConfirm,
  openUnsavedSrtConfirm,
} from './modal-store';
import {
  classifyVideoCollectionUrl,
  normalizeVideoUrlInput,
} from '../../shared/helpers/video-url.js';
import {
  readLocalVideoSuggestionHistory,
  rollbackLocalVideoSuggestionHistoryUpsert,
  upsertLocalVideoSuggestionHistoryItem,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import { mountedSubtitleMatchesVideoSource } from '../utils/subtitle-source-association';
import { confirmReplaceUnsavedSubtitles } from '../utils/unsaved-subtitles';
import { downloadKeepsFileOpenedSubtitles } from '../utils/sameVideo';
import { handoffPromotedDownloadHistory } from '../../shared/helpers/url-download-history-handoff.js';
import { parseSrt } from '../../shared/helpers';
import {
  didSaveSubtitleFile,
  saveCurrentSubtitles,
} from '../utils/saveSubtitles';
import { describeDownloadFailure } from '../utils/taskFailure';
import { historyCopiesForUrl } from '../utils/localDownloadCopy';
import { acquireProvisionalUrlDownloadLibraryPath } from '../listeners/mounted-download-leases.js';
import { shouldDiscoverWebVideo } from '../../shared/helpers/web-video.js';
import { chooseWebVideo } from './web-video-store';

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

export type DownloadRequest = {
  url: string;
  mountOnComplete: boolean;
  preserveSubtitles: boolean;
  replaceCurrent?: boolean;
  webVideo?: WebVideoSelection;
  webVideoId?: string;
  allowLongVideo?: boolean;
  interactive?: boolean;
};

/** Why a link was refused before downloading, in the UI language. */
export function sourceRejectionMessage(
  code: 'collection_url' | 'live_stream'
): string {
  return code === 'collection_url'
    ? i18n.t(
        'input.urlRejected.collection',
        'This is a channel or playlist link. Paste a link to a single video, or use Find videos.'
      )
    : i18n.t(
        'input.urlRejected.live',
        'This is a live stream. Translator can download it after the broadcast ends.'
      );
}

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
  /**
   * An agent batch is downloading videos one after another. Other downloads
   * wait for it: one started between two batch items would be replaced by
   * the batch's next download.
   */
  batchDownloadActive: boolean;
  setBatchDownloadActive: (active: boolean) => void;
  /** The last download started, so "Connect & retry" can repeat it exactly. */
  lastDownloadRequest: DownloadRequest | null;
  /** Set by the cookie banner; the workspace re-runs it with its auto-run chain. */
  cookieRetryRequest: { id: number; request: DownloadRequest } | null;
  requestCookieRetry: () => boolean;
  clearCookieRetryRequest: (id: number) => void;
  setUrlInput: (urlInput: string) => void;
  setDownloadQuality: (downloadQuality: VideoQuality) => void;
  clearError: () => void;
  setError: (msg: string, kind?: UrlErrorKind) => void;
  setValidationError: (msg: string) => void;
  setOperationError: (msg: string) => void;
  downloadMedia: (
    options?: DownloadMediaOptions
  ) => Promise<ProcessUrlResult | void>;
  setDownload: (patch: Partial<DownloadTask>) => void;
  setInputMode: (mode: 'url' | 'file') => void;
  setNeedCookies: (v: boolean) => void;
}

type DownloadMediaOptions = {
  mountOnComplete?: boolean;
  preserveSubtitles?: boolean;
  url?: string;
  /** Skip the long-video confirmation (the user already confirmed). */
  allowLongVideo?: boolean;
  /**
   * The user asked to replace the open video with this link (Change Video):
   * the finished download opens without asking "Watch now?".
   */
  replaceCurrent?: boolean;
  /** One video of an agent batch; the batch lock does not apply to it. */
  fromBatch?: boolean;
  /** Automated requests return an actionable failure instead of opening a browser or picker. */
  interactive?: boolean;
  webVideo?: WebVideoSelection;
  /** Re-download the same video from a saved multi-video page. */
  webVideoId?: string;
};

let cookieRetryRequestSeq = 0;

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
    batchDownloadActive: false,
    setBatchDownloadActive: active => set({ batchDownloadActive: active }),
    lastDownloadRequest: null,
    cookieRetryRequest: null,

    requestCookieRetry: () => {
      const request = get().lastDownloadRequest;
      if (!request) return false;
      cookieRetryRequestSeq += 1;
      set(state => {
        state.needCookies = false;
        state.cookieRetryRequest = { id: cookieRetryRequestSeq, request };
      });
      return true;
    },
    clearCookieRetryRequest: id =>
      set(state => {
        if (state.cookieRetryRequest?.id === id) {
          state.cookieRetryRequest = null;
        }
      }),

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
  options?: DownloadMediaOptions
): Promise<ProcessUrlResult | void> {
  const { urlInput, downloadQuality } = get();
  const rawUrl = String(options?.url ?? urlInput ?? '').trim();
  // Bare domains and links inside shared text become plain links; anything
  // else goes to main as typed and comes back as an invalid-URL error.
  const requestedUrl = normalizeVideoUrlInput(rawUrl) ?? rawUrl;
  const preserveSubtitles = Boolean(options?.preserveSubtitles);
  const fromBatch = options?.fromBatch === true;
  const mountOnComplete = options?.mountOnComplete !== false;
  const discoverPage = shouldDiscoverWebVideo(requestedUrl);
  let webVideo = options?.webVideo;
  let retainDiscovery = false;
  const opId = `download-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let shouldDiscardPendingResult = false;
  const cancelledResult = (): ProcessUrlResult => ({
    success: false,
    cancelled: true,
    operationId: opId,
  });
  const discoveryFailure = (message: string): ProcessUrlResult => {
    set((state: UrlState) => {
      state.error = message;
      state.errorKind = 'operation';
      state.download.inProgress = false;
      state.download.stage = 'Error';
      state.download.percent = 100;
    });
    return { success: false, error: message, operationId: opId };
  };
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
  const acceptProcessedUrl =
    async (): Promise<ProcessUrlPendingResultAction> => {
      try {
        const result = await UrlIPC.acceptProcessedUrl(opId);
        const acceptedPath = String(result.filePath || '').trim();
        if (!result.success || !acceptedPath) {
          console.warn(
            `[url-store] Processed URL result for ${opId} could not be accepted: ${result.error || 'unknown error'}`
          );
        }
        return result.success && acceptedPath
          ? { ...result, filePath: acceptedPath }
          : {
              success: false,
              error: result.error || 'Downloaded video could not be saved',
            };
      } catch (error) {
        console.warn(
          `[url-store] Failed to accept processed URL result for ${opId}:`,
          error
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Downloaded video could not be saved',
        };
      }
    };
  const cleanupAcceptedProcessedUrl = async (
    filePath: string
  ): Promise<boolean> => {
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
      return result.success;
    } catch (error) {
      console.warn(
        `[url-store] Failed to schedule cleanup for accepted processed URL result ${opId}:`,
        error
      );
      return false;
    }
  };
  const isCurrentDownloadCancelledOrStale = (): boolean => {
    const current = get().download;
    return current.id !== opId || current.stage === 'Cancelled';
  };
  const hasMountedVideo = () => {
    const { originalPath, path, url, file } = useVideoStore.getState();
    return Boolean(String(originalPath || path || url || '').trim() || file);
  };
  if (get().batchDownloadActive && !fromBatch) {
    set((state: UrlState) => {
      state.error = i18n.t(
        'input.batchDownloadRunning',
        'Translator is downloading several videos. Wait for them to finish, or cancel the download.'
      );
      state.errorKind = 'validation';
    });
    return { success: false, error: 'batch_running' };
  }
  if (!requestedUrl) {
    set((state: UrlState) => {
      state.error = i18n.t('errors.invalidUrl');
      state.errorKind = 'validation';
    });
    return;
  }
  if (classifyVideoCollectionUrl(requestedUrl)) {
    set((state: UrlState) => {
      state.urlInput = requestedUrl;
      state.error = sourceRejectionMessage('collection_url');
      state.errorKind = 'validation';
    });
    return {
      success: false,
      error: 'collection_url',
      rejection: { code: 'collection_url' },
    };
  }
  // Never fetch a video again while a copy of it is on this device: a
  // re-pasted link opens that copy (no second file, no orphaned download).
  if (mountOnComplete && !discoverPage) {
    const reused = await openExistingLocalCopy({
      requestedUrl,
      operationId: opId,
      preserveSubtitles,
      replaceCurrent: options?.replaceCurrent === true,
      webVideoId: options?.webVideoId,
      hasMountedSource: hasMountedVideo(),
    });
    if (reused) {
      set((state: UrlState) => {
        state.needCookies = false;
        state.error = null;
        state.errorKind = null;
        if (reused.success) state.urlInput = '';
      });
      return reused;
    }
  }
  set((state: UrlState) => {
    state.lastDownloadRequest = {
      url: requestedUrl,
      mountOnComplete,
      preserveSubtitles,
      replaceCurrent: options?.replaceCurrent === true,
      webVideoId: options?.webVideoId,
      webVideo,
      allowLongVideo: options?.allowLongVideo,
      interactive: options?.interactive,
    };
  });
  set((state: UrlState) => {
    state.download = {
      ...state.download,
      id: opId,
      stage: i18n.t('input.downloading'),
      percent: 0,
      inProgress: true,
    };
    if (!fromBatch) state.urlInput = requestedUrl;
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
        // Main's reason code, in the UI language.
        state.error = describeDownloadFailure({
          error: p.error,
          errorCode: p.errorCode,
        });
        state.errorKind = 'operation';
      });
  });

  try {
    if (discoverPage && !webVideo) {
      set((state: UrlState) => {
        state.download.stage = i18n.t(
          'input.webVideo.finding',
          'Finding videos…'
        );
      });
      const discovery = await UrlIPC.discoverWebVideo({
        url: requestedUrl,
        operationId: opId,
        interactive: options?.interactive !== false,
        labels: {
          title: i18n.t('input.webVideo.choose', 'Choose a video'),
          instruction: i18n.t(
            'input.webVideo.instruction',
            'Play the video you want to download.'
          ),
          starting: i18n.t(
            'progress.legacy.startingDownload',
            'Starting download…'
          ),
          choose: i18n.t('input.webVideo.choose', 'Choose a video'),
          cancel: i18n.t('common.cancel', 'Cancel'),
          live: sourceRejectionMessage('live_stream'),
          direction: i18n.dir() === 'rtl' ? 'rtl' : 'ltr',
          protected: i18n.t(
            'input.webVideo.protected',
            'This video is protected and cannot be downloaded.'
          ),
        },
      });
      if (isCurrentDownloadCancelledOrStale() || discovery.cancelled) {
        if (discovery.discoveryId)
          void UrlIPC.releaseWebVideoDiscovery(discovery.discoveryId);
        if (!isCurrentDownloadCancelledOrStale())
          set((state: UrlState) => {
            state.download.inProgress = false;
            state.download.stage = 'Cancelled';
            state.download.percent = 100;
          });
        return cancelledResult();
      }
      if (
        !discovery.success ||
        !discovery.discoveryId ||
        !discovery.candidates?.length
      ) {
        const code = discovery.errorCode || 'no_video';
        return discoveryFailure(
          i18n.t(
            `input.webVideo.${code === 'protected_video' ? 'protected' : code === 'browser_required' ? 'openInApp' : 'noVideo'}`,
            code === 'protected_video'
              ? 'This video is protected and cannot be downloaded.'
              : code === 'browser_required'
                ? 'Open this page in Translator to choose a video.'
                : 'No downloadable video was found on this page.'
          )
        );
      }
      const preferred = options?.webVideoId
        ? discovery.candidates.find(video => video.id === options.webVideoId)
        : undefined;
      if (options?.webVideoId && !preferred) {
        void UrlIPC.releaseWebVideoDiscovery(discovery.discoveryId).catch(
          () => {}
        );
        return discoveryFailure(
          i18n.t(
            'input.webVideo.noVideo',
            'No downloadable video was found on this page.'
          )
        );
      }
      if (
        !preferred &&
        discovery.candidates.length > 1 &&
        options?.interactive === false
      ) {
        void UrlIPC.releaseWebVideoDiscovery(discovery.discoveryId);
        return discoveryFailure(
          i18n.t(
            'input.webVideo.openInApp',
            'Open this page in Translator to choose a video.'
          )
        );
      }
      set((state: UrlState) => {
        state.download.stage = i18n.t(
          'input.webVideo.choose',
          'Choose a video'
        );
      });
      const candidateId = preferred
        ? preferred.id
        : discovery.candidates.length === 1
          ? discovery.candidates[0].id
          : await chooseWebVideo(opId, discovery.candidates);
      if (!candidateId || isCurrentDownloadCancelledOrStale()) {
        void UrlIPC.releaseWebVideoDiscovery(discovery.discoveryId);
        if (!isCurrentDownloadCancelledOrStale())
          set((state: UrlState) => {
            state.download.inProgress = false;
            state.download.stage = 'Cancelled';
            state.download.percent = 100;
          });
        return cancelledResult();
      }
      webVideo = { discoveryId: discovery.discoveryId, candidateId };
      set((state: UrlState) => {
        if (state.lastDownloadRequest)
          state.lastDownloadRequest.webVideo = webVideo;
      });
    }
    if (webVideo && mountOnComplete) {
      const reused = await openExistingLocalCopy({
        requestedUrl,
        operationId: opId,
        preserveSubtitles,
        replaceCurrent: options?.replaceCurrent === true,
        hasMountedSource: hasMountedVideo(),
        webVideoId: webVideo.candidateId,
      });
      if (isCurrentDownloadCancelledOrStale()) return cancelledResult();
      if (reused) {
        set((state: UrlState) => {
          state.download.inProgress = false;
          state.download.stage = reused.success ? 'Completed' : 'Cancelled';
          state.download.percent = 100;
          if (reused.success) state.urlInput = '';
        });
        return reused;
      }
    }
    const res = await UrlIPC.download({
      url: requestedUrl,
      quality: downloadQuality,
      operationId: opId,
      allowLongVideo: options?.allowLongVideo === true,
      webVideo,
    });

    // User cancellation should always win, even if the backend eventually
    // resolves as NeedCookies (race between cancel and captcha detection).
    if (isCurrentDownloadCancelledOrStale()) {
      if (res.success && (res.videoPath || res.filePath)) {
        await discardProcessedUrl();
      }
      return cancelledResult();
    }

    if (res.rejection) {
      const rejection = res.rejection;
      if (rejection.code === 'long_video') {
        set((state: UrlState) => {
          state.needCookies = false;
          state.download.inProgress = false;
          state.download.stage = '';
          state.download.percent = 0;
        });
        const confirmed = await openLongDownloadConfirm({
          durationSec: rejection.durationSec,
          estimatedBytes: rejection.estimatedBytes,
        });
        // A download the user started meanwhile owns the state now.
        if (get().download.id !== opId) return cancelledResult();
        if (!confirmed) {
          set((state: UrlState) => {
            state.download.stage = 'Cancelled';
            state.download.percent = 100;
          });
          return cancelledResult();
        }
        // The continued request owns the selection now, including a possible
        // sign-in retry. The outer finally must not release its capability.
        retainDiscovery = true;
        return await downloadMediaInternal(set, get, {
          ...options,
          url: requestedUrl,
          allowLongVideo: true,
          webVideo,
        });
      }
      const message = sourceRejectionMessage(rejection.code);
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        state.download.stage = 'Error';
        state.download.percent = 100;
        state.error = message;
        state.errorKind = 'validation';
      });
      return res;
    }

    if (
      res.success &&
      res.captionRecovery?.kind === 'youtube_automatic_captions' &&
      res.captionRecovery.mediaFailure === 'http_403'
    ) {
      const recoveredSegments = parseSrt(String(res.subtitles || ''));
      if (recoveredSegments.length === 0) {
        const message = describeDownloadFailure({
          errorCode: 'captions_unreadable',
        });
        set((state: UrlState) => {
          state.needCookies = false;
          state.download.inProgress = false;
          state.download.stage = 'Error';
          state.download.percent = 100;
          state.error = message;
          state.errorKind = 'operation';
        });
        return { ...res, success: false, error: message };
      }

      if (!mountOnComplete) {
        set((state: UrlState) => {
          state.needCookies = false;
          state.download.inProgress = false;
          state.download.stage = 'Video blocked; automatic captions available';
          state.download.percent = 100;
          state.error = null;
          state.errorKind = null;
        });
        return res;
      }

      const hasMountedSource = hasMountedVideo();
      if (
        hasMountedSource &&
        !(await openDownloadSwitchConfirm('caption_recovery'))
      ) {
        if (isCurrentDownloadCancelledOrStale()) {
          return cancelledResult();
        }
        set((state: UrlState) => {
          state.needCookies = false;
          state.download.inProgress = false;
          state.download.stage = 'Automatic captions ready; not opened';
          state.download.percent = 100;
          state.error = null;
          state.errorKind = null;
        });
        return res;
      }

      if (isCurrentDownloadCancelledOrStale()) {
        return cancelledResult();
      }

      if (useSubStore.getState().order.length > 0) {
        const choice = await openUnsavedSrtConfirm('caption_recovery');
        if (isCurrentDownloadCancelledOrStale()) {
          return cancelledResult();
        }
        if (choice === 'cancel') {
          set((state: UrlState) => {
            state.needCookies = false;
            state.download.inProgress = false;
            state.download.stage = 'Automatic captions ready; not opened';
            state.download.percent = 100;
            state.error = null;
            state.errorKind = null;
          });
          return res;
        }
        if (choice === 'save') {
          const saveResult = await saveCurrentSubtitles();
          if (!didSaveSubtitleFile(saveResult)) {
            if (saveResult.error) {
              console.warn(
                '[url-store] Saving subtitles failed:',
                saveResult.error
              );
            }
            const message = i18n.t(
              'errors.download.subtitlesNotSaved',
              'Your current subtitles couldn’t be saved, so the YouTube captions weren’t opened.'
            );
            set((state: UrlState) => {
              state.needCookies = false;
              state.download.inProgress = false;
              state.download.stage = 'Error';
              state.download.percent = 100;
              state.error = message;
              state.errorKind = 'operation';
            });
            return { ...res, success: false, error: message };
          }
        }
      }

      if (isCurrentDownloadCancelledOrStale()) {
        return cancelledResult();
      }
      await useVideoStore.getState().setFile(null);
      if (isCurrentDownloadCancelledOrStale()) {
        return cancelledResult();
      }
      useSubStore
        .getState()
        .load(recoveredSegments, null, 'fresh', null, null, null, null, {
          title: String(res.title || '').trim() || 'YouTube automatic captions',
          sourceVideoPath: null,
          sourceVideoAssetIdentity: null,
          sourceUrl: requestedUrl,
          sourceProvenance: 'youtube_automatic_captions',
          subtitleKind: null,
          targetLanguage: null,
        });
      closeChangeVideo();
      useUIStore.getState().setEditPanelOpen(true);
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.stage = 'Automatic captions ready; video unavailable';
        state.download.percent = 100;
        state.download.inProgress = false;
        state.download.completedFilePath = null;
        state.error = null;
        state.errorKind = null;
        state.urlInput = '';
      });
      return res;
    }

    let finalPath = res.videoPath ?? res.filePath;
    const filename = res.filename;

    if (res.cancelled || !finalPath || !filename) {
      retainDiscovery = res.error === 'NeedCookies';
      // One report per failure: the progress event only formats the text.
      const downloadFailureMessage =
        res.cancelled || res.error === 'NeedCookies'
          ? ''
          : describeDownloadFailure({
              error: res.error,
              errorCode: res.errorCode,
              report: true,
            });
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
          state.error = downloadFailureMessage;
          state.errorKind = 'operation';
        }
      });
      return res;
    }

    const {
      order: existingSubs,
      origin: subsOrigin,
      libraryEntryId,
    } = useSubStore.getState();
    const replaceCurrent = options?.replaceCurrent === true;
    const preserveMountedDiskSubs = downloadKeepsFileOpenedSubtitles({
      replaceCurrent,
      subtitleCount: existingSubs.length,
      origin: subsOrigin,
      libraryEntryId,
    });
    const hasMountedSource = hasMountedVideo();
    // The Change Video dialog asked for this; close it so the unsaved-edits
    // question (if any) and the new video are not hidden behind it.
    if (replaceCurrent && mountOnComplete) closeChangeVideo();
    // Unsaved subtitle edits are never dropped silently; declining keeps the
    // current video and leaves the download in the library.
    const shouldSwitchToDownloaded =
      mountOnComplete &&
      (!hasMountedSource ||
        replaceCurrent ||
        (await openDownloadSwitchConfirm())) &&
      (preserveSubtitles ||
        preserveMountedDiskSubs ||
        (await confirmReplaceUnsavedSubtitles()));

    if (isCurrentDownloadCancelledOrStale()) {
      await discardProcessedUrl();
      return cancelledResult();
    }

    shouldDiscardPendingResult = true;
    const acceptance = await acceptProcessedUrl();
    const acceptedPath = String(acceptance.filePath || '').trim();
    if (!acceptance.success || !acceptedPath) {
      if (isCurrentDownloadCancelledOrStale()) {
        return cancelledResult();
      }
      // A returned promotion failure has already claimed and cleaned the
      // scratch result in main. If IPC itself failed before that happened,
      // this best-effort discard prevents the completed scratch file leaking.
      await discardProcessedUrl();
      if (acceptance.error) {
        console.warn(
          '[url-store] Download promotion failed:',
          acceptance.error
        );
      }
      const message = describeDownloadFailure({ errorCode: 'save_failed' });
      set((state: UrlState) => {
        state.needCookies = false;
        state.download.inProgress = false;
        state.download.stage = 'Error';
        state.download.percent = 100;
        state.error = message;
        state.errorKind = inferErrorKind(message);
      });
      return {
        ...res,
        success: false,
        cancelled: false,
        error: message,
      };
    }
    shouldDiscardPendingResult = false;
    finalPath = acceptedPath;
    res.filePath = acceptedPath;
    if (res.videoPath) res.videoPath = acceptedPath;
    if (res.originalVideoPath) res.originalVideoPath = acceptedPath;

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
    const historyItem: VideoSuggestionDownloadHistoryItem = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceUrl: requestedUrl,
      webVideoId: res.webVideoId,
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
    };
    const historyHandoff = await handoffPromotedDownloadHistory({
      persistHistory: async () => {
        await upsertLocalVideoSuggestionHistoryItem(historyItem);
      },
      isStale: isCurrentDownloadCancelledOrStale,
      rollbackHistory: async () => {
        // rollback-upsert (not a plain remove): the main process restores any
        // entries this upsert displaced past the history size cap, so a stale
        // operation cannot silently shrink the library by one download.
        await rollbackLocalVideoSuggestionHistoryUpsert(
          historyItem.id,
          finalPath
        );
      },
      cleanupUnownedFile: async () => {
        if (!(await cleanupAcceptedProcessedUrl(finalPath))) {
          throw new Error(
            'The unowned promoted download could not be scheduled for cleanup.'
          );
        }
      },
    });

    if (historyHandoff.status === 'stale') {
      if (historyHandoff.rollbackError) {
        console.warn(
          `[url-store] Stale promoted download ${opId} remains history-owned because rollback failed:`,
          historyHandoff.rollbackError
        );
      }
      if (historyHandoff.cleanupError) {
        console.warn(
          `[url-store] Stale unowned promoted download ${opId} could not be reclaimed:`,
          historyHandoff.cleanupError
        );
      }
      return cancelledResult();
    }

    if (historyHandoff.status === 'failed') {
      const historyError =
        historyHandoff.error instanceof Error
          ? historyHandoff.error.message
          : String(historyHandoff.error || 'Unknown history error');
      const cleanupSuffix = historyHandoff.cleanupError
        ? ` The completed file remains at ${finalPath}.`
        : '';
      const historyErrorSuffix = /[.!?]$/.test(historyError) ? '' : '.';
      throw new Error(
        `Downloaded video could not be added to download history: ${historyError}${historyErrorSuffix}${cleanupSuffix}`
      );
    }

    let mountErrorMessage: string | null = null;

    set((state: UrlState) => {
      state.needCookies = false;
      state.download.stage = 'Completed';
      state.download.percent = 100;
      state.download.inProgress = false;
      state.download.completedFilePath = finalPath;
      state.error = null;
      state.errorKind = null;
      if (!fromBatch) state.urlInput = '';
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
        console.warn('[url-store] Opening the downloaded video failed:', err);
        mountErrorMessage = i18n.t(
          'errors.download.openFailed',
          'The video downloaded but couldn’t be opened. Open it from Download history.'
        );
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

    const message =
      err?.message === 'NeedCookies'
        ? null
        : describeDownloadFailure({
            error: err?.message || String(err),
            report: true,
          });
    set((state: UrlState) => {
      state.needCookies = err?.message === 'NeedCookies';
      state.error = message;
      state.errorKind = message ? 'operation' : null;
      state.download.stage =
        err?.message === 'NeedCookies' ? 'NeedCookies' : 'Error';
      state.download.percent = 100;
      state.download.inProgress = false;
    });
  } finally {
    offProgress();
    if (webVideo && !retainDiscovery)
      void UrlIPC.releaseWebVideoDiscovery(webVideo.discoveryId).catch(
        () => {}
      );
  }
}

async function openExistingLocalCopy({
  requestedUrl,
  operationId,
  preserveSubtitles,
  replaceCurrent,
  hasMountedSource,
  webVideoId,
}: {
  requestedUrl: string;
  operationId: string;
  preserveSubtitles: boolean;
  replaceCurrent: boolean;
  hasMountedSource: boolean;
  webVideoId?: string;
}): Promise<ProcessUrlResult | null> {
  let copy: { localPath: string; sourceUrl?: string; title?: string } | null =
    null;
  for (const candidate of historyCopiesForUrl(
    readLocalVideoSuggestionHistory(),
    requestedUrl,
    webVideoId
  )) {
    try {
      if (await window.fileApi.fileExists(candidate.localPath)) {
        copy = candidate;
        break;
      }
    } catch {
      // An unreadable path is not a usable copy.
    }
  }
  if (!copy) return null;

  const filePath = copy.localPath;
  const filename = filePath.split(/[\\/]/).pop() || copy.title || 'video';
  const result: ProcessUrlResult = {
    success: true,
    videoPath: filePath,
    filePath,
    filename,
    title: copy.title,
    webVideoId,
    operationId,
  };
  const declined: ProcessUrlResult = {
    success: false,
    cancelled: true,
    operationId,
  };
  if (useVideoStore.getState().path === filePath) {
    if (replaceCurrent) closeChangeVideo();
    return result;
  }
  if (replaceCurrent) closeChangeVideo();
  else if (hasMountedSource && !(await openDownloadSwitchConfirm())) {
    return declined;
  }
  if (!preserveSubtitles && !(await confirmReplaceUnsavedSubtitles())) {
    return declined;
  }

  let releaseLease: (() => Promise<void>) | null = null;
  try {
    releaseLease = await acquireProvisionalUrlDownloadLibraryPath(filePath);
    const payload = {
      path: filePath,
      name: filename,
      sourceUrl: copy.sourceUrl || requestedUrl,
    };
    if (preserveSubtitles) {
      await useVideoStore.getState().mountFilePreserveSubs(payload);
    } else {
      await useVideoStore.getState().setFile(payload);
    }
    useUIStore.getState().setInputMode('file');
    return result;
  } catch (err) {
    console.warn('[url-store] Opening the local copy failed:', err);
    // Fall back to downloading it again.
    return null;
  } finally {
    await releaseLease?.().catch(error => {
      console.warn('[url-store] Failed to release local copy lease:', error);
    });
  }
}
