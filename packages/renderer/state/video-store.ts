import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { getNativePlayerInstance } from '../native-player';
import * as VideoIPC from '../ipc/video';
import * as FileIPC from '../ipc/file';
import { useTaskStore } from './task-store';
import { useUIStore } from './ui-store';
import { useSubStore } from './subtitle-store';
import {
  maybeAutoMountStoredSubtitleForVideo,
  rememberStoredSubtitleSourcePath,
} from '../utils/subtitle-library';
import {
  basename as recentMediaBasename,
  filterExistingRecentLocalMedia,
  readRecentLocalMedia,
  rememberRecentLocalMedia,
  removeRecentLocalMedia,
  type RecentLocalMediaItem,
} from './recent-local-media';
import throttle from 'lodash/throttle';
import { logButton, logVideo } from '../utils/logger';

function toFileUrl(p: string): string {
  if (!p) return p;
  if (p.startsWith('file://')) return p;
  const normalized = p.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file://${encodeURI(`/${normalized}`)}`;
}

function normalizeSourceAssetPath(
  pathValue: string | null | undefined
): string {
  return String(pathValue || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
}

function createUnverifiedSourceAssetIdentity(
  pathValue: string | null | undefined
): string {
  const normalizedPath = normalizeSourceAssetPath(pathValue) || 'unknown-path';
  return `unverified:${normalizedPath}`;
}

async function resolveSourceAssetIdentity(
  pathValue: string | null | undefined
): Promise<string | null> {
  const normalizedPath = normalizeSourceAssetPath(pathValue);
  if (!normalizedPath) return null;
  try {
    const identity = await FileIPC.getFileIdentity(normalizedPath);
    if (identity?.success && identity.identity) {
      return `file:${identity.identity}`;
    }
  } catch (error) {
    console.warn(
      '[video-store] Failed to resolve source asset identity, using unverified fallback:',
      error
    );
  }
  return createUnverifiedSourceAssetIdentity(normalizedPath);
}

type Meta = {
  duration: number;
  width: number;
  height: number;
  frameRate: number | string;
  rotation?: number;
  displayWidth?: number;
  displayHeight?: number;
} | null;

interface State {
  file: File | null;
  path: string | null;
  sourceUrl: string | null;
  sourceAssetIdentity: string | null;
  url: string | null;
  originalPath: string | null;
  originalUrl: string | null;
  dubbedVideoPath: string | null;
  dubbedAudioPath: string | null;
  dubbedUrl: string | null;
  activeTrack: 'original' | 'dubbed';
  meta: Meta;
  metaPath: string | null;
  isAudioOnly: boolean;
  isReady: boolean;
  recentLocalMedia: RecentLocalMediaItem[];
  resumeAt: number | null;
  _positionListeners: {
    onTimeUpdate: () => void;
    onPause: () => void;
  } | null;
}

interface Actions {
  openLocalMedia(options?: {
    preserveSubtitles?: boolean;
  }): Promise<{ canceled: boolean; selectedPath?: string }>;
  openRecentLocalMedia(
    path: string,
    options?: { preserveSubtitles?: boolean }
  ): Promise<{ opened: boolean; missing?: boolean }>;
  removeRecentLocalMedia(path: string): void;
  refreshRecentLocalMedia(): Promise<void>;
  setFile(
    file:
      | File
      | { name: string | undefined; path: string; sourceUrl?: string | null }
      | null,
    options?: {
      skipStoredSubtitleAutoMount?: boolean;
    }
  ): Promise<void>;
  togglePlay(): Promise<void>;
  handleTogglePlay(): void;
  mountFilePreserveSubs(
    file:
      | File
      | { name: string | undefined; path: string; sourceUrl?: string | null }
  ): Promise<void>;
  markReady(): void;
  reset(): void;
  savePosition(position: number): void;
  startPositionSaving(): void;
  stopPositionSaving(): void;
  registerDubbedResult(args: {
    videoPath?: string | null;
    audioPath?: string | null;
  }): void;
  setActiveTrack(track: 'original' | 'dubbed'): Promise<void>;
  clearDubbedMedia(): void;
}

const initial: State = {
  file: null,
  path: null,
  sourceUrl: null,
  sourceAssetIdentity: null,
  url: null,
  originalPath: null,
  originalUrl: null,
  dubbedVideoPath: null,
  dubbedAudioPath: null,
  dubbedUrl: null,
  activeTrack: 'original',
  meta: null,
  metaPath: null,
  isAudioOnly: false,
  isReady: false,
  recentLocalMedia: readRecentLocalMedia(),
  resumeAt: null,
  _positionListeners: null,
};

let currentSaver: ReturnType<typeof throttle> | null = null;
const metadataRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
let latestMountRequestId = 0;

function beginMountRequest(): number {
  latestMountRequestId += 1;
  return latestMountRequestId;
}

function isCurrentMountRequest(requestId: number): boolean {
  return latestMountRequestId === requestId;
}

function attachSaver(path: string) {
  currentSaver?.cancel();
  currentSaver = throttle(async (pos: number) => {
    try {
      await VideoIPC.savePlaybackPosition(path, pos);
    } catch (e) {
      console.error('[video-store] save', e);
    }
  }, 5000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    currentSaver?.flush?.();
  });
}

export const useVideoStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    ...initial,

    async openLocalMedia(options) {
      const preserveSubtitles = Boolean(options?.preserveSubtitles);
      try {
        logButton(
          preserveSubtitles
            ? 'open_file_dialog_preserve_subs'
            : 'open_file_dialog'
        );
      } catch {
        // Do nothing
      }
      const res = await FileIPC.open({
        properties: ['openFile'],
        filters: [
          {
            name: 'Media',
            extensions: [
              'mp4',
              'mkv',
              'avi',
              'mov',
              'webm',
              'mp3',
              'wav',
              'aac',
              'ogg',
              'flac',
            ],
          },
        ],
      });
      if (res.canceled || !res.filePaths.length) {
        return { canceled: true } as const;
      }
      const path = res.filePaths[0];
      try {
        logVideo('video_selected', { path });
      } catch {
        // Do nothing
      }
      try {
        const payload = {
          name: recentMediaBasename(path),
          path,
        } as const;
        if (preserveSubtitles) {
          await get().mountFilePreserveSubs(payload);
        } else {
          await get().setFile(payload);
        }
        useUIStore.getState().setInputMode('file');
        set({ recentLocalMedia: rememberRecentLocalMedia(path) });
        return { canceled: false, selectedPath: path } as const;
      } catch (err) {
        console.error('[video-store] Error opening local media:', err);
        return { canceled: true } as const;
      }
    },

    async openRecentLocalMedia(path, options) {
      const trimmed = String(path || '').trim();
      if (!trimmed) return { opened: false } as const;
      let exists = false;
      try {
        exists = await window.fileApi.fileExists(trimmed);
      } catch (err) {
        console.error(
          '[video-store] Failed to validate recent local media:',
          err
        );
        return { opened: false } as const;
      }

      if (!exists) {
        set({ recentLocalMedia: removeRecentLocalMedia(trimmed) });
        return { opened: false, missing: true } as const;
      }

      try {
        const payload = {
          name: recentMediaBasename(trimmed),
          path: trimmed,
        } as const;
        if (options?.preserveSubtitles) {
          await get().mountFilePreserveSubs(payload);
        } else {
          await get().setFile(payload);
        }
        useUIStore.getState().setInputMode('file');
        set({ recentLocalMedia: rememberRecentLocalMedia(trimmed) });
        return { opened: true } as const;
      } catch (err) {
        console.error('[video-store] Failed to open recent local media:', err);
        return { opened: false } as const;
      }
    },

    removeRecentLocalMedia(path) {
      const trimmed = String(path || '').trim();
      if (!trimmed) return;
      set({ recentLocalMedia: removeRecentLocalMedia(trimmed) });
    },

    async refreshRecentLocalMedia() {
      const recentLocalMedia = await filterExistingRecentLocalMedia();
      set({ recentLocalMedia });
    },

    async setFile(
      fd:
        | File
        | { name: string; path: string; sourceUrl?: string | null }
        | null,
      options
    ) {
      const mountRequestId = beginMountRequest();
      const isCurrentMount = () => isCurrentMountRequest(mountRequestId);
      const skipStoredSubtitleAutoMount = Boolean(
        options?.skipStoredSubtitleAutoMount
      );
      const prev = get();
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      if (prev.path) {
        clearMetadataRetry(prev.path);
      }
      set(initial);
      // Reset session-only UI state for exclamation markers when video changes
      try {
        useUIStore.getState().resetExclamationState();
        // Also clear per-segment confidence metrics so LC panel resets
        useSubStore.getState().clearConfidence();
        // Flush gap/LC caches on video change
        useSubStore.getState().clearCaches();
      } catch {
        // no-op
      }
      useTaskStore.getState().setTranscription({
        inProgress: false,
        percent: 0,
        stage: '',
        isCompleted: false,
        id: null,
      });

      if (!isCurrentMount()) return;
      if (!fd) return;

      if ('path' in fd) {
        const url = toFileUrl(fd.path);
        const sourceUrl = String(fd.sourceUrl || '').trim() || null;
        const sourceAssetIdentity = await resolveSourceAssetIdentity(fd.path);
        if (!isCurrentMount()) return;
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.sourceUrl = sourceUrl;
          s.sourceAssetIdentity = sourceAssetIdentity;
          s.url = url;
          s.originalPath = fd.path;
          s.originalUrl = url;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
        });
        await analyse(fd.path);
        if (!isCurrentMount()) return;
        try {
          logVideo('video_mounted', { path: fd.path });
        } catch {
          // Do nothing
        }
        if (fd.path) {
          try {
            const saved = await VideoIPC.getPlaybackPosition(fd.path);
            if (!isCurrentMount()) return;
            if (saved != null) {
              set({ resumeAt: saved });
            }
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(fd.path);
          get().stopPositionSaving();
          get().startPositionSaving();
        }
        if (!skipStoredSubtitleAutoMount) {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: fd.path,
              sourceUrl,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
        return;
      }

      if ((fd as any)._blobUrl) {
        const b = fd as any;
        const sourceAssetIdentity = b._originalPath
          ? await resolveSourceAssetIdentity(b._originalPath)
          : null;
        if (!isCurrentMount()) return;
        set(s => {
          s.file = b;
          s.path = b._originalPath ?? null;
          s.sourceUrl = null;
          s.sourceAssetIdentity = sourceAssetIdentity;
          s.url = b._blobUrl;
          s.originalPath = b._originalPath ?? null;
          s.originalUrl = b._blobUrl;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
        });
        try {
          logVideo('video_mounted', { path: b._originalPath ?? '(blob)' });
        } catch {
          // Do nothing
        }
        if (b._originalPath) {
          await analyse(b._originalPath);
          if (!isCurrentMount()) return;
          try {
            const saved = await VideoIPC.getPlaybackPosition(b._originalPath);
            if (!isCurrentMount()) return;
            if (saved != null) {
              set({ resumeAt: saved });
            }
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          if (b._originalPath) {
            attachSaver(b._originalPath);
            get().stopPositionSaving();
            get().startPositionSaving();
          }
        }
        if (!skipStoredSubtitleAutoMount) {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: b._originalPath ?? null,
              sourceUrl: null,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
        return;
      }

      const sourcePath = ((fd as any).path as string | undefined) ?? null;
      const sourceAssetIdentity = sourcePath
        ? await resolveSourceAssetIdentity(sourcePath)
        : null;
      if (!isCurrentMount()) return;
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      let blobUrl: string | null = null;
      let blobUrlCommitted = false;
      try {
        blobUrl = URL.createObjectURL(fd as File);
        if (!isCurrentMount()) return;
        set({
          file: fd as File,
          url: blobUrl,
          path: sourcePath,
          sourceUrl: null,
          sourceAssetIdentity,
        });
        set(s => {
          s.originalUrl = blobUrl!;
          s.originalPath = sourcePath;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
        });
        blobUrlCommitted = true;
        try {
          const p = sourcePath ?? '(blob)';
          logVideo('video_mounted', { path: p });
        } catch {
          // Do nothing
        }
        if (sourcePath) {
          await analyse(sourcePath);
          if (!isCurrentMount()) return;
          try {
            const saved = await VideoIPC.getPlaybackPosition(sourcePath);
            if (!isCurrentMount()) return;
            if (saved != null) {
              set({ resumeAt: saved });
            }
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(sourcePath);
          get().stopPositionSaving();
          get().startPositionSaving();
        }
        if (!skipStoredSubtitleAutoMount) {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: sourcePath,
              sourceUrl: null,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
      } finally {
        if (!blobUrlCommitted && blobUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    },

    async togglePlay() {
      const np = getNativePlayerInstance();
      if (!np) return;
      if (np.paused) await np.play();
      else np.pause();
    },

    handleTogglePlay() {
      const np = getNativePlayerInstance();
      if (!np) return;
      if (np.paused) np.play().catch(console.error);
      else np.pause();
    },

    async mountFilePreserveSubs(
      fd: File | { name: string; path: string; sourceUrl?: string | null }
    ) {
      const mountRequestId = beginMountRequest();
      const isCurrentMount = () => isCurrentMountRequest(mountRequestId);
      const prev = get();
      const subtitleState = useSubStore.getState();
      const hadMountedSubtitles = subtitleState.order.length > 0;
      const previousSubtitleVideoPath = subtitleState.sourceVideoPath;
      const previousLibraryEntryId = subtitleState.libraryEntryId;
      // Clean up previous blob URL if any
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);

      // Stop position saving for previous video
      get().stopPositionSaving();

      // Reset session-only UI state for exclamation markers when video changes
      try {
        useUIStore.getState().resetExclamationState();
        // Also clear per-segment confidence metrics so LC panel resets
        useSubStore.getState().clearConfidence();
        // Flush gap/LC caches on video change
        useSubStore.getState().clearCaches();
      } catch {
        // no-op
      }

      // Reset transcription state when mounting a new source
      useTaskStore.getState().setTranscription({
        inProgress: false,
        percent: 0,
        stage: '',
        isCompleted: false,
        id: null,
      });
      if (!isCurrentMount()) return;

      const updatePreservedSubtitleAssociation = async (
        nextSourceVideoPath: string | null,
        nextSourceUrl: string | null
      ) => {
        if (!isCurrentMount()) return;
        if (!hadMountedSubtitles) return;

        const nextSourceVideoAssetIdentity = nextSourceVideoPath
          ? await resolveSourceAssetIdentity(nextSourceVideoPath)
          : null;
        if (!isCurrentMount()) return;

        const sameVideoByPath =
          Boolean(previousSubtitleVideoPath) &&
          Boolean(nextSourceVideoPath) &&
          previousSubtitleVideoPath === nextSourceVideoPath;
        const sameVideoByUrl =
          Boolean(previousLibraryEntryId) &&
          Boolean(prev.sourceUrl) &&
          Boolean(nextSourceUrl) &&
          prev.sourceUrl === nextSourceUrl;
        const shouldKeepLibraryLink =
          Boolean(previousLibraryEntryId) &&
          (sameVideoByPath || sameVideoByUrl);

        if (
          shouldKeepLibraryLink &&
          previousLibraryEntryId &&
          nextSourceVideoPath &&
          previousSubtitleVideoPath !== nextSourceVideoPath
        ) {
          try {
            await rememberStoredSubtitleSourcePath({
              entryId: previousLibraryEntryId,
              sourceVideoPath: nextSourceVideoPath,
            });
            if (!isCurrentMount()) return;
          } catch (err) {
            console.error(
              '[video-store] Failed to remember preserved subtitle path:',
              err
            );
          }
        }

        if (!isCurrentMount()) return;
        useSubStore.setState({
          sourceVideoPath: nextSourceVideoPath,
          sourceVideoAssetIdentity: nextSourceVideoAssetIdentity,
          libraryEntryId: shouldKeepLibraryLink ? previousLibraryEntryId : null,
          libraryKind: shouldKeepLibraryLink ? subtitleState.libraryKind : null,
        });
      };

      if ('path' in fd) {
        const url = toFileUrl(fd.path);
        const sourceUrl = String(fd.sourceUrl || '').trim() || null;
        const sourceAssetIdentity = await resolveSourceAssetIdentity(fd.path);
        if (!isCurrentMount()) return;
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.sourceUrl = sourceUrl;
          s.sourceAssetIdentity = sourceAssetIdentity;
          s.url = url;
          s.originalPath = fd.path;
          s.originalUrl = url;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
          s.resumeAt = null;
        });
        await analyse(fd.path);
        if (!isCurrentMount()) return;
        if (fd.path) {
          try {
            const saved = await VideoIPC.getPlaybackPosition(fd.path);
            if (!isCurrentMount()) return;
            if (saved != null) set({ resumeAt: saved });
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(fd.path);
          get().startPositionSaving();
        }
        if (hadMountedSubtitles) {
          if (!isCurrentMount()) return;
          await updatePreservedSubtitleAssociation(fd.path, sourceUrl);
        } else {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: fd.path,
              sourceUrl,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
        return;
      }

      // Fallback: support File object mounting
      if ((fd as any)._blobUrl) {
        const b = fd as any;
        const sourceAssetIdentity = b._originalPath
          ? await resolveSourceAssetIdentity(b._originalPath)
          : null;
        if (!isCurrentMount()) return;
        set(s => {
          s.file = b;
          s.path = b._originalPath ?? null;
          s.sourceUrl = null;
          s.sourceAssetIdentity = sourceAssetIdentity;
          s.url = b._blobUrl;
          s.originalPath = b._originalPath ?? null;
          s.originalUrl = b._blobUrl;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
          s.resumeAt = null;
        });
        if (b._originalPath) {
          await analyse(b._originalPath);
          if (!isCurrentMount()) return;
          try {
            const saved = await VideoIPC.getPlaybackPosition(b._originalPath);
            if (!isCurrentMount()) return;
            if (saved != null) set({ resumeAt: saved });
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(b._originalPath);
          get().startPositionSaving();
        }
        if (hadMountedSubtitles) {
          if (!isCurrentMount()) return;
          await updatePreservedSubtitleAssociation(
            b._originalPath ?? null,
            null
          );
        } else {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: b._originalPath ?? null,
              sourceUrl: null,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
        return;
      }

      const sourcePath = ((fd as any).path as string | undefined) ?? null;
      const sourceAssetIdentity = sourcePath
        ? await resolveSourceAssetIdentity(sourcePath)
        : null;
      if (!isCurrentMount()) return;
      let blobUrl: string | null = null;
      let blobUrlCommitted = false;
      try {
        blobUrl = URL.createObjectURL(fd as File);
        if (!isCurrentMount()) return;
        set({
          file: fd as File,
          url: blobUrl,
          path: sourcePath,
          sourceUrl: null,
          sourceAssetIdentity,
          originalPath: sourcePath,
          originalUrl: blobUrl,
          dubbedVideoPath: null,
          dubbedAudioPath: null,
          dubbedUrl: null,
          activeTrack: 'original',
          resumeAt: null,
        });
        blobUrlCommitted = true;
        if (sourcePath) {
          await analyse(sourcePath);
          if (!isCurrentMount()) return;
          try {
            const saved = await VideoIPC.getPlaybackPosition(sourcePath);
            if (!isCurrentMount()) return;
            if (saved != null) set({ resumeAt: saved });
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(sourcePath);
          get().startPositionSaving();
        }
        if (hadMountedSubtitles) {
          if (!isCurrentMount()) return;
          await updatePreservedSubtitleAssociation(sourcePath, null);
        } else {
          if (!isCurrentMount()) return;
          try {
            await maybeAutoMountStoredSubtitleForVideo({
              sourceVideoPath: sourcePath,
              sourceUrl: null,
            });
          } catch (err) {
            console.error(
              '[video-store] Failed to auto-mount stored subtitles:',
              err
            );
          }
        }
      } finally {
        if (!blobUrlCommitted && blobUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(blobUrl);
        }
      }
    },

    markReady() {
      set({ isReady: true });
    },

    reset() {
      beginMountRequest();
      const prev = get();
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      if (prev.path) {
        clearMetadataRetry(prev.path);
      }
      set(initial);
      if (currentSaver) {
        currentSaver.cancel();
        currentSaver = null;
      }
    },

    savePosition(position: number) {
      if (currentSaver) {
        currentSaver(position);
      }
    },

    startPositionSaving() {
      const np = getNativePlayerInstance();
      const state = get();
      if (!np || !state.path) {
        if (!state.path && currentSaver) {
          currentSaver.cancel();
          currentSaver = null;
        }
        return;
      }
      attachSaver(state.path);
      const onTimeUpdate = () => {
        if (currentSaver) {
          currentSaver(np.currentTime);
        }
      };
      const onPause = () => {
        if (currentSaver) {
          currentSaver.flush?.();
        }
      };
      np.addEventListener('timeupdate', onTimeUpdate);
      np.addEventListener('pause', onPause);
      // Store the listeners for removal later
      set({ _positionListeners: { onTimeUpdate, onPause } });
    },

    stopPositionSaving() {
      const np = getNativePlayerInstance();
      const state = get();
      if (!np) return;
      if ((state as any)._positionListeners) {
        const { onTimeUpdate, onPause } = (state as any)._positionListeners;
        np.removeEventListener('timeupdate', onTimeUpdate);
        np.removeEventListener('pause', onPause);
        set({ _positionListeners: null });
        if (currentSaver) {
          currentSaver.flush?.();
          currentSaver.cancel();
        }
      }
    },

    registerDubbedResult({ videoPath, audioPath }) {
      set(s => {
        s.dubbedVideoPath = videoPath ?? null;
        s.dubbedAudioPath = audioPath ?? null;
        s.dubbedUrl = videoPath ? toFileUrl(videoPath) : null;
      });
    },

    async setActiveTrack(track) {
      const state = get();
      const targetUrl =
        track === 'dubbed'
          ? (state.dubbedUrl ?? null)
          : (state.originalUrl ?? null);
      const targetPath =
        track === 'dubbed'
          ? (state.dubbedVideoPath ?? null)
          : (state.originalPath ?? null);

      if (
        track === state.activeTrack &&
        state.url === targetUrl &&
        state.path === targetPath
      ) {
        return;
      }

      if (track === 'dubbed' && !state.dubbedUrl) {
        console.warn('[video-store] No dubbed media to activate');
        return;
      }

      const player = getNativePlayerInstance();
      const currentTime = player?.currentTime ?? state.resumeAt ?? 0;
      const wasPlaying = player ? !player.paused : false;

      if (player) {
        try {
          player.pause();
        } catch {
          // ignore
        }
      }

      set(s => {
        s.activeTrack = track;
        if (track === 'dubbed') {
          s.url = state.dubbedUrl;
          s.path = state.dubbedVideoPath ?? s.path;
        } else {
          s.url = s.originalUrl;
          s.path = s.originalPath;
        }
        if (state.path !== targetPath) {
          s.meta = null;
          s.metaPath = null;
        }
        s.resumeAt = currentTime;
      });

      if (targetPath && state.path !== targetPath) {
        void analyse(targetPath);
      }

      if (typeof window !== 'undefined') {
        (window as any)._videoLastValidTime = currentTime;
      }

      if (wasPlaying) {
        setTimeout(() => {
          const inst = getNativePlayerInstance();
          if (!inst) return;
          inst.play().catch(() => undefined);
        }, 200);
      }
    },

    clearDubbedMedia() {
      set(s => {
        s.dubbedVideoPath = null;
        s.dubbedAudioPath = null;
        s.dubbedUrl = null;
        if (s.activeTrack === 'dubbed') {
          s.activeTrack = 'original';
          s.url = s.originalUrl;
          s.path = s.originalPath;
          s.meta = null;
          s.metaPath = null;
        }
      });
    },
  }))
);

async function analyse(path: string) {
  try {
    const [hasVideo, metaRes] = await Promise.all([
      VideoIPC.hasVideoTrack(path),
      VideoIPC.getMetadata(path),
    ]);
    if (useVideoStore.getState().path !== path) {
      return;
    }
    useVideoStore.setState({ isAudioOnly: !hasVideo });
    if (metaRes.success && metaRes.metadata) {
      useVideoStore.setState({ meta: metaRes.metadata, metaPath: path });
      clearMetadataRetry(path);
    }
    if (!metaRes.success) {
      scheduleMetadataRetry(path, 1);
    }
  } catch (err) {
    console.error('[video-store] analyse error', err);
  }
}

function clearMetadataRetry(path: string) {
  const timer = metadataRetryTimers.get(path);
  if (timer) {
    clearTimeout(timer);
    metadataRetryTimers.delete(path);
  }
}

function scheduleMetadataRetry(path: string, attempt: number) {
  const existing = metadataRetryTimers.get(path);
  if (existing) {
    clearTimeout(existing);
  }
  if (attempt > 300) {
    metadataRetryTimers.delete(path);
    return;
  }
  const delay = Math.min(5000, attempt * 1500);
  const timer = setTimeout(async () => {
    metadataRetryTimers.delete(path);
    if (useVideoStore.getState().path !== path) {
      return;
    }
    try {
      const res = await VideoIPC.getMetadata(path);
      if (res.success && res.metadata) {
        useVideoStore.setState({ meta: res.metadata, metaPath: path });
        return;
      }
      if (res.code === 'icloud-placeholder') {
        scheduleMetadataRetry(path, attempt + 1);
      }
    } catch (err) {
      console.error('[video-store] metadata retry error', err);
      scheduleMetadataRetry(path, attempt + 1);
    }
  }, delay);
  metadataRetryTimers.set(path, timer);
}
