import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { SrtSegment } from '@shared-types/app';
import { shallow } from 'zustand/shallow';
import { getNativePlayerInstance } from '../native-player.js';
import { scrollPrecisely, flashSubtitle } from '../utils/scroll.js';
import { secondsToSrtTime } from '../../shared/helpers';
import { groupUncertainRanges } from '../utils/subtitle-heuristics';

type SegmentMap = Record<string, SrtSegment>;

interface State {
  segments: SegmentMap;
  order: string[];
  activeId: string | null;
  playingId: string | null;
  _abortPlayListener?: () => void;
  sourceId: number;
  originalPath: string | null;
  origin: 'fresh' | 'disk' | null;
  // When origin is 'fresh', record the video file path this set of subtitles was generated for
  sourceVideoPath: string | null;
  gapsCache: Array<{
    start: number;
    end: number;
    dur: number;
    nextId?: string;
    prevId?: string;
  }>;
  lcRangesCache: Array<{
    start: number;
    end: number;
    count: number;
    firstId?: string;
  }>;
}

interface Actions {
  load: (
    segs: SrtSegment[],
    srcPath?: string | null,
    origin?: 'fresh' | 'disk' | null,
    videoPathRef?: string | null
  ) => void;
  // Clear per-segment confidence telemetry (avg_logprob/no_speech_prob/words)
  clearConfidence: () => void;
  // Compute and cache Gap/LC once per transcription/improve flow
  recomputeCaches: (gapThresholdSec?: number) => void;
  // Flush cached Gap/LC (e.g., on video change)
  clearCaches: () => void;
  update: (id: string, patch: Partial<SrtSegment>) => void;
  insertAfter: (id: string) => string | null;
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
  replaceWithSegments: (
    id: string,
    segs: Array<{ start: number; end: number; original: string }>
  ) => void;
  appendSegments: (
    segs: Array<{ start: number; end: number; original: string }>
  ) => void;
  // Efficiently patch many translations at once by matching segments via timecodes
  applyTranslations: (
    segs: Array<{
      start: number;
      end: number;
      translation?: string | undefined;
      index?: number;
    }>
  ) => void;
  // Append-only progress for transcription partials (no full reloads)
  applyTranscriptionProgress: (segs: SrtSegment[]) => void;
  // Bridge gaps by inserting single empty placeholder segments and collapsing
  // any existing empty runs; called after transcription completes.
  bridgeGaps: (thresholdSec?: number) => void;
}

const initialState: State = {
  segments: {},
  order: [],
  activeId: null,
  playingId: null,
  _abortPlayListener: undefined,
  sourceId: 0,
  originalPath: null,
  origin: null,
  sourceVideoPath: null,
  gapsCache: [],
  lcRangesCache: [],
};

export const useSubStore = createWithEqualityFn<State & Actions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,
      load: (segs, srcPath = null, loadOrigin = null, videoPathRef = null) => {
        set(s => {
          s.segments = segs.reduce<SegmentMap>((acc, cue, i) => {
            acc[cue.id] = { ...cue, index: i + 1 };
            return acc;
          }, {});
          s.order = segs.map(cue => cue.id);
          s.sourceId += 1;
          s.originalPath = srcPath;
          // Preserve previous origin if not explicitly provided and no srcPath indicates disk
          s.origin = loadOrigin ?? (srcPath ? 'disk' : (s.origin ?? null));
          // Preserve previous sourceVideoPath unless explicitly overridden
          s.sourceVideoPath =
            (typeof videoPathRef === 'string' ? videoPathRef : null) ??
            s.sourceVideoPath ??
            null;
          // Do not auto-regenerate caches here; generated during transcription flows
          s.gapsCache = [];
          s.lcRangesCache = [];
        });
      },

      clearConfidence: () =>
        set(s => {
          for (const id of s.order) {
            const cue = s.segments[id];
            if (!cue) continue;
            // Remove fields used by low-confidence heuristics coming from transcription
            delete (cue as any).avg_logprob;
            delete (cue as any).no_speech_prob;
            delete (cue as any).words;
          }
          // Nudge consumers to refresh
          s.sourceId += 1;
        }),

      recomputeCaches: (gapThresholdSec = 3) =>
        set(s => {
          const order = s.order;
          const segments = s.segments;
          const gaps: Array<{
            start: number;
            end: number;
            dur: number;
            nextId?: string;
            prevId?: string;
          }> = [];
          if (Array.isArray(order) && order.length > 0) {
            const isEmpty = (id: string) =>
              !String(segments[id]?.original || '').trim();
            for (let i = 0; i < order.length; ) {
              const id = order[i];
              const a = segments[id];
              if (!a) {
                i++;
                continue;
              }
              if (isEmpty(id)) {
                const start = a.start;
                let runEnd = a.end;
                let j = i + 1;
                while (j < order.length && isEmpty(order[j])) {
                  runEnd = Math.max(runEnd, segments[order[j]]!.end);
                  j++;
                }
                const next = j < order.length ? segments[order[j]] : undefined;
                const finalEnd =
                  next && next.start > runEnd ? next.start : runEnd;
                const dur = finalEnd - start;
                if (dur >= gapThresholdSec) {
                  gaps.push({
                    start,
                    end: finalEnd,
                    dur,
                    nextId: next?.id,
                    prevId: segments[order[i]]?.id,
                  });
                }
                i = j;
              } else {
                const next =
                  i + 1 < order.length ? segments[order[i + 1]] : undefined;
                if (next) {
                  const gap = Math.max(0, next.start - a.end);
                  if (gap >= gapThresholdSec) {
                    gaps.push({
                      start: a.end,
                      end: next.start,
                      dur: gap,
                      nextId: next.id,
                      prevId: a.id,
                    });
                  }
                }
                i++;
              }
            }
          }
          s.gapsCache = gaps;
          s.lcRangesCache = groupUncertainRanges(order, segments as any);
        }),

      clearCaches: () =>
        set(s => {
          s.gapsCache = [];
          s.lcRangesCache = [];
        }),

      incSourceId: () =>
        set(s => {
          s.sourceId += 1;
        }),

      update: (id, patch) =>
        set(state => {
          const cue = state.segments[id];
          if (cue) Object.assign(cue, patch);
        }),

      insertAfter: (id: string) => {
        let newCueId: string | null = null;
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
          newCueId = newCue.id;
        });
        return newCueId;
      },

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

      replaceWithSegments: (id, segs) =>
        set(s => {
          if (!Array.isArray(segs) || segs.length === 0) return;
          const i = s.order.findIndex(cueId => cueId === id);
          if (i === -1) return;
          const first = segs[0];
          const base = s.segments[id];
          if (!base) return;
          base.start = first.start;
          base.end = first.end;
          base.original = first.original;
          // Clear translation when replacing transcription
          base.translation = base.translation ?? '';

          // Insert remaining pieces after the base
          let insertPos = i + 1;
          for (let k = 1; k < segs.length; k++) {
            const p = segs[k];
            const newId = crypto.randomUUID();
            const newCue: SrtSegment = {
              id: newId,
              index: insertPos + 1,
              start: p.start,
              end: p.end,
              original: p.original,
              translation: '',
            } as SrtSegment;
            s.segments[newId] = newCue;
            s.order.splice(insertPos, 0, newId);
            insertPos++;
          }

          // Reindex all cues after original position
          for (let j = i; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
          // Update caches after improve/single-line transcribe
          const order = s.order;
          const segments = s.segments;
          const GAP_THRESHOLD_SEC = 3;
          const gaps: Array<{
            start: number;
            end: number;
            dur: number;
            nextId?: string;
            prevId?: string;
          }> = [];
          if (Array.isArray(order) && order.length > 0) {
            const isEmpty = (id2: string) =>
              !String(segments[id2]?.original || '').trim();
            for (let k = 0; k < order.length; ) {
              const cid = order[k];
              const a = segments[cid];
              if (!a) {
                k++;
                continue;
              }
              if (isEmpty(cid)) {
                const start = a.start;
                let runEnd = a.end;
                let j2 = k + 1;
                while (j2 < order.length && isEmpty(order[j2])) {
                  runEnd = Math.max(runEnd, segments[order[j2]]!.end);
                  j2++;
                }
                const next =
                  j2 < order.length ? segments[order[j2]] : undefined;
                const finalEnd =
                  next && next.start > runEnd ? next.start : runEnd;
                const dur = finalEnd - start;
                if (dur >= GAP_THRESHOLD_SEC) {
                  gaps.push({
                    start,
                    end: finalEnd,
                    dur,
                    nextId: next?.id,
                    prevId: segments[order[k]]?.id,
                  });
                }
                k = j2;
              } else {
                const next =
                  k + 1 < order.length ? segments[order[k + 1]] : undefined;
                if (next) {
                  const gap = Math.max(0, next.start - a.end);
                  if (gap >= GAP_THRESHOLD_SEC) {
                    gaps.push({
                      start: a.end,
                      end: next.start,
                      dur: gap,
                      nextId: next.id,
                      prevId: a.id,
                    });
                  }
                }
                k++;
              }
            }
          }
          s.gapsCache = gaps;
          s.lcRangesCache = groupUncertainRanges(order, segments as any);
        }),

      appendSegments: segs =>
        set(s => {
          if (!Array.isArray(segs) || segs.length === 0) return;
          let insertPos = s.order.length;
          for (let k = 0; k < segs.length; k++) {
            const p = segs[k];
            const newId = crypto.randomUUID();
            const newCue: SrtSegment = {
              id: newId,
              index: insertPos + 1,
              start: p.start,
              end: p.end,
              original: p.original,
              translation: '',
            } as SrtSegment;
            s.segments[newId] = newCue;
            s.order.push(newId);
            insertPos++;
          }
        }),

      // Batch-apply translations using timecode matching, with index fallback
      applyTranslations: segs =>
        set(s => {
          if (!Array.isArray(segs) || segs.length === 0) return;
          // Build quick lookups for incoming translations by time key and by index
          const byTime = new Map<string, string>();
          const byIndex = new Map<number, string>();
          for (const seg of segs) {
            const t = (seg.translation ?? '').trim();
            if (!t) continue;
            const timeKey = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
            if (!byTime.has(timeKey)) byTime.set(timeKey, t);
            if (typeof seg.index === 'number' && seg.index > 0) {
              if (!byIndex.has(seg.index)) byIndex.set(seg.index, t);
            }
          }
          if (byTime.size === 0 && byIndex.size === 0) return;

          // Walk current order once; update only changed entries
          for (const id of s.order) {
            const cue = s.segments[id];
            if (!cue) continue;
            const key = `${secondsToSrtTime(cue.start)}-->${secondsToSrtTime(cue.end)}`;
            let next = byTime.get(key);
            if (!next && typeof cue.index === 'number' && cue.index > 0) {
              next = byIndex.get(cue.index);
            }
            if (next && (cue.translation ?? '').trim() !== next) {
              cue.translation = next;
            }
          }
        }),

      // Efficiently append only the newly produced cues from a full SRT snapshot
      applyTranscriptionProgress: segs =>
        set(s => {
          if (!Array.isArray(segs) || segs.length === 0) return;
          const have = s.order.length;
          if (segs.length <= have) return; // nothing new
          let insertPos = have;
          for (let i = have; i < segs.length; i++) {
            const p = segs[i];
            const newId = crypto.randomUUID();
            const newCue: SrtSegment = {
              id: newId,
              index: insertPos + 1,
              start: p.start,
              end: p.end,
              original: p.original,
              translation: p.translation ?? '',
            } as SrtSegment;
            s.segments[newId] = newCue;
            s.order.push(newId);
            insertPos++;
          }
        }),

      bridgeGaps: (thresholdSec = 3) =>
        set(s => {
          const outOrder: string[] = [];
          const outSegments: SegmentMap = {} as any;

          const pushCue = (cue: SrtSegment) => {
            const id = cue.id ?? crypto.randomUUID();
            const norm: SrtSegment = { ...cue, id } as any;
            outSegments[id] = norm;
            outOrder.push(id);
          };
          let lastEnd: number | null = null;
          for (let i = 0; i < s.order.length; ) {
            const id = s.order[i];
            const cue = s.segments[id];
            if (!cue) {
              i++;
              continue;
            }
            const isEmpty = !String(cue.original || '').trim();

            if (isEmpty) {
              // Collapse consecutive empties and extend to next non-empty start if there's a hole
              const runStart = cue.start;
              let runEnd = cue.end;
              let j = i + 1;
              while (j < s.order.length) {
                const cid = s.order[j];
                const c = s.segments[cid];
                if (!c) {
                  j++;
                  continue;
                }
                const empty = !String(c.original || '').trim();
                if (empty) {
                  runEnd = Math.max(runEnd, c.end);
                  j++;
                  continue;
                }
                // Extend to next non-empty start if there's a time hole
                const extra = Math.max(0, c.start - runEnd);
                const finalEnd = extra > 0 ? c.start : runEnd;
                if (finalEnd - runStart >= thresholdSec) {
                  pushCue({
                    id: crypto.randomUUID(),
                    index: 0,
                    start: runStart,
                    end: finalEnd,
                    original: '',
                    translation: '',
                  } as any);
                  lastEnd = finalEnd;
                }
                break;
              }
              if (j >= s.order.length) {
                // Trailing empty run
                if (runEnd - runStart >= thresholdSec) {
                  pushCue({
                    id: crypto.randomUUID(),
                    index: 0,
                    start: runStart,
                    end: runEnd,
                    original: '',
                    translation: '',
                  } as any);
                  lastEnd = runEnd;
                }
              }
              i = j;
              continue;
            }

            if (lastEnd != null) {
              const gap = Math.max(0, cue.start - lastEnd);
              if (gap >= thresholdSec) {
                pushCue({
                  id: crypto.randomUUID(),
                  index: 0,
                  start: lastEnd,
                  end: cue.start,
                  original: '',
                  translation: '',
                } as any);
              }
            }

            pushCue(cue);
            lastEnd = cue.end;
            i++;
          }

          for (let k = 0; k < outOrder.length; k++) {
            outSegments[outOrder[k]].index = k + 1;
          }
          s.segments = outSegments;
          s.order = outOrder;
          s.sourceId += 1;
        }),
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
