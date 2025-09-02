import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { getNativePlayerInstance } from '../native-player';
import * as VideoIPC from '../ipc/video';
import * as FileIPC from '../ipc/file';
import { buildSrt } from '../../shared/helpers';
import { useSubStore } from './subtitle-store';
import { useUIStore } from './ui-store';
import { useTaskStore } from './task-store';
import throttle from 'lodash/throttle';

type Meta = {
  duration: number;
  width: number;
  height: number;
  frameRate: number | string;
} | null;

interface State {
  file: File | null;
  path: string | null;
  url: string | null;
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
  openFileDialogPreserveSubs(): Promise<void>;
  mountFilePreserveSubs(
    file: File | { name: string | undefined; path: string }
  ): Promise<void>;
  markReady(): void;
  reset(): void;
  savePosition(position: number): void;
  startPositionSaving(): void;
  stopPositionSaving(): void;
}

const initial: State = {
  file: null,
  path: null,
  url: null,
  meta: null,
  isAudioOnly: false,
  isReady: false,
  resumeAt: null,
  _positionListeners: null,
};

let currentSaver: ReturnType<typeof throttle> | null = null;

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
      // Do not prompt or clear subtitles on video change.
      // Unmounting subtitles (with save prompt) now happens on transcribe.
      set(initial);
      // Reset prior transcription completion state so UI doesn't show
      // "Transcription Complete" for the newly mounted video.
      useTaskStore.getState().setTranscription({ inProgress: false });

      if (!fd) return;

      if ('path' in fd) {
        const url = `file://${encodeURI(fd.path.replace(/\\/g, '/'))}`;
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.url = url;
        });
        await analyse(fd.path);
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
        });
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
      if (res.canceled || !res.filePaths.length) return;
      const p = res.filePaths[0];
      try {
        await get().mountFilePreserveSubs({ name: p.split(/[\\/]/).pop()!, path: p });
      } catch (err) {
        console.error('[video-store] Error mounting file (preserve subs):', err);
      }
      import('../state/ui-store').then(m =>
        m.useUIStore.getState().setInputMode('file')
      );
    },

    async mountFilePreserveSubs(fd: File | { name: string; path: string }) {
      const prev = get();
      // Clean up previous blob URL if any
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);

      // Stop position saving for previous video
      get().stopPositionSaving();

      // Reset transcription completion when mounting a new source
      useTaskStore.getState().setTranscription({ inProgress: false });

      if ('path' in fd) {
        const url = `file://${encodeURI(fd.path.replace(/\\/g, '/'))}`;
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.url = url;
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
      set({ file: fd as File, url: blobUrl, path: (fd as any).path ?? null, resumeAt: null });
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
    }
  } catch (err) {
    console.error('[video-store] analyse error', err);
  }
}
