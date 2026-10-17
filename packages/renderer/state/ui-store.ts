import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { Draft, enableMapSet } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useSubStore } from './subtitle-store';
import {
  DEFAULT_SUBTITLE_STYLE_PRESET,
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../shared/constants/subtitle-styles';
import { DEFAULT_SUBTITLE_BASE_FONT_SIZE } from '../../shared/constants/runtime-config';
import { sameArray } from '../utils/array';
import {
  DUB_VOICE_STORAGE_KEY,
  readAndMigrateStoredDubVoice,
  resolveAllowedDubVoice,
} from './dub-voice-storage';
import type {
  SubtitleDisplayMode,
  SummaryEffortLevel,
} from '@shared-types/app';
import { TRANSLATION_LANGUAGES } from '../constants/translation-languages';
import type { GenerateSubtitlesWorkspaceTab } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import {
  readGenerateSubtitlesWorkspaceTab,
  writeGenerateSubtitlesWorkspaceTab,
} from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';

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
  subtitleDisplayMode: SubtitleDisplayMode;
  // Quality toggles
  qualityTranslation: boolean; // true = include review phase
  dubVoice: string;
  baseFontSize: number;
  subtitleStyle: SubtitleStylePresetKey;
  dubAmbientMix: number;
  navTick: number;
  // Panel open states (session-only; not persisted)
  showGeneratePanel: boolean;
  showEditPanel: boolean;
  // Home "Make it speak X" request, consumed by GenerateSubtitles, which owns
  // the download → transcribe → translate chain (session-only).
  homeRunRequest: HomeRunRequest | null;
  // Video workspace: manual subtitle editing (persisted), the collapsed
  // "All tools" area and the export sheet (session-only).
  subtitleEditMode: boolean;
  workspaceToolsOpen: boolean;
  workspaceToolsFocus: WorkspaceToolsFocus | null;
  exportSheetOpen: boolean;
  // Generate workspace tab (persisted)
  generateSubtitlesWorkspaceTab: GenerateSubtitlesWorkspaceTab;
  // Exclamation seen state (session-only; reset on video change)
  seenGaps: Set<string>;
  seenLC: Set<string>;
  // Transcription controls (session-only)
  transcriptionLanguage: string; // 'auto' | language token
  previewSubtitleFontPx: number;
  previewDisplayHeightPx: number;
  previewVideoHeightPx: number;
}

/**
 * Which slice of the old tools the workspace shows. 'clips', 'summary',
 * 'dub' and 'translate' are focused views of one task; null shows them all.
 */
export type WorkspaceToolsFocus =
  | 'video'
  | 'process'
  | 'clips'
  | 'summary'
  | 'dub'
  | 'translate';

const SUBTITLE_EDIT_MODE_KEY = 'translator.subtitleEditMode';

function readSubtitleEditMode(): boolean {
  try {
    return window.localStorage.getItem(SUBTITLE_EDIT_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSubtitleEditMode(on: boolean): void {
  try {
    window.localStorage.setItem(SUBTITLE_EDIT_MODE_KEY, on ? '1' : '0');
  } catch {
    // Storage can be unavailable; the choice then lasts for this session.
  }
}

export type HomeRunRequestInput =
  | { kind: 'url'; url: string }
  | { kind: 'mounted'; path: string };
export type HomeRunRequest = HomeRunRequestInput & { id: number };
let homeRunRequestSeq = 0;

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
  setSubtitleDisplayMode(mode: SubtitleDisplayMode): void;
  setQualityTranslation(v: boolean): void;
  setDubVoice(voice: string): void;
  setDubAmbientMix(value: number): void;
  setBaseFontSize(size: number): void;
  setSubtitleStyle(p: SubtitleStylePresetKey): void;
  setGeneratePanelOpen(open: boolean): void;
  setSubtitleEditMode(on: boolean): void;
  setWorkspaceToolsOpen(
    open: boolean,
    focus?: WorkspaceToolsFocus | null
  ): void;
  setExportSheetOpen(open: boolean): void;
  requestHomeRun(request: HomeRunRequestInput): void;
  clearHomeRunRequest(id: number): void;
  setEditPanelOpen(open: boolean): void;
  setGenerateSubtitlesWorkspaceTab(tab: GenerateSubtitlesWorkspaceTab): void;
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
const SUBTITLE_DISPLAY_MODE_KEY = 'savedSubtitleDisplayMode';
const LEGACY_SHOW_ORIGINAL_KEY = 'savedShowOriginalText';
const APP_LANGUAGE_PREFERENCE_KEY = 'app_language_preference';
// 'savedQualityTranscription' (the retired Quality Transcription switch) is no
// longer read: transcription is ElevenLabs Scribe only. Old values are ignored.
const QUALITY_TRANSLATION_KEY = 'savedQualityTranslation';
const DUB_AMBIENT_MIX_KEY = 'savedDubAmbientMix';
const VALID_TARGET_LANGUAGES = new Set(
  TRANSLATION_LANGUAGES.map(option => option.value)
);

function normalizeTargetLanguageValue(
  value: string | null | undefined
): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'original') {
    return null;
  }
  return VALID_TARGET_LANGUAGES.has(normalized) ? normalized : null;
}

export function mapUiLanguageToTargetLanguage(
  value: string | null | undefined
): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace('_', '-');
  if (
    normalized.startsWith('zh-tw') ||
    normalized.startsWith('zh-hk') ||
    normalized.startsWith('zh-mo') ||
    normalized.includes('hant')
  ) {
    return 'chinese_traditional';
  }
  if (normalized.startsWith('zh')) {
    return 'chinese_simplified';
  }
  const base = normalized.split('-')[0] || 'en';
  const mapping: Record<string, string> = {
    en: 'english',
    es: 'spanish',
    fr: 'french',
    de: 'german',
    it: 'italian',
    pt: 'portuguese',
    ru: 'russian',
    ja: 'japanese',
    ko: 'korean',
    ar: 'arabic',
    hi: 'hindi',
    id: 'indonesian',
    vi: 'vietnamese',
    tr: 'turkish',
    nl: 'dutch',
    pl: 'polish',
    sv: 'swedish',
    no: 'norwegian',
    da: 'danish',
    fi: 'finnish',
    el: 'greek',
    cs: 'czech',
    hu: 'hungarian',
    ro: 'romanian',
    uk: 'ukrainian',
    he: 'hebrew',
    fa: 'farsi',
    th: 'thai',
    ms: 'malay',
    sw: 'swahili',
    af: 'afrikaans',
    bn: 'bengali',
    ta: 'tamil',
    te: 'telugu',
    mr: 'marathi',
    tl: 'tagalog',
    ur: 'urdu',
  };
  return mapping[base] || 'english';
}

function resolveInitialTargetLanguage(): string {
  const storedTargetLanguage = normalizeTargetLanguageValue(
    localStorage.getItem(TARGET_LANG_KEY)
  );
  if (storedTargetLanguage) {
    return storedTargetLanguage;
  }
  return mapUiLanguageToTargetLanguage(
    localStorage.getItem(APP_LANGUAGE_PREFERENCE_KEY) || navigator.language
  );
}

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

function parseStoredSubtitleDisplayMode(): SubtitleDisplayMode {
  const raw = localStorage.getItem(SUBTITLE_DISPLAY_MODE_KEY);
  if (raw === 'original' || raw === 'translation' || raw === 'dual') {
    return raw;
  }

  return parseStoredBool(LEGACY_SHOW_ORIGINAL_KEY, true)
    ? 'dual'
    : 'translation';
}

// Note: We intentionally do NOT persist panel open states across reloads.

// The style used to be saved on every store change, so a stored 'Default'
// almost never meant a choice. Move those installs to the yellow default once;
// anything picked after that is kept as is.
const SUBTITLE_STYLE_DEFAULT_MIGRATION_KEY = 'subtitleStyleDefaultCinema';

function readSavedSubtitleStyle(): SubtitleStylePresetKey {
  try {
    const saved = localStorage.getItem('savedMergeStylePreset');
    if (!localStorage.getItem(SUBTITLE_STYLE_DEFAULT_MIGRATION_KEY)) {
      localStorage.setItem(SUBTITLE_STYLE_DEFAULT_MIGRATION_KEY, '1');
      if (!saved || saved === 'Default') return DEFAULT_SUBTITLE_STYLE_PRESET;
    }
    return saved && Object.hasOwn(SUBTITLE_STYLE_PRESETS, saved)
      ? saved
      : DEFAULT_SUBTITLE_STYLE_PRESET;
  } catch {
    return DEFAULT_SUBTITLE_STYLE_PRESET;
  }
}

const initial: State = {
  showSettings: false,
  isFindBarVisible: false,
  searchText: '',
  activeMatchIndex: 0,
  matchedIndices: [],
  navTick: 0,
  inputMode: 'file',
  targetLanguage: resolveInitialTargetLanguage(),
  summaryLanguage: localStorage.getItem(SUMMARY_LANG_KEY) ?? 'english',
  summaryEffortLevel:
    (localStorage.getItem(SUMMARY_EFFORT_KEY) as SummaryEffortLevel) ??
    'standard',
  subtitleDisplayMode: parseStoredSubtitleDisplayMode(),
  qualityTranslation: parseStoredBool(QUALITY_TRANSLATION_KEY, false),
  // Legacy OpenAI voice names are migrated to ElevenLabs voices on load.
  dubVoice: readAndMigrateStoredDubVoice(localStorage),
  dubAmbientMix: (() => {
    const raw = localStorage.getItem(DUB_AMBIENT_MIX_KEY);
    const parsed = raw != null ? Number(raw) : Number.NaN;
    if (!Number.isFinite(parsed)) return 0.35;
    return Math.min(1, Math.max(0, parsed));
  })(),
  baseFontSize:
    Number(localStorage.getItem('savedMergeFontSize')) ||
    DEFAULT_SUBTITLE_BASE_FONT_SIZE,
  subtitleStyle: readSavedSubtitleStyle(),
  showGeneratePanel: false,
  homeRunRequest: null,
  showEditPanel: false,
  generateSubtitlesWorkspaceTab: readGenerateSubtitlesWorkspaceTab(),
  subtitleEditMode: readSubtitleEditMode(),
  workspaceToolsOpen: false,
  workspaceToolsFocus: null,
  exportSheetOpen: false,
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
          const next =
            normalizeTargetLanguageValue(lang) ||
            resolveInitialTargetLanguage();
          localStorage.setItem(TARGET_LANG_KEY, next);
          set({ targetLanguage: next });
        },

        setSummaryLanguage(lang) {
          localStorage.setItem(SUMMARY_LANG_KEY, lang);
          set({ summaryLanguage: lang });
        },

        setSummaryEffortLevel(level) {
          localStorage.setItem(SUMMARY_EFFORT_KEY, level);
          set({ summaryEffortLevel: level });
        },

        setSubtitleDisplayMode(mode) {
          localStorage.setItem(SUBTITLE_DISPLAY_MODE_KEY, mode);
          localStorage.removeItem(LEGACY_SHOW_ORIGINAL_KEY);
          set({ subtitleDisplayMode: mode });
        },

        setQualityTranslation(v) {
          localStorage.setItem(QUALITY_TRANSLATION_KEY, JSON.stringify(v));
          set({ qualityTranslation: v });
        },

        setDubVoice(voice) {
          const next = resolveAllowedDubVoice(voice);
          localStorage.setItem(DUB_VOICE_STORAGE_KEY, next);
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

        setSubtitleEditMode(on) {
          writeSubtitleEditMode(on);
          set({ subtitleEditMode: on });
        },

        setWorkspaceToolsOpen(open, focus = null) {
          set({
            workspaceToolsOpen: open,
            workspaceToolsFocus: open ? focus : null,
          });
        },

        setExportSheetOpen(open) {
          set({ exportSheetOpen: open });
        },

        requestHomeRun(request) {
          homeRunRequestSeq += 1;
          set({
            homeRunRequest: { ...request, id: homeRunRequestSeq },
            showGeneratePanel: true,
          });
        },

        clearHomeRunRequest(id) {
          if (get().homeRunRequest?.id === id) set({ homeRunRequest: null });
        },

        setEditPanelOpen(open) {
          set({ showEditPanel: open });
        },

        setGenerateSubtitlesWorkspaceTab(tab) {
          writeGenerateSubtitlesWorkspaceTab(tab);
          set({ generateSubtitlesWorkspaceTab: tab });
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

export const useSubtitlePrefs = () => {
  const baseFontSize = useUIStore(s => s.baseFontSize);
  const subtitleStyle = useUIStore(s => s.subtitleStyle);
  const subtitleDisplayMode = useUIStore(s => s.subtitleDisplayMode);

  return {
    baseFontSize,
    subtitleStyle,
    subtitleDisplayMode,
  };
};
