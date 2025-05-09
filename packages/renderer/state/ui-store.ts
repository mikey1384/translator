import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { Draft } from 'immer';
import { subscribeWithSelector } from 'zustand/middleware';
import { useSubStore } from './subtitle-store';
import { VideoQuality } from '@shared-types/app';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles';

interface State {
  showSettings: boolean;
  isFindBarVisible: boolean;
  searchText: string;
  activeMatchIndex: number;
  matchedIndices: number[];
  inputMode: 'file' | 'url';
  urlInput: string;
  downloadQuality: VideoQuality;
  targetLanguage: string;
  showOriginalText: boolean;
  error: string | null;
  baseFontSize: number;
  subtitleStyle: SubtitleStylePresetKey;
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
  setUrlInput(url: string): void;
  setDownloadQuality(quality: VideoQuality): void;
  setTargetLanguage(lang: string): void;
  setShowOriginalText(show: boolean): void;
  setError(error: string | null): void;
  handleProcessUrl(): void;
  openFileDialog(): void;
  setBaseFontSize(size: number): void;
  setSubtitleStyle(p: SubtitleStylePresetKey): void;
}

const initial: State = {
  showSettings: false,
  isFindBarVisible: false,
  searchText: '',
  activeMatchIndex: 0,
  matchedIndices: [],
  inputMode: 'file',
  urlInput: '',
  downloadQuality: 'mid',
  targetLanguage: 'original',
  showOriginalText: true,
  error: null,
  baseFontSize: Number(localStorage.getItem('savedMergeFontSize')) || 24,
  subtitleStyle:
    (localStorage.getItem('savedMergeStylePreset') as SubtitleStylePresetKey) ||
    'Default',
};

// Helper function hoisted to module scope
const resetSearchState = (s: Draft<State>) => {
  s.searchText = '';
  s.matchedIndices = [];
  s.activeMatchIndex = 0;
};

// helper
const sameArray = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

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
          set({ activeMatchIndex: index });
        },

        setMatchedIndices(indices) {
          set(draft => {
            /* 1️⃣  matched indices --------------------------------------- */
            if (!sameArray(draft.matchedIndices, indices)) {
              draft.matchedIndices = indices;
            }

            // ✅  Only reset when there are *no* matches left
            if (indices.length === 0) {
              draft.activeMatchIndex = 0;
            }
          });
        },

        handleFindNext() {
          const { matchedIndices, activeMatchIndex } = get();
          if (matchedIndices.length === 0) return;
          const next = (activeMatchIndex + 1) % matchedIndices.length;
          set({ activeMatchIndex: next });
        },

        handleFindPrev() {
          const { matchedIndices, activeMatchIndex } = get();
          if (matchedIndices.length === 0) return;
          const prev =
            (activeMatchIndex - 1 + matchedIndices.length) %
            matchedIndices.length;
          set({ activeMatchIndex: prev });
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

        setUrlInput(url) {
          set({ urlInput: url });
        },

        setDownloadQuality(quality) {
          set({ downloadQuality: quality });
        },

        setTargetLanguage(lang) {
          set({ targetLanguage: lang });
        },

        setShowOriginalText(show) {
          set({ showOriginalText: show });
        },

        setError(error) {
          set({ error: error ?? null });
        },

        setBaseFontSize(size) {
          set({ baseFontSize: size });
        },

        setSubtitleStyle(p) {
          set({ subtitleStyle: p });
        },

        handleProcessUrl() {
          const { urlInput, downloadQuality } = get();
          if (!urlInput.trim()) return;
          import('../ipc/url').then(({ process }) =>
            process({ url: urlInput, quality: downloadQuality }).catch(
              console.error
            )
          );
        },

        openFileDialog() {
          // Placeholder for opening file dialog
          console.log('Opening file dialog');
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
