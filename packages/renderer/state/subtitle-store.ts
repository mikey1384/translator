import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { subscribeWithSelector } from 'zustand/middleware';
import {
  SrtSegment,
  StoredSubtitleKind,
  SubtitleDisplayMode,
  SubtitleDocumentMeta,
  SubtitleDocumentLinkedFileRole,
  SubtitleSourceProvenance,
} from '@shared-types/app';
import { shallow } from 'zustand/shallow';
import { getNativePlayerInstance } from '../native-player.js';
import { scrollPrecisely, flashSubtitle } from '../utils/scroll.js';
import { secondsToSrtTime } from '../../shared/helpers';
import { normalizeTranscriptionCoverage } from '../../shared/helpers/transcription-coverage';
import { replaceMatches, type FindOptions } from '../utils/subtitleFind.js';
import {
  mergeCues,
  splitCue,
  type SplitField,
} from '../utils/subtitle-split-merge.js';
import {
  applySegmentPatchWithWordTimings,
  sanitizeRelativeWordTimings,
} from '../../shared/helpers/word-timing.js';
import {
  groupWhisperReviewRanges,
  shouldUseWhisperReviewHints,
} from '../utils/subtitle-heuristics';

type SegmentMap = Record<string, SrtSegment>;

interface State {
  transcriptionCoverage:
    | import('@shared-types/app').TranscriptionCoverage
    | null;
  segments: SegmentMap;
  order: string[];
  activeId: string | null;
  playingId: string | null;
  _abortPlayListener?: () => void;
  sourceId: number;
  /** Changes only on document load, unlike sourceId's edit/refresh counter. */
  documentGeneration: number;
  documentId: string | null;
  documentTitle: string | null;
  originalPath: string | null;
  activeFilePath: string | null;
  activeFileMode: SubtitleDisplayMode | null;
  activeFileRole: SubtitleDocumentLinkedFileRole | null;
  exportPath: string | null;
  origin: 'fresh' | 'disk' | null;
  // When origin is 'fresh', record the video file path this set of subtitles was generated for
  sourceVideoPath: string | null;
  sourceVideoAssetIdentity: string | null;
  sourceUrl: string | null;
  sourceProvenance: SubtitleSourceProvenance | null;
  subtitleKind: StoredSubtitleKind | null;
  targetLanguage: string | null;
  transcriptionEngine: 'elevenlabs' | 'whisper' | null;
  libraryEntryId: string | null;
  libraryKind: StoredSubtitleKind | null;
  /** True once the user changes the mounted subtitles; cleared by load/save. */
  dirty: boolean;
  /** Bumped on every user edit, so a save only clears edits it captured. */
  editRevision: number;
  /** Number of structural edits that `undo` can take back. */
  undoDepth: number;
  /** What the most recent undoable edit was, for the Undo prompt. */
  lastUndoable: { kind: UndoableEditKind; at: number } | null;
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

export type UndoableEditKind =
  | 'remove'
  | 'insert'
  | 'replaceAll'
  | 'shift'
  | 'shiftAll'
  | 'improve'
  | 'split'
  | 'merge';

interface Actions {
  setTranscriptionCoverage: (
    coverage: import('@shared-types/app').TranscriptionCoverage | null
  ) => void;
  /** Clears `dirty` when no edit happened after `revision` was read. */
  markSaved: (revision: number) => void;
  /** Takes back the last structural edit. Returns false when none is left. */
  undo: () => boolean;
  load: (
    segs: SrtSegment[],
    srcPath?: string | null,
    origin?: 'fresh' | 'disk' | null,
    videoPathRef?: string | null,
    transcriptionEngine?: 'elevenlabs' | 'whisper' | null,
    libraryMeta?: {
      entryId?: string | null;
      kind?: StoredSubtitleKind | null;
      targetLanguage?: string | null;
    } | null,
    videoAssetIdentityRef?: string | null,
    documentMeta?: Partial<SubtitleDocumentMeta> | null
  ) => void;
  setDocumentMeta: (
    documentMeta?: Partial<SubtitleDocumentMeta> | null
  ) => void;
  setActiveFileTarget: (args?: {
    filePath?: string | null;
    mode?: SubtitleDisplayMode | null;
    role?: SubtitleDocumentLinkedFileRole | null;
  }) => void;
  setExportPath: (
    exportPath?: string | null,
    mode?: SubtitleDisplayMode | null,
    role?: SubtitleDocumentLinkedFileRole | null
  ) => void;
  // Clear Whisper review state when it is no longer valid for the current source
  clearConfidence: () => void;
  // Compute and cache Gap/LC once per transcription/improve flow
  recomputeCaches: (gapThresholdSec?: number) => void;
  // Flush cached Gap/LC (e.g., on video change)
  clearCaches: () => void;
  update: (id: string, patch: Partial<SrtSegment>) => void;
  insertAfter: (id: string) => string | null;
  remove: (id: string) => void;
  /** Splits a line at the caret (see `splitCue`); returns the new line's id. */
  split: (
    id: string,
    options?: { field?: SplitField; caret?: number | null }
  ) => string | null;
  /** Merges a line with the one after it. Returns false when there is none. */
  mergeWithNext: (id: string) => boolean;
  shift: (id: string, secs: number) => void;
  shiftAll: (offsetSeconds: number) => void;
  scrollToCurrent: () => void;
  setActive: (id: string | null) => void;
  seek: (id: string) => void;
  play: (id: string) => void;
  pause: () => void;
  incSourceId: () => void;
  replaceAll: (find: string, replace: string, options?: FindOptions) => void;
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
      id?: string;
      start: number;
      end: number;
      translation?: string | undefined;
      index?: number;
    }>,
    /**
     * Match by line number when times differ. Only safe when the update
     * covers the whole list; a subset numbered 1..N would hit the wrong rows.
     */
    options?: { matchByIndex?: boolean; markDirty?: boolean }
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
  documentGeneration: 0,
  documentId: null,
  documentTitle: null,
  originalPath: null,
  activeFilePath: null,
  activeFileMode: null,
  activeFileRole: null,
  exportPath: null,
  origin: null,
  sourceVideoPath: null,
  sourceVideoAssetIdentity: null,
  sourceUrl: null,
  sourceProvenance: null,
  subtitleKind: null,
  targetLanguage: null,
  transcriptionEngine: null,
  transcriptionCoverage: null,
  libraryEntryId: null,
  libraryKind: null,
  dirty: false,
  editRevision: 0,
  undoDepth: 0,
  lastUndoable: null,
  gapsCache: [],
  lcRangesCache: [],
};

// Snapshots of (immutable, structurally shared) segments/order taken before
// structural edits. Kept outside the store so Immer never drafts them.
const UNDO_LIMIT = 30;
let undoStack: Array<{
  segments: SegmentMap;
  order: string[];
  kind: UndoableEditKind;
}> = [];

/** Forget undo history (subtitles unmounted outside `load`). */
export function clearSubtitleUndoHistory(): void {
  undoStack = [];
}

function rememberForUndo(kind: UndoableEditKind): void {
  const { segments, order } = useSubStore.getState();
  undoStack.push({ segments, order, kind });
  if (undoStack.length > UNDO_LIMIT) undoStack = undoStack.slice(-UNDO_LIMIT);
  useSubStore.setState({
    undoDepth: undoStack.length,
    lastUndoable: { kind, at: Date.now() },
  });
}

function markEdited(s: { dirty: boolean; editRevision: number }): void {
  s.dirty = true;
  s.editRevision += 1;
}

/** Patches that only carry transient UI fields (e.g. `_oldText`) aren't edits. */
function isUserContentPatch(patch: Partial<SrtSegment>): boolean {
  return Object.keys(patch).some(key => !key.startsWith('_'));
}

function areEquivalentSubtitleDocs(
  previousOrder: string[],
  previousSegments: SegmentMap,
  nextSegments: SrtSegment[]
): boolean {
  if (previousOrder.length !== nextSegments.length) {
    return false;
  }

  for (let i = 0; i < nextSegments.length; i++) {
    const previous = previousSegments[previousOrder[i]];
    const next = nextSegments[i];
    if (!previous || !next) {
      return false;
    }
    if (
      previous.start !== next.start ||
      previous.end !== next.end ||
      (previous.original ?? '') !== (next.original ?? '') ||
      (previous.translation ?? '') !== (next.translation ?? '')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Replace every occurrence of `find` (plain text, case-insensitive unless
 * `options.matchCase`) with `replace` (plain text: "$" is just a dollar sign;
 * empty deletes).
 */
export function replaceLiteral(
  text: string,
  find: string,
  replace: string,
  options: FindOptions = {}
) {
  if (!find) return text;
  return replaceMatches(text, find, replace, options);
}

export const useSubStore = createWithEqualityFn<State & Actions>()(
  subscribeWithSelector(
    immer((set, get) => ({
      ...initialState,
      markSaved: revision =>
        set(s => {
          if (s.editRevision === revision) s.dirty = false;
        }),

      undo: () => {
        const snapshot = undoStack.pop();
        if (!snapshot) return false;
        set(s => {
          s.segments = snapshot.segments;
          s.order = snapshot.order;
          s.sourceId += 1;
          s.undoDepth = undoStack.length;
          // Keep offering Undo for the step before, so several edits can
          // be taken back one after another.
          const previous = undoStack[undoStack.length - 1];
          s.lastUndoable = previous
            ? { kind: previous.kind, at: Date.now() }
            : null;
          markEdited(s);
        });
        return true;
      },

      setTranscriptionCoverage: coverage =>
        set(s => {
          s.transcriptionCoverage = normalizeTranscriptionCoverage(coverage);
        }),

      load: (
        segs,
        srcPath = null,
        loadOrigin = null,
        videoPathRef = null,
        transcriptionEngine,
        libraryMeta = null,
        videoAssetIdentityRef,
        documentMeta = null
      ) => {
        set(s => {
          const isDiskBackedLoad =
            loadOrigin === 'disk' ||
            (typeof srcPath === 'string' && srcPath.length > 0);
          const isEquivalentDocument = areEquivalentSubtitleDocs(
            s.order,
            s.segments,
            segs
          );
          const preserveExistingEngine =
            transcriptionEngine === undefined &&
            !isDiskBackedLoad &&
            isEquivalentDocument;
          const nextTranscriptionEngine =
            transcriptionEngine !== undefined
              ? (transcriptionEngine ?? null)
              : preserveExistingEngine
                ? s.transcriptionEngine
                : null;
          const preserveExistingLibraryMeta =
            !isDiskBackedLoad && libraryMeta == null && isEquivalentDocument;
          const nextLibraryEntryId =
            libraryMeta && 'entryId' in libraryMeta
              ? (libraryMeta.entryId ?? null)
              : preserveExistingLibraryMeta
                ? s.libraryEntryId
                : null;
          const nextLibraryKind =
            libraryMeta && 'kind' in libraryMeta
              ? (libraryMeta.kind ?? null)
              : preserveExistingLibraryMeta
                ? s.libraryKind
                : null;
          const preserveExistingVariantMeta =
            !isDiskBackedLoad &&
            libraryMeta == null &&
            documentMeta == null &&
            isEquivalentDocument;
          const nextSubtitleKind =
            documentMeta && 'subtitleKind' in documentMeta
              ? (documentMeta.subtitleKind ?? null)
              : libraryMeta && 'kind' in libraryMeta
                ? (libraryMeta.kind ?? null)
                : preserveExistingVariantMeta
                  ? s.subtitleKind
                  : null;
          const nextTargetLanguage =
            documentMeta && 'targetLanguage' in documentMeta
              ? (documentMeta.targetLanguage ?? null)
              : libraryMeta && 'targetLanguage' in libraryMeta
                ? (libraryMeta.targetLanguage ?? null)
                : preserveExistingVariantMeta
                  ? s.targetLanguage
                  : null;
          const preserveExistingDocumentMeta =
            documentMeta == null && isEquivalentDocument;
          const nextDocumentId =
            documentMeta && 'id' in documentMeta
              ? (documentMeta.id ?? null)
              : preserveExistingDocumentMeta
                ? s.documentId
                : null;
          const nextDocumentTitle =
            documentMeta && 'title' in documentMeta
              ? (documentMeta.title ?? null)
              : preserveExistingDocumentMeta
                ? s.documentTitle
                : null;
          const nextOriginalPath =
            documentMeta?.importFilePath !== undefined
              ? (documentMeta.importFilePath ?? null)
              : (srcPath ?? (isEquivalentDocument ? s.originalPath : null));
          const nextActiveFilePath =
            srcPath ??
            documentMeta?.activeLinkedFilePath ??
            (isEquivalentDocument ? s.activeFilePath : null) ??
            null;
          const preserveExistingActiveFileMeta =
            !isDiskBackedLoad && isEquivalentDocument;
          const nextActiveFileMode =
            nextActiveFilePath &&
            documentMeta?.activeLinkedFilePath === nextActiveFilePath
              ? (documentMeta.activeLinkedFileMode ?? null)
              : preserveExistingActiveFileMeta
                ? s.activeFileMode
                : null;
          const nextActiveFileRole =
            nextActiveFilePath &&
            documentMeta?.activeLinkedFilePath === nextActiveFilePath
              ? (documentMeta.activeLinkedFileRole ?? null)
              : preserveExistingActiveFileMeta
                ? s.activeFileRole
                : null;
          let nextExportPath =
            documentMeta?.lastExportPath ??
            (isEquivalentDocument ? s.exportPath : null);
          if (!documentMeta && isDiskBackedLoad && srcPath) {
            nextExportPath = srcPath;
          }
          const nextSourceVideoPath =
            typeof videoPathRef === 'string'
              ? videoPathRef
              : documentMeta?.sourceVideoPath !== undefined
                ? (documentMeta.sourceVideoPath ?? null)
                : isDiskBackedLoad && isEquivalentDocument
                  ? (s.sourceVideoPath ?? null)
                  : isDiskBackedLoad
                    ? null
                    : (s.sourceVideoPath ?? null);
          const shouldPreserveExistingVideoAssetIdentity =
            typeof videoPathRef === 'string'
              ? s.sourceVideoPath === videoPathRef
              : !isDiskBackedLoad || isEquivalentDocument;
          const nextSourceVideoAssetIdentity =
            videoAssetIdentityRef !== undefined
              ? (videoAssetIdentityRef ?? null)
              : documentMeta?.sourceVideoAssetIdentity !== undefined
                ? (documentMeta.sourceVideoAssetIdentity ?? null)
                : shouldPreserveExistingVideoAssetIdentity
                  ? (s.sourceVideoAssetIdentity ?? null)
                  : null;
          const nextSourceUrl =
            documentMeta?.sourceUrl !== undefined
              ? (documentMeta.sourceUrl ?? null)
              : !isDiskBackedLoad || isEquivalentDocument
                ? (s.sourceUrl ?? null)
                : null;
          const nextSourceProvenance =
            documentMeta && 'sourceProvenance' in documentMeta
              ? (documentMeta.sourceProvenance ?? null)
              : documentMeta == null && isEquivalentDocument
                ? (s.sourceProvenance ?? null)
                : null;

          s.segments = segs.reduce<SegmentMap>((acc, cue, i) => {
            acc[cue.id] = { ...cue, index: i + 1 };
            return acc;
          }, {});
          s.order = segs.map(cue => cue.id);
          s.sourceId += 1;
          s.documentGeneration += 1;
          s.documentId = nextDocumentId;
          s.documentTitle = nextDocumentTitle;
          s.originalPath = nextOriginalPath;
          s.activeFilePath = nextActiveFilePath;
          s.activeFileMode = nextActiveFileMode;
          s.activeFileRole = nextActiveFileRole;
          s.exportPath = nextExportPath;
          // Preserve previous origin if not explicitly provided and no srcPath indicates disk
          s.origin = loadOrigin ?? (srcPath ? 'disk' : (s.origin ?? null));
          // Disk-backed subtitle loads should not inherit a stale video
          // association unless the caller explicitly provides one.
          s.sourceVideoPath = nextSourceVideoPath;
          s.sourceVideoAssetIdentity = nextSourceVideoAssetIdentity;
          s.sourceUrl = nextSourceUrl;
          s.sourceProvenance = nextSourceProvenance;
          s.subtitleKind = nextSubtitleKind;
          s.targetLanguage = nextTargetLanguage;
          // Replacing the subtitle set should clear engine-specific UI state
          // unless the caller explicitly carries the engine forward.
          s.transcriptionEngine = nextTranscriptionEngine;
          s.transcriptionCoverage =
            documentMeta?.transcriptionCoverage !== undefined
              ? normalizeTranscriptionCoverage(
                  documentMeta.transcriptionCoverage
                )
              : !isDiskBackedLoad && preserveExistingDocumentMeta
                ? s.transcriptionCoverage
                : null;
          s.libraryEntryId = nextLibraryEntryId;
          s.libraryKind = nextLibraryKind;
          // Do not auto-regenerate caches here; generated during transcription flows
          s.gapsCache = [];
          s.lcRangesCache = [];
          // A freshly loaded document matches what is stored.
          s.dirty = false;
          s.undoDepth = 0;
          s.lastUndoable = null;
        });
        undoStack = [];
      },

      setDocumentMeta: documentMeta =>
        set(s => {
          s.documentId = documentMeta?.id ?? null;
          s.documentTitle = documentMeta?.title ?? null;
          if (documentMeta == null) {
            s.transcriptionCoverage = null;
            s.subtitleKind = null;
            s.targetLanguage = null;
            s.sourceProvenance = null;
          } else {
            if (documentMeta.transcriptionCoverage !== undefined) {
              s.transcriptionCoverage = normalizeTranscriptionCoverage(
                documentMeta.transcriptionCoverage
              );
            }
            if (documentMeta.subtitleKind !== undefined) {
              s.subtitleKind = documentMeta.subtitleKind ?? null;
            }
            if (documentMeta.targetLanguage !== undefined) {
              s.targetLanguage = documentMeta.targetLanguage ?? null;
            }
            if (documentMeta.sourceProvenance !== undefined) {
              s.sourceProvenance = documentMeta.sourceProvenance ?? null;
            }
          }
          if (documentMeta?.importFilePath !== undefined) {
            s.originalPath = documentMeta.importFilePath ?? null;
          }
          if (documentMeta?.lastExportPath !== undefined) {
            s.exportPath = documentMeta.lastExportPath ?? null;
          }
          if (documentMeta?.sourceVideoPath !== undefined) {
            s.sourceVideoPath = documentMeta.sourceVideoPath ?? null;
          }
          if (documentMeta?.sourceVideoAssetIdentity !== undefined) {
            s.sourceVideoAssetIdentity =
              documentMeta.sourceVideoAssetIdentity ?? null;
          }
          if (documentMeta?.sourceUrl !== undefined) {
            s.sourceUrl = documentMeta.sourceUrl ?? null;
          }
        }),

      setActiveFileTarget: args =>
        set(s => {
          const normalizedPath = args?.filePath
            ? String(args.filePath).trim()
            : null;
          s.activeFilePath = normalizedPath;
          s.activeFileMode = normalizedPath ? (args?.mode ?? null) : null;
          s.activeFileRole = normalizedPath ? (args?.role ?? null) : null;
        }),

      setExportPath: (exportPath, mode, role = 'export') =>
        set(s => {
          const normalized = exportPath ? String(exportPath).trim() : null;
          s.exportPath = normalized;
          s.activeFilePath = normalized;
          s.activeFileMode = normalized ? (mode ?? null) : null;
          s.activeFileRole = normalized ? role : null;
        }),

      clearConfidence: () =>
        set(s => {
          for (const id of s.order) {
            const cue = s.segments[id];
            if (!cue) continue;
            // Remove transient Whisper review hints, but keep durable word timing
            // metadata because save/reopen and timed original renders depend on it.
            delete (cue as any).avg_logprob;
            delete (cue as any).no_speech_prob;
          }
          s.transcriptionEngine = null;
          s.lcRangesCache = [];
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
          s.lcRangesCache = shouldUseWhisperReviewHints(s.transcriptionEngine)
            ? groupWhisperReviewRanges(order, segments as any)
            : [];
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
          if (!cue) return;

          state.segments[id] = applySegmentPatchWithWordTimings(cue, patch);
          if (isUserContentPatch(patch)) markEdited(state);
        }),

      insertAfter: (id: string) => {
        let newCueId: string | null = null;
        if (!get().segments[id]) return null;
        rememberForUndo('insert');
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
          markEdited(s);
        });
        return newCueId;
      },

      remove: id => {
        if (!get().segments[id]) return;
        rememberForUndo('remove');
        set(s => {
          const i = s.order.findIndex(cueId => cueId === id);
          if (i === -1) return;

          delete s.segments[id];
          s.order.splice(i, 1);
          s.order = [...s.order];

          for (let j = i; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
          markEdited(s);
        });
      },

      split: (id, options) => {
        const cue = get().segments[id];
        if (!cue) return null;
        const pieces = splitCue(cue, {
          field: options?.field,
          caret: options?.caret,
          newId: crypto.randomUUID(),
        });
        if (!pieces) return null;
        rememberForUndo('split');
        const [first, second] = pieces;
        set(s => {
          const i = s.order.indexOf(id);
          if (i === -1) return;
          s.segments[id] = first;
          s.segments[second.id] = second;
          s.order.splice(i + 1, 0, second.id);
          s.order = [...s.order];
          for (let j = i; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
          markEdited(s);
        });
        return second.id;
      },

      mergeWithNext: id => {
        const { order, segments } = get();
        const i = order.indexOf(id);
        const nextId = i === -1 ? undefined : order[i + 1];
        if (!nextId || !segments[id] || !segments[nextId]) return false;
        rememberForUndo('merge');
        const merged = mergeCues(segments[id], segments[nextId]);
        set(s => {
          const at = s.order.indexOf(id);
          if (at === -1) return;
          s.segments[id] = merged;
          delete s.segments[nextId];
          s.order.splice(at + 1, 1);
          s.order = [...s.order];
          for (let j = at; j < s.order.length; j++) {
            s.segments[s.order[j]].index = j + 1;
          }
          markEdited(s);
        });
        return true;
      },

      shift: (id, secs) => {
        if (!get().segments[id]) return;
        rememberForUndo('shift');
        set(s => {
          const cue = s.segments[id];
          if (!cue) return;
          const dur = cue.end - cue.start;
          const newStart = Math.max(0, cue.start + secs);
          cue.start = newStart;
          cue.end = newStart + dur;
          cue.words = sanitizeRelativeWordTimings(cue.words, dur);
          markEdited(s);
        });
      },

      shiftAll: offsetSeconds => {
        if (get().order.length === 0) return;
        rememberForUndo('shiftAll');
        set(s => {
          Object.values(s.segments).forEach(cue => {
            const dur = cue.end - cue.start;
            const newStart = Math.max(0, cue.start + offsetSeconds);
            cue.start = newStart;
            cue.end = newStart + dur;
            cue.words = sanitizeRelativeWordTimings(cue.words, dur);
          });
          markEdited(s);
        });
      },

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

      replaceAll: (find, replace, options = {}) => {
        if (!find.trim()) return;
        rememberForUndo('replaceAll');
        set(s => {
          Object.values(s.segments).forEach(cue => {
            const nextOriginal = replaceLiteral(
              cue.original,
              find,
              replace,
              options
            );
            if (nextOriginal !== cue.original) {
              cue.original = nextOriginal;
              cue.words = undefined;
            }
            if (cue.translation) {
              cue.translation = replaceLiteral(
                cue.translation,
                find,
                replace,
                options
              );
            }
          });
          s.sourceId += 1;
          markEdited(s);
        });
      },

      replaceWithSegments: (id, segs) => {
        if (!Array.isArray(segs) || segs.length === 0 || !get().segments[id]) {
          return;
        }
        rememberForUndo('improve');
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
          base.words = undefined;
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
          s.lcRangesCache = shouldUseWhisperReviewHints(s.transcriptionEngine)
            ? groupWhisperReviewRanges(order, segments as any)
            : [];
          markEdited(s);
        });
      },

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
      applyTranslations: (segs, options) =>
        set(s => {
          const matchByIndex = options?.matchByIndex !== false;
          if (!Array.isArray(segs) || segs.length === 0) return;
          // Build quick lookups for incoming translations by time key and by index
          const byTime = new Map<string, string>();
          const byIndex = new Map<number, string>();
          const byId = new Map<string, string>();
          const hasStableIds = segs.some(seg =>
            Boolean(seg.id && s.segments[seg.id])
          );
          for (const seg of segs) {
            const t = (seg.translation ?? '').trim();
            if (!t) continue;
            if (seg.id) byId.set(seg.id, t);
            const timeKey = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(seg.end)}`;
            if (!byTime.has(timeKey)) byTime.set(timeKey, t);
            if (typeof seg.index === 'number' && seg.index > 0) {
              if (!byIndex.has(seg.index)) byIndex.set(seg.index, t);
            }
          }
          if (byTime.size === 0 && byIndex.size === 0) return;
          if (options?.markDirty) markEdited(s);

          // Walk current order once; update only changed entries
          for (const id of s.order) {
            const cue = s.segments[id];
            if (!cue) continue;
            const key = `${secondsToSrtTime(cue.start)}-->${secondsToSrtTime(cue.end)}`;
            let next = hasStableIds ? byId.get(id) : byTime.get(key);
            if (
              !next &&
              !hasStableIds &&
              matchByIndex &&
              typeof cue.index === 'number' &&
              cue.index > 0
            ) {
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
