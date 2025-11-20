import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { getNativePlayerInstance } from '../native-player';
import * as VideoIPC from '../ipc/video';
import * as FileIPC from '../ipc/file';
import { useTaskStore } from './task-store';
import { useUIStore } from './ui-store';
import { useSubStore } from './subtitle-store';
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
  url: string | null;
  originalPath: string | null;
  originalUrl: string | null;
  dubbedVideoPath: string | null;
  dubbedAudioPath: string | null;
  dubbedUrl: string | null;
  activeTrack: 'original' | 'dubbed';
  meta: Meta;
  isAudioOnly: boolean;
  isReady: boolean;
  resumeAt: number | null;
  _positionListeners: {
    onTimeUpdate: () => void;
    onPause: () => void;
  } | null;
}

interface Actions {
  setFile(
    file: File | { name: string | undefined; path: string } | null
  ): Promise<void>;
  togglePlay(): Promise<void>;
  handleTogglePlay(): void;
  openFileDialog(): Promise<void>;
  // New: mount a video without resetting current subtitles
  openFileDialogPreserveSubs(): Promise<{
    canceled: boolean;
    selectedPath?: string;
  } | void>;
  mountFilePreserveSubs(
    file: File | { name: string | undefined; path: string }
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
  url: null,
  originalPath: null,
  originalUrl: null,
  dubbedVideoPath: null,
  dubbedAudioPath: null,
  dubbedUrl: null,
  activeTrack: 'original',
  meta: null,
  isAudioOnly: false,
  isReady: false,
  resumeAt: null,
  _positionListeners: null,
};

let currentSaver: ReturnType<typeof throttle> | null = null;
const metadataRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

    async setFile(fd: File | { name: string; path: string } | null) {
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

      if (!fd) return;

      if ('path' in fd) {
        const url = toFileUrl(fd.path);
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.url = url;
          s.originalPath = fd.path;
          s.originalUrl = url;
          s.dubbedVideoPath = null;
          s.dubbedAudioPath = null;
          s.dubbedUrl = null;
          s.activeTrack = 'original';
        });
        await analyse(fd.path);
        try {
          logVideo('video_mounted', { path: fd.path });
        } catch {
          // Do nothing
        }
        if (fd.path) {
          try {
            const saved = await VideoIPC.getPlaybackPosition(fd.path);
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
        return;
      }

      if ((fd as any)._blobUrl) {
        const b = fd as any;
        set(s => {
          s.file = b;
          s.path = b._originalPath ?? null;
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
          try {
            const saved = await VideoIPC.getPlaybackPosition(b._originalPath);
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
        return;
      }

      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      const blobUrl = URL.createObjectURL(fd as File);
      set({ file: fd as File, url: blobUrl, path: (fd as any).path ?? null });
      set(s => {
        s.originalUrl = blobUrl;
        s.originalPath = (fd as any).path ?? null;
        s.dubbedVideoPath = null;
        s.dubbedAudioPath = null;
        s.dubbedUrl = null;
        s.activeTrack = 'original';
      });
      try {
        const p = (fd as any).path ?? '(blob)';
        logVideo('video_mounted', { path: p });
      } catch {
        // Do nothing
      }
      if ((fd as any).path) {
        await analyse((fd as any).path);
        try {
          const saved = await VideoIPC.getPlaybackPosition((fd as any).path);
          if (saved != null) {
            set({ resumeAt: saved });
          }
        } catch (err) {
          console.error('[video-store] Failed to load saved position:', err);
        }
        if ((fd as any).path) {
          attachSaver((fd as any).path);
          get().stopPositionSaving();
          get().startPositionSaving();
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

    async openFileDialog() {
      try {
        logButton('open_file_dialog');
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
      if (res.canceled || !res.filePaths.length) return;
      const p = res.filePaths[0];
      try {
        logVideo('video_selected', { path: p });
      } catch {
        // Do nothing
      }
      try {
        await get().setFile({ name: p.split(/[\\/]/).pop()!, path: p });
      } catch (err) {
        console.error('[video-store] Error setting file:', err);
      }
      import('../state/ui-store').then(m =>
        m.useUIStore.getState().setInputMode('file')
      );
    },

    async openFileDialogPreserveSubs() {
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
      if (res.canceled || !res.filePaths.length)
        return { canceled: true } as const;
      const p = res.filePaths[0];
      try {
        await get().mountFilePreserveSubs({
          name: p.split(/[\\/]/).pop()!,
          path: p,
        });
      } catch (err) {
        console.error(
          '[video-store] Error mounting file (preserve subs):',
          err
        );
      }
      import('../state/ui-store').then(m =>
        m.useUIStore.getState().setInputMode('file')
      );
      return { canceled: false, selectedPath: p } as const;
    },

    async mountFilePreserveSubs(fd: File | { name: string; path: string }) {
      const prev = get();
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

      if ('path' in fd) {
        const url = toFileUrl(fd.path);
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
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
        if (fd.path) {
          try {
            const saved = await VideoIPC.getPlaybackPosition(fd.path);
            if (saved != null) set({ resumeAt: saved });
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(fd.path);
          get().startPositionSaving();
        }
        return;
      }

      // Fallback: support File object mounting
      if ((fd as any)._blobUrl) {
        const b = fd as any;
        set(s => {
          s.file = b;
          s.path = b._originalPath ?? null;
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
          try {
            const saved = await VideoIPC.getPlaybackPosition(b._originalPath);
            if (saved != null) set({ resumeAt: saved });
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          attachSaver(b._originalPath);
          get().startPositionSaving();
        }
        return;
      }

      const blobUrl = URL.createObjectURL(fd as File);
      set({
        file: fd as File,
        url: blobUrl,
        path: (fd as any).path ?? null,
        resumeAt: null,
      });
      if ((fd as any).path) {
        await analyse((fd as any).path);
        try {
          const saved = await VideoIPC.getPlaybackPosition((fd as any).path);
          if (saved != null) set({ resumeAt: saved });
        } catch (err) {
          console.error('[video-store] Failed to load saved position:', err);
        }
        attachSaver((fd as any).path);
        get().startPositionSaving();
      }
    },

    markReady() {
      set({ isReady: true });
    },

    reset() {
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
        s.resumeAt = currentTime;
      });

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
    useVideoStore.setState({ isAudioOnly: !hasVideo });
    if (metaRes.success && metaRes.metadata) {
      useVideoStore.setState({ meta: metaRes.metadata });
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
        useVideoStore.setState({ meta: res.metadata });
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
