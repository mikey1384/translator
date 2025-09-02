import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { Draft } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useSubStore } from './subtitle-store';
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
  showOriginalText: boolean;
  baseFontSize: number;
  subtitleStyle: SubtitleStylePresetKey;
  navTick: number;
  // Panel open states
  showGeneratePanel: boolean;
  showEditPanel: boolean;
}

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
  setShowOriginalText(show: boolean): void;
  setBaseFontSize(size: number): void;
  setSubtitleStyle(p: SubtitleStylePresetKey): void;
  setGeneratePanelOpen(open: boolean): void;
  setEditPanelOpen(open: boolean): void;
}

const TARGET_LANG_KEY = 'savedTargetLanguage';
const SHOW_ORIGINAL_KEY = 'savedShowOriginalText';
const SHOW_GENERATE_PANEL_KEY = 'ui:showGeneratePanel';
const SHOW_EDIT_PANEL_KEY = 'ui:showEditPanel';

const initial: State = {
  showSettings: false,
  isFindBarVisible: false,
  searchText: '',
  activeMatchIndex: 0,
  matchedIndices: [],
  navTick: 0,
  inputMode: 'file',
  targetLanguage: localStorage.getItem(TARGET_LANG_KEY) ?? 'original',
  showOriginalText: JSON.parse(
    localStorage.getItem(SHOW_ORIGINAL_KEY) ?? 'true'
  ),
  baseFontSize: Number(localStorage.getItem('savedMergeFontSize')) || 24,
  subtitleStyle:
    (localStorage.getItem('savedMergeStylePreset') as SubtitleStylePresetKey) ||
    'Default',
  showGeneratePanel: localStorage.getItem(SHOW_GENERATE_PANEL_KEY)
    ? localStorage.getItem(SHOW_GENERATE_PANEL_KEY) === 'true'
    : false,
  showEditPanel: localStorage.getItem(SHOW_EDIT_PANEL_KEY)
    ? localStorage.getItem(SHOW_EDIT_PANEL_KEY) === 'true'
    : false,
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

        setShowOriginalText(show) {
          localStorage.setItem(SHOW_ORIGINAL_KEY, JSON.stringify(show));
          set({ showOriginalText: show });
        },

        setBaseFontSize(size) {
          set({ baseFontSize: size });
        },

        setSubtitleStyle(p) {
          set({ subtitleStyle: p });
        },

        setGeneratePanelOpen(open) {
          localStorage.setItem(SHOW_GENERATE_PANEL_KEY, String(open));
          set({ showGeneratePanel: open });
        },

        setEditPanelOpen(open) {
          localStorage.setItem(SHOW_EDIT_PANEL_KEY, String(open));
          set({ showEditPanel: open });
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
