import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
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
  baseFontSize: 24,
  subtitleStyle: 'Default' as SubtitleStylePresetKey,
};

export const useUIStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    ...initial,

    toggleSettings(show) {
      set({ showSettings: show !== undefined ? show : !get().showSettings });
    },

    setFindBarVisible(visible) {
      set(s => {
        s.isFindBarVisible = visible;
        if (!visible) {
          s.searchText = '';
          s.matchedIndices = [];
          s.activeMatchIndex = 0;
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
      set({ matchedIndices: indices });
    },

    handleFindNext() {
      const current = get();
      if (current.matchedIndices.length === 0) return;
      const nextIndex =
        (current.activeMatchIndex + 1) % current.matchedIndices.length;
      set({ activeMatchIndex: nextIndex });
    },

    handleFindPrev() {
      const current = get();
      if (current.matchedIndices.length === 0) return;
      const prevIndex =
        (current.activeMatchIndex - 1 + current.matchedIndices.length) %
        current.matchedIndices.length;
      set({ activeMatchIndex: prevIndex });
    },

    handleCloseFindBar() {
      set({ isFindBarVisible: false });
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
  }))
);

export const useSubtitlePrefs = () =>
  useUIStore(s => ({
    baseFontSize: s.baseFontSize,
    subtitleStyle: s.subtitleStyle,
    showOriginal: s.showOriginalText,
  }));
