import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { Draft, enableMapSet } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useSubStore } from './subtitle-store';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles';
import { sameArray } from '../utils/array';
import type { SummaryEffortLevel } from '@shared-types/app';

interface State {
  showSettings: boolean;
  isFindBarVisible: boolean;
  searchText: string;
  activeMatchIndex: number;
  matchedIndices: number[];
  inputMode: 'file' | 'url';
  targetLanguage: string;
  summaryLanguage: string;
  summaryEffortLevel: SummaryEffortLevel;
  showOriginalText: boolean;
  // Quality toggles
  qualityTranscription: boolean; // true = sequential/contextual
  qualityTranslation: boolean; // true = include review phase
  dubVoice: string;
  baseFontSize: number;
  subtitleStyle: SubtitleStylePresetKey;
  dubAmbientMix: number;
  navTick: number;
  // Panel open states (session-only; not persisted)
  showGeneratePanel: boolean;
  showEditPanel: boolean;
  // Exclamation seen state (session-only; reset on video change)
  seenGaps: Set<string>;
  seenLC: Set<string>;
  // Transcription controls (session-only)
  transcriptionLanguage: string; // 'auto' | language token
  previewSubtitleFontPx: number;
  previewDisplayHeightPx: number;
  previewVideoHeightPx: number;
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
  setSummaryEffortLevel(level: SummaryEffortLevel): void;
  setShowOriginalText(show: boolean): void;
  setQualityTranscription(v: boolean): void;
  setQualityTranslation(v: boolean): void;
  setDubVoice(voice: string): void;
  setDubAmbientMix(value: number): void;
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
  setPreviewSubtitleMetrics(
    fontPx: number,
    displayHeightPx: number,
    videoHeightPx: number
  ): void;
}

const TARGET_LANG_KEY = 'savedTargetLanguage';
const SUMMARY_LANG_KEY = 'savedSummaryLanguage';
const SUMMARY_EFFORT_KEY = 'savedSummaryEffortLevel';
const SHOW_ORIGINAL_KEY = 'savedShowOriginalText';
const QUALITY_TRANSCRIPTION_KEY = 'savedQualityTranscription';
const QUALITY_TRANSLATION_KEY = 'savedQualityTranslation';
const DUB_VOICE_KEY = 'savedDubVoice';
const DUB_AMBIENT_MIX_KEY = 'savedDubAmbientMix';
const DEFAULT_DUB_VOICE = 'rachel';

/** Safely parse a boolean from localStorage with fallback */
function parseStoredBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'boolean' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ElevenLabs voices (primary provider)
const ALLOWED_DUB_VOICES = new Set([
  'rachel',
  'adam',
  'josh',
  'bella',
  'antoni',
  'domi',
  'elli',
  'arnold',
  'sam',
  // Legacy OpenAI voices (for backwards compatibility - mapped to ElevenLabs on backend)
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
  summaryEffortLevel:
    (localStorage.getItem(SUMMARY_EFFORT_KEY) as SummaryEffortLevel) ?? 'high',
  showOriginalText: parseStoredBool(SHOW_ORIGINAL_KEY, true),
  qualityTranscription: parseStoredBool(QUALITY_TRANSCRIPTION_KEY, true),
  qualityTranslation: parseStoredBool(QUALITY_TRANSLATION_KEY, true),
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
  baseFontSize: Number(localStorage.getItem('savedMergeFontSize')) || 24,
  subtitleStyle:
    (localStorage.getItem('savedMergeStylePreset') as SubtitleStylePresetKey) ||
    'Default',
  showGeneratePanel: false,
  showEditPanel: false,
  seenGaps: new Set<string>(),
  seenLC: new Set<string>(),
  transcriptionLanguage: 'auto',
  previewSubtitleFontPx: 0,
  previewDisplayHeightPx: 0,
  previewVideoHeightPx: 0,
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

        setSummaryEffortLevel(level) {
          localStorage.setItem(SUMMARY_EFFORT_KEY, level);
          set({ summaryEffortLevel: level });
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

        setPreviewSubtitleMetrics(fontPx, displayHeightPx, videoHeightPx) {
          if (
            !Number.isFinite(fontPx) ||
            !Number.isFinite(displayHeightPx) ||
            !Number.isFinite(videoHeightPx)
          ) {
            return;
          }
          set(s => {
            s.previewSubtitleFontPx = fontPx;
            s.previewDisplayHeightPx = displayHeightPx;
            s.previewVideoHeightPx = videoHeightPx;
          });
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
