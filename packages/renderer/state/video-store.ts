import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { getNativePlayerInstance } from '../native-player';
import * as VideoIPC from '../ipc/video';

type Meta = {
  duration: number;
  width: number;
  height: number;
  frameRate: number;
} | null;

interface State {
  file: File | null; // actual File/Blob
  path: string | null; // original disk path (if any)
  url: string | null; // blob: or file://
  meta: Meta;
  isAudioOnly: boolean;
  isReady: boolean;
}

interface Actions {
  setFile(file: File | { name: string; path: string } | null): Promise<void>;
  togglePlay(): Promise<void>;
  markReady(): void;
  reset(): void;
}

const initial: State = {
  file: null,
  path: null,
  url: null,
  meta: null,
  isAudioOnly: false,
  isReady: false,
};

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
        if (b._originalPath) await analyse(b._originalPath);
        return;
      }

      /* 3 ) Plain drag-and-drop File */
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      const blobUrl = URL.createObjectURL(fd as File);
      set({ file: fd as File, url: blobUrl, path: (fd as any).path ?? null });
      if ((fd as any).path) await analyse((fd as any).path);
    },

    async togglePlay() {
      const np = getNativePlayerInstance();
      if (!np) return;
      if (np.paused) await np.play();
      else np.pause();
    },

    markReady() {
      set({ isReady: true });
    },

    reset() {
      const prev = get();
      if (prev.url?.startsWith('blob:')) URL.revokeObjectURL(prev.url);
      set(initial);
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
