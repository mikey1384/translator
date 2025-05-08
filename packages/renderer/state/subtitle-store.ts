import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { SrtSegment } from '@shared-types/app';
import { shallow } from 'zustand/shallow';
import { getNativePlayerInstance } from '../native-player.js';

type SegmentMap = Record<string, SrtSegment>;

interface State {
  segments: SegmentMap;
  order: string[];
  activeId: string | null;
  playingId: string | null;
  _abortPlayListener?: () => void;
  sourceId: number;
  originalPath: string | null;
}

interface Actions {
  load: (segs: SrtSegment[]) => void;
  update: (id: string, patch: Partial<SrtSegment>) => void;
  insertAfter: (id: string) => void;
  remove: (id: string) => void;
  shift: (id: string, secs: number) => void;
  shiftAll: (offsetSeconds: number) => void;
  scrollToCurrent: () => void;
  setSrtPath: (filePath: string | null) => void;
  setActive: (id: string | null) => void;
  seek: (id: string) => void;
  play: (id: string) => void;
  pause: () => void;
  incSourceId: () => void;
  setOriginalPath: (p: string | null) => void;
  replaceAll: (find: string, replace: string) => void;
}

/* ------------------------------------------------------------------ */
/* 🏪  Store factory                                                   */
/* ------------------------------------------------------------------ */

const initialState: State = {
  segments: {},
  order: [],
  activeId: null,
  playingId: null,
  _abortPlayListener: undefined,
  sourceId: 0,
  originalPath: null,
};

export const useSubStore = createWithEqualityFn<State & Actions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,
      load: segs =>
        set(s => {
          // Convert array to map and set order, cloning each cue to ensure it's mutable
          s.segments = segs.reduce<SegmentMap>((acc, cue, i) => {
            acc[cue.id] = { ...cue, index: i + 1 };
            return acc;
          }, {});
          s.order = segs.map(cue => cue.id);
          // Increment sourceId to notify components of data change
          s.sourceId += 1;
        }),

      incSourceId: () =>
        set(s => {
          s.sourceId += 1;
        }),

      update: (id, patch) =>
        set(state => {
          const cue = state.segments[id]; // Direct lookup
          if (cue) Object.assign(cue, patch);
        }),

      insertAfter: id =>
        set(s => {
          const i = s.order.findIndex(cueId => cueId === id); // Find index in order array
          if (i === -1) return;

          const prev = s.segments[id];
          const nextId = s.order[i + 1];
          const next = nextId ? s.segments[nextId] : undefined;
          const gapStart = prev.end;
          const gapEnd = next ? next.start : prev.end + 2;

          const newCue: SrtSegment = {
            id: crypto.randomUUID(),
            index: i + 2, // Tentative index
            start: gapStart,
            end: gapEnd,
            original: '',
            translation: '',
          };

          s.segments[newCue.id] = newCue; // Add to map
          s.order.splice(i + 1, 0, newCue.id); // Insert into order
          s.order = [...s.order]; // Create new array reference to trigger re-render

          // Re-index affected segments
          for (let j = i + 1; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
        }),

      remove: id =>
        set(s => {
          const i = s.order.findIndex(cueId => cueId === id);
          if (i === -1) return;

          delete s.segments[id]; // Remove from map
          s.order.splice(i, 1); // Remove from order
          s.order = [...s.order]; // Create new array reference to trigger re-render

          // Re-index remaining segments
          for (let j = i; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
        }),

      shift: (id, secs) =>
        set(s => {
          const cue = s.segments[id]; // Direct lookup
          if (!cue) return;
          const dur = cue.end - cue.start;
          const newStart = Math.max(0, cue.start + secs);
          cue.start = newStart;
          cue.end = newStart + dur;
        }),

      shiftAll: offsetSeconds =>
        set(s => {
          Object.values(s.segments).forEach(cue => {
            const dur = cue.end - cue.start;
            const newStart = Math.max(0, cue.start + offsetSeconds);
            cue.start = newStart;
            cue.end = newStart + dur;
          });
        }),

      scrollToCurrent() {
        const { activeId, playingId } = get();
        const id = playingId ?? activeId;
        if (!id) return;
        const node = document.querySelector<HTMLElement>(
          `[data-cue-id="${id}"]`
        );
        node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },

      setSrtPath: filePath => set({ originalPath: filePath }),

      /* ---------- UI ---------- */
      setActive: id =>
        set(s => {
          s.activeId = id;
        }),

      /* ---------- Player helpers ---------- */
      seek: id => {
        const cue = get().segments[id]; // Direct lookup
        const np = getNativePlayerInstance();
        if (!cue || !np) return;
        np.currentTime = cue.start;
      },

      play: id => {
        const cue = get().segments[id]; // Direct lookup
        const np = getNativePlayerInstance();
        if (!cue || !np) return;

        np.currentTime = cue.start;
        np.play();
        set({ playingId: id });

        /* Auto-pause at cue end */
        const abort = get()._abortPlayListener;
        if (abort) abort();

        const off = () => {
          if (np.currentTime >= cue.end) {
            np.pause();
            np.removeEventListener('timeupdate', off);
            set({ playingId: null });
          }
        };
        np.addEventListener('timeupdate', off);

        set({
          _abortPlayListener: () => np.removeEventListener('timeupdate', off),
        });
      },

      pause: () => {
        getNativePlayerInstance()?.pause();
        set({ playingId: null });
      },

      setOriginalPath: p => set({ originalPath: p }),

      replaceAll: (find, replace) => {
        if (!find.trim() || !replace) return;
        const escaped = find.replace(/[.*+?^${}()|[\]\\\\]/g, '\\\\$&');
        const re = new RegExp(escaped, 'gi');
        set(s => {
          Object.values(s.segments).forEach(cue => {
            cue.original = cue.original.replace(re, replace);
            if (cue.translation) {
              cue.translation = cue.translation.replace(re, replace);
            }
          });
          s.sourceId += 1; // Notify subscribers of the change
        });
      },
    }))
  )
);

export const useSubActions = () =>
  useSubStore(
    (s: State & Actions) => ({
      update: s.update,
      remove: s.remove,
      insertAfter: s.insertAfter,
      shift: s.shift,
      seek: s.seek,
      play: s.play,
      pause: s.pause,
      setActive: s.setActive,
    }),
    shallow
  );

export const useSubSourceId = () => useSubStore(s => s.sourceId);

export const useSubtitleRow = (id: string) =>
  useSubStore(
    (s: State & Actions) => ({
      subtitle: s.segments[id], // Direct lookup
      isPlaying: s.playingId === id,
    }),
    shallow
  );
