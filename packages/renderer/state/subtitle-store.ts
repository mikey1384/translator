import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { SrtSegment } from '@shared-types/app';
import { shallow } from 'zustand/shallow';
import { getNativePlayerInstance } from '../native-player.js';
import { scrollPrecisely, flashSubtitle } from '../utils/scroll.js';

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
  load: (segs: SrtSegment[], srcPath?: string | null) => void;
  update: (id: string, patch: Partial<SrtSegment>) => void;
  insertAfter: (id: string) => void;
  remove: (id: string) => void;
  shift: (id: string, secs: number) => void;
  shiftAll: (offsetSeconds: number) => void;
  scrollToCurrent: () => void;
  setActive: (id: string | null) => void;
  seek: (id: string) => void;
  play: (id: string) => void;
  pause: () => void;
  incSourceId: () => void;
  replaceAll: (find: string, replace: string) => void;
}

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
      load: (segs, srcPath = null) => {
        set(s => {
          s.segments = segs.reduce<SegmentMap>((acc, cue, i) => {
            acc[cue.id] = { ...cue, index: i + 1 };
            return acc;
          }, {});
          s.order = segs.map(cue => cue.id);
          s.sourceId += 1;
          s.originalPath = srcPath;
        });
      },

      incSourceId: () =>
        set(s => {
          s.sourceId += 1;
        }),

      update: (id, patch) =>
        set(state => {
          const cue = state.segments[id];
          if (cue) Object.assign(cue, patch);
        }),

      insertAfter: id =>
        set(s => {
          const i = s.order.findIndex(cueId => cueId === id);
          if (i === -1) return;

          const prev = s.segments[id];
          const nextId = s.order[i + 1];
          const next = nextId ? s.segments[nextId] : undefined;
          const gapStart = prev.end;
          const gapEnd = next ? next.start : prev.end + 2;

          const newCue: SrtSegment = {
            id: crypto.randomUUID(),
            index: i + 2,
            start: gapStart,
            end: gapEnd,
            original: '',
            translation: '',
          };

          s.segments[newCue.id] = newCue;
          s.order.splice(i + 1, 0, newCue.id);
          s.order = [...s.order];

          for (let j = i + 1; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
        }),

      remove: id =>
        set(s => {
          const i = s.order.findIndex(cueId => cueId === id);
          if (i === -1) return;

          delete s.segments[id];
          s.order.splice(i, 1);
          s.order = [...s.order];

          for (let j = i; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
        }),

      shift: (id, secs) =>
        set(s => {
          const cue = s.segments[id];
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
        const { activeId, playingId, order, segments } = get();

        let id: string | null = playingId ?? activeId ?? null;

        if (!id) {
          const v = getNativePlayerInstance();
          if (v) {
            const t = v.currentTime;

            id =
              order.find(cueId => {
                const c = segments[cueId];
                return t >= c.start && t <= c.end;
              }) ?? null;

            if (!id) {
              for (let i = order.length - 1; i >= 0; i--) {
                if (segments[order[i]].start < t) {
                  id = order[i];
                  break;
                }
              }
            }

            if (!id && order.length) {
              id = order.find(cueId => segments[cueId].start > t) ?? order[0];
            }
          }
        }

        if (!id) return;

        const el = document.querySelector<HTMLElement>(`[data-cue-id="${id}"]`);
        if (el) {
          scrollPrecisely(el, false);
          requestAnimationFrame(() => flashSubtitle(el));
        }
      },

      setActive: id =>
        set(s => {
          s.activeId = id;
        }),

      seek: id => {
        const cue = get().segments[id];
        const np = getNativePlayerInstance();
        if (!cue || !np) return;
        np.currentTime = cue.start;
      },

      play: id => {
        const cue = get().segments[id];
        const np = getNativePlayerInstance();
        if (!cue || !np) return;

        np.currentTime = cue.start;
        np.play();
        set({ playingId: id });

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
          s.sourceId += 1;
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
      subtitle: s.segments[id],
      isPlaying: s.playingId === id,
    }),
    shallow
  );
