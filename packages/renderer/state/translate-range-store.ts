import { create } from 'zustand';

/**
 * "Translate from here": which line the request starts from. The dialog
 * under the video reads this; the editor's per-line button and the More menu
 * open it. `startId` null means the line playing now.
 */
interface TranslateRangeState {
  request: { startId: string | null } | null;
  /** The dialog is on screen to answer (it lives under the video). */
  available: boolean;
  setAvailable(available: boolean): void;
  open(startId?: string | null): void;
  close(): void;
}

export const useTranslateRangeStore = create<TranslateRangeState>(set => ({
  request: null,
  available: false,
  setAvailable(available) {
    set({ available });
  },
  open(startId = null) {
    set({ request: { startId } });
  },
  close() {
    set({ request: null });
  },
}));
