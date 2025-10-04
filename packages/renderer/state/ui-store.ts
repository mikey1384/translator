import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { Draft, enableMapSet } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useSubStore } from './subtitle-store';
import { useTaskStore } from './task-store';
import { useUrlStore } from './url-store';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles';
import { sameArray } from '../utils/array';

interface State {
  showSettings: boolean;
  isFindBarVisible: boolean;
  searchText: string;
  activeMatchIndex: number;
  matchedIndices: number[];
  inputMode: 'file' | 'url';
  targetLanguage: string;
  summaryLanguage: string;
  showOriginalText: boolean;
  // Quality toggles
  qualityTranscription: boolean; // true = sequential/contextual
  qualityTranslation: boolean; // true = include review phase
  dubVoice: string;
  baseFontSize: number;
  subtitleStyle: SubtitleStylePresetKey;
  dubAmbientMix: number;
  // Merge options
  stylizeMerge: boolean;
  stylizeAspect: 'original' | 'vertical9x16';
  navTick: number;
  // Panel open states (session-only; not persisted)
  showGeneratePanel: boolean;
  showEditPanel: boolean;
  // Exclamation seen state (session-only; reset on video change)
  seenGaps: Set<string>;
  seenLC: Set<string>;
  // Transcription controls (session-only)
  transcriptionLanguage: string; // 'auto' | language token
}

// Enable Set/Map support in Immer (used for seenGaps/seenLC)
enableMapSet();

interface Actions {
  toggleSettings(show?: boolean): void;
  setFindBarVisible(visible: boolean): void;
  setSearchText(text: string): void;
  setActiveMatchIndex(index: number): void;
  setMatchedIndices(indices: number[]): void;
  handleFindNext(): void;
  handleFindPrev(): void;
  handleCloseFindBar(): void;
  handleReplaceAll(): void;
  setInputMode(mode: 'file' | 'url'): void;
  setTargetLanguage(lang: string): void;
  setSummaryLanguage(lang: string): void;
  setShowOriginalText(show: boolean): void;
  setQualityTranscription(v: boolean): void;
  setQualityTranslation(v: boolean): void;
  setDubVoice(voice: string): void;
  setDubAmbientMix(value: number): void;
  setStylizeMerge(v: boolean): void;
  setStylizeAspect(a: 'original' | 'vertical9x16'): void;
  setBaseFontSize(size: number): void;
  setSubtitleStyle(p: SubtitleStylePresetKey): void;
  setGeneratePanelOpen(open: boolean): void;
  setEditPanelOpen(open: boolean): void;
  // Exclamation helpers (session-only)
  markGapSeen(key: string): void;
  markLCSeen(key: string): void;
  resetExclamationState(): void;
  // Transcription controls setters
  setTranscriptionLanguage(lang: string): void;
}

const TARGET_LANG_KEY = 'savedTargetLanguage';
const SUMMARY_LANG_KEY = 'savedSummaryLanguage';
const SHOW_ORIGINAL_KEY = 'savedShowOriginalText';
const QUALITY_TRANSCRIPTION_KEY = 'savedQualityTranscription';
const QUALITY_TRANSLATION_KEY = 'savedQualityTranslation';
const DUB_VOICE_KEY = 'savedDubVoice';
const DUB_AMBIENT_MIX_KEY = 'savedDubAmbientMix';
const DEFAULT_DUB_VOICE = 'alloy';

const ALLOWED_DUB_VOICES = new Set([
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
]);
// Note: We intentionally do NOT persist panel open states across reloads.

const initial: State = {
  showSettings: false,
  isFindBarVisible: false,
  searchText: '',
  activeMatchIndex: 0,
  matchedIndices: [],
  navTick: 0,
  inputMode: 'file',
  targetLanguage: localStorage.getItem(TARGET_LANG_KEY) ?? 'original',
  summaryLanguage: localStorage.getItem(SUMMARY_LANG_KEY) ?? 'english',
  showOriginalText: JSON.parse(
    localStorage.getItem(SHOW_ORIGINAL_KEY) ?? 'true'
  ),
  qualityTranscription: JSON.parse(
    localStorage.getItem(QUALITY_TRANSCRIPTION_KEY) ?? 'false'
  ),
  qualityTranslation: JSON.parse(
    localStorage.getItem(QUALITY_TRANSLATION_KEY) ?? 'false'
  ),
  dubVoice: (() => {
    const stored = localStorage.getItem(DUB_VOICE_KEY);
    return stored && ALLOWED_DUB_VOICES.has(stored)
      ? stored
      : DEFAULT_DUB_VOICE;
  })(),
  dubAmbientMix: (() => {
    const raw = localStorage.getItem(DUB_AMBIENT_MIX_KEY);
    const parsed = raw != null ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed)) return 0.35;
    return Math.min(1, Math.max(0, parsed));
  })(),
  stylizeMerge: JSON.parse(localStorage.getItem('savedStylizeMerge') ?? 'false'),
  stylizeAspect:
    (localStorage.getItem('savedStylizeAspect') as any) === 'vertical9x16'
      ? 'vertical9x16'
      : 'original',
  baseFontSize: Number(localStorage.getItem('savedMergeFontSize')) || 24,
  subtitleStyle:
    (localStorage.getItem('savedMergeStylePreset') as SubtitleStylePresetKey) ||
    'Default',
  showGeneratePanel: false,
  showEditPanel: false,
  seenGaps: new Set<string>(),
  seenLC: new Set<string>(),
  transcriptionLanguage: 'auto',
};

const resetSearchState = (s: Draft<State>) => {
  s.searchText = '';
  s.matchedIndices = [];
  s.activeMatchIndex = 0;
};

export const useUIStore = createWithEqualityFn<State & Actions>()(
  subscribeWithSelector(
    immer((set, get) => {
      return {
        ...initial,

        toggleSettings(show) {
          set({
            showSettings: show !== undefined ? show : !get().showSettings,
          });
        },

        setFindBarVisible(visible) {
          set(s => {
            s.isFindBarVisible = visible;
            if (!visible) {
              resetSearchState(s);
            }
          });
        },

        setSearchText(text) {
          set(s => {
            s.searchText = text;
            s.activeMatchIndex = 0;
            s.matchedIndices = [];
          });
        },

        setActiveMatchIndex(index) {
          set(s => {
            s.activeMatchIndex = index;
            s.navTick++;
          });
        },

        setMatchedIndices(indices) {
          set(draft => {
            if (!sameArray(draft.matchedIndices, indices)) {
              draft.matchedIndices = indices;
            }

            if (indices.length === 0) {
              draft.activeMatchIndex = 0;
            }
          });
        },

        handleFindNext() {
          const { matchedIndices, activeMatchIndex } = get();
          if (matchedIndices.length === 0) return;
          const next = (activeMatchIndex + 1) % matchedIndices.length;
          set(s => {
            s.activeMatchIndex = next;
            s.navTick++;
          });
        },

        handleFindPrev() {
          const { matchedIndices, activeMatchIndex } = get();
          if (matchedIndices.length === 0) return;
          const prev =
            (activeMatchIndex - 1 + matchedIndices.length) %
            matchedIndices.length;
          set(s => {
            s.activeMatchIndex = prev;
            s.navTick++;
          });
        },

        handleCloseFindBar() {
          get().setFindBarVisible(false);
        },

        handleReplaceAll() {
          const { searchText } = get();
          if (!searchText.trim()) return;
          const replaceWith = prompt('Replace with:', '');
          if (replaceWith !== null) {
            useSubStore.getState().replaceAll(searchText, replaceWith);
          }
        },

        setInputMode(mode) {
          set({ inputMode: mode });
        },

        setTargetLanguage(lang) {
          localStorage.setItem(TARGET_LANG_KEY, lang);
          set({ targetLanguage: lang });
        },

        setSummaryLanguage(lang) {
          localStorage.setItem(SUMMARY_LANG_KEY, lang);
          set({ summaryLanguage: lang });
        },

        setShowOriginalText(show) {
          localStorage.setItem(SHOW_ORIGINAL_KEY, JSON.stringify(show));
          set({ showOriginalText: show });
        },

        setQualityTranscription(v) {
          localStorage.setItem(QUALITY_TRANSCRIPTION_KEY, JSON.stringify(v));
          set({ qualityTranscription: v });
        },

        setQualityTranslation(v) {
          localStorage.setItem(QUALITY_TRANSLATION_KEY, JSON.stringify(v));
          set({ qualityTranslation: v });
        },

        setDubVoice(voice) {
          const next = ALLOWED_DUB_VOICES.has(voice)
            ? voice
            : DEFAULT_DUB_VOICE;
          localStorage.setItem(DUB_VOICE_KEY, next);
          set({ dubVoice: next });
        },

        setDubAmbientMix(value) {
          if (!Number.isFinite(value)) return;
          const clamped = Math.min(1, Math.max(0, value));
          localStorage.setItem(DUB_AMBIENT_MIX_KEY, String(clamped));
          set({ dubAmbientMix: clamped });
        },

        setStylizeMerge(v) {
          if (v) {
            // Strict gating: require completed transcription and required word timings
            try {
              const inProgress = useTaskStore.getState().transcription.inProgress;
              if (inProgress) {
                useUrlStore.getState().setError(
                  'Stylize requires completed transcription with per-word timings.'
                );
                return;
              }
            } catch {}

            const state = useSubStore.getState();
            const segs = state.order.map(id => state.segments[id]);
            const hasAnyTranslation = segs.some(s => (s.translation || '').trim().length > 0);
            const showOriginal = get().showOriginalText;

            const hasOrigWords = (s: any) => Array.isArray(s?.origWords) && s.origWords.length > 0;
            const hasTransWords = (s: any) => Array.isArray(s?.transWords) && s.transWords.length > 0;

            if (!hasAnyTranslation) {
              // Transcription-only: require origWords on all segments with original text
              const missing = segs.filter(s => (s.original || '').trim().length > 0 && !hasOrigWords(s));
              if (missing.length) {
                useUrlStore.getState().setError(
                  `Stylize requires per-word timings for original lines. Missing on ${missing.length} segment(s).`
                );
                return;
              }
            } else if (showOriginal) {
              // Dual mode: require both origWords and transWords where lines have text
              const missOrig = segs.filter(s => (s.original || '').trim().length > 0 && !hasOrigWords(s));
              const missTrans = segs.filter(s => (s.translation || '').trim().length > 0 && !hasTransWords(s));
              if (missOrig.length || missTrans.length) {
                useUrlStore.getState().setError(
                  `Stylize (dual) requires per-word timings on both lines. Missing original=${missOrig.length}, translation=${missTrans.length}.`
                );
                return;
              }
            } else {
              // Translation-only: require transWords on all segments with translation text
              const missing = segs.filter(s => (s.translation || '').trim().length > 0 && !hasTransWords(s));
              if (missing.length) {
                useUrlStore.getState().setError(
                  `Stylize requires per-word timings for translation lines. Missing on ${missing.length} segment(s).`
                );
                return;
              }
            }
          }

          localStorage.setItem('savedStylizeMerge', JSON.stringify(!!v));
          set({ stylizeMerge: !!v });
        },

        setBaseFontSize(size) {
          set({ baseFontSize: size });
        },

        setSubtitleStyle(p) {
          set({ subtitleStyle: p });
        },

        setGeneratePanelOpen(open) {
          set({ showGeneratePanel: open });
        },

        setEditPanelOpen(open) {
          set({ showEditPanel: open });
        },

        // Exclamation helpers
        markGapSeen(key: string) {
          set(s => {
            const next = new Set(s.seenGaps);
            next.add(key);
            s.seenGaps = next;
          });
        },

        markLCSeen(key: string) {
          set(s => {
            const next = new Set(s.seenLC);
            next.add(key);
            s.seenLC = next;
          });
        },

        resetExclamationState() {
          set(s => {
            s.seenGaps = new Set();
            s.seenLC = new Set();
          });
        },

        setTranscriptionLanguage(lang: string) {
          set({ transcriptionLanguage: lang || 'auto' });
        },

        setStylizeAspect(a) {
          const next = a === 'vertical9x16' ? 'vertical9x16' : 'original';
          localStorage.setItem('savedStylizeAspect', next);
          set({ stylizeAspect: next });
        },
      };
    })
  )
);

useUIStore.subscribe(s => {
  localStorage.setItem('savedMergeFontSize', String(s.baseFontSize));
  localStorage.setItem('savedMergeStylePreset', s.subtitleStyle);
});

export const useSubtitlePrefs = () =>
  useUIStore(s => ({
    baseFontSize: s.baseFontSize,
    subtitleStyle: s.subtitleStyle,
    showOriginal: s.showOriginalText,
  }));
