import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { useSubStore } from './subtitle-store';
import { SrtSegment, VideoQuality } from '@shared-types/app';

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
};

export const useUIStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    ...initial,

    toggleSettings(show) {
      set({ showSettings: show !== undefined ? show : !get().showSettings });
    },

    setFindBarVisible(visible) {
      set({ isFindBarVisible: visible });
    },

    setSearchText(text) {
      set({ searchText: text });
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
      const replaceWith = prompt('Replace with:', '');
      if (replaceWith !== null)
        replaceAll(searchText, replaceWith, /* dualMode */ true);
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
      set({ error });
    },
  }))
);

function replaceAll(find: string, replace: string, dualMode = true) {
  if (!find.trim() || !replace) return;

  const { order, segments } = useSubStore.getState();
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');

  const newSegs: SrtSegment[] = order.map(id => {
    const s = segments[id];
    return {
      ...s,
      original: s.original.replace(re, replace),
      translation:
        dualMode && s.translation
          ? s.translation.replace(re, replace)
          : s.translation,
    };
  });

  useSubStore.getState().load(newSegs);
}
