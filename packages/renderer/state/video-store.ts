import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { getNativePlayerInstance } from '../native-player';
import * as VideoIPC from '../ipc/video';
import * as FileIPC from '../ipc/file';
import throttle from 'lodash/throttle';

type Meta = {
  duration: number;
  width: number;
  height: number;
  frameRate: number | string;
} | null;

interface State {
  file: File | null; // actual File/Blob
  path: string | null; // original disk path (if any)
  url: string | null; // blob: or file://
  meta: Meta;
  isAudioOnly: boolean;
  isReady: boolean;
  resumeAt: number | null; // Add resumeAt to store the saved position
  _positionListeners: {
    onTimeUpdate: () => void;
    onPause: () => void;
  } | null;
}

interface Actions {
  setFile(file: File | { name: string; path: string } | null): Promise<void>;
  togglePlay(): Promise<void>;
  handleTogglePlay(): void;
  openFileDialog(): Promise<void>;
  markReady(): void;
  reset(): void;
  savePosition(position: number): void; // Add method to save position
  startPositionSaving(): void; // Add method to start saving position
  stopPositionSaving(): void; // Add method to stop saving position
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

// Manage a single throttler for saving position
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

// Add a listener for window unload to flush the last save
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    currentSaver?.flush?.();
  });
}

export const useVideoStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    ...initial,

    async setFile(fd) {
      /* —— reset first —— */
      const prev = get();
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      set(initial);

      if (!fd) return;

      /* 1 ) file chosen via dialog (has .path) */
      if ('path' in fd) {
        const url = `file://${encodeURI(fd.path.replace(/\\/g, '/'))}`;
        set(s => {
          s.file = fd as any;
          s.path = fd.path;
          s.url = url;
        });
        await analyse(fd.path);
        // Load saved position after file is set
        if (fd.path) {
          try {
            const saved = await VideoIPC.getPlaybackPosition(fd.path);
            if (saved != null) {
              set({ resumeAt: saved });
            }
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          // Attach saver and refresh listeners for the new file
          attachSaver(fd.path);
          get().stopPositionSaving();
          get().startPositionSaving();
        }
        return;
      }

      /* 2 ) special blob wrapper from URL flow */
      if ((fd as any)._blobUrl) {
        const b = fd as any;
        set(s => {
          s.file = b;
          s.path = b._originalPath ?? null;
          s.url = b._blobUrl;
        });
        if (b._originalPath) {
          await analyse(b._originalPath);
          // Load saved position after file is set
          try {
            const saved = await VideoIPC.getPlaybackPosition(b._originalPath);
            if (saved != null) {
              set({ resumeAt: saved });
            }
          } catch (err) {
            console.error('[video-store] Failed to load saved position:', err);
          }
          // Attach saver and refresh listeners for the new file
          if (b._originalPath) {
            attachSaver(b._originalPath);
            get().stopPositionSaving();
            get().startPositionSaving();
          }
        }
        return;
      }

      /* 3 ) Plain drag-and-drop File */
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      const blobUrl = URL.createObjectURL(fd as File);
      set({ file: fd as File, url: blobUrl, path: (fd as any).path ?? null });
      if ((fd as any).path) {
        await analyse((fd as any).path);
        // Load saved position after file is set
        try {
          const saved = await VideoIPC.getPlaybackPosition((fd as any).path);
          if (saved != null) {
            set({ resumeAt: saved });
          }
        } catch (err) {
          console.error('[video-store] Failed to load saved position:', err);
        }
        // Attach saver and refresh listeners for the new file
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
      // Keep UI state in sync
      import('../state/ui-store').then(m =>
        m.useUIStore.getState().setInputMode('file')
      );
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

/* --- helpers --- */
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
