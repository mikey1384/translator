import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { SrtSegment } from '@shared-types/app';

/* ------------------------------------------------------------------ */
/* 📊  Store shape                                                     */
/* ------------------------------------------------------------------ */

interface State {
  segments: SrtSegment[];
  activeId: string | null;
  playingId: string | null;
  _abortPlayListener?: () => void;
}

interface Actions {
  load: (segs: SrtSegment[]) => void;
  update: (id: string, patch: Partial<SrtSegment>) => void;
  insertAfter: (id: string) => void;
  remove: (id: string) => void;
  shift: (id: string, secs: number) => void;

  setActive: (id: string | null) => void;

  seek: (id: string) => void;
  play: (id: string) => void;
  pause: () => void;
}

/* ------------------------------------------------------------------ */
/* 🏪  Store factory                                                   */
/* ------------------------------------------------------------------ */

export const useSubStore = create<State & Actions>()(
  immer((set, get) => ({
    /* ---------- state ---------- */
    segments: [],
    activeId: null,
    playingId: null,
    _abortPlayListener: undefined,

    /* ---------- CRUD ---------- */
    load: segs =>
      set(s => {
        s.segments = segs;
      }),

    update: (id, patch) =>
      set(s => {
        const cue = s.segments.find(c => c.id === id);
        if (cue) Object.assign(cue, patch);
      }),

    insertAfter: id =>
      set(s => {
        const i = s.segments.findIndex(c => c.id === id);
        if (i === -1) return;

        const prev = s.segments[i];
        const next = s.segments[i + 1];
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

        s.segments.splice(i + 1, 0, newCue);

        // re-index for display
        s.segments.forEach((c, idx) => (c.index = idx + 1));
      }),

    remove: id =>
      set(s => {
        s.segments = s.segments.filter(c => c.id !== id);
        s.segments.forEach((c, idx) => (c.index = idx + 1));
      }),

    shift: (id, secs) =>
      set(s => {
        const cue = s.segments.find(c => c.id === id);
        if (!cue) return;
        const dur = cue.end - cue.start;
        const newStart = Math.max(0, cue.start + secs);
        cue.start = newStart;
        cue.end = newStart + dur;
      }),

    /* ---------- UI ---------- */
    setActive: id =>
      set(s => {
        s.activeId = id;
      }),

    /* ---------- Player helpers ---------- */
    seek: id => {
      const cue = get().segments.find(c => c.id === id);
      if (!cue) return;
      const np = (window as any).nativePlayer?.instance;
      if (np) np.currentTime = cue.start;
    },

    play: id => {
      const cue = get().segments.find(c => c.id === id);
      const np = (window as any).nativePlayer?.instance;
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
      (window as any).nativePlayer?.instance?.pause();
      set({ playingId: null });
    },
  }))
);

/* ------------------------------------------------------------------ */
/* 🎯  Row-level selector                                              */
/* ------------------------------------------------------------------ */

export const useSubtitleRow = (id: string) =>
  useSubStore(s => {
    const cue = s.segments.find(c => c.id === id);
    return {
      subtitle: cue,
      isPlaying: s.playingId === id,
      actions: {
        update: (p: Partial<SrtSegment>) => s.update(id, p),
        remove: () => s.remove(id),
        insertAfter: () => s.insertAfter(id),
        shift: (secs: number) => s.shift(id, secs),
        seek: () => s.seek(id),
        play: () => s.play(id),
        pause: s.pause,
        setActive: () => s.setActive(id),
      },
    };
  });
