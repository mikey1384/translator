import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface State {
  unsavedSrtOpen: boolean;
  _resolver?: (choice: UnsavedChoice) => void;
  // Credit ran out modal
  creditRanOutOpen: boolean;
  _creditResolver?: (choice: 'settings' | 'ok') => void;
  // Change video modal
  changeVideoOpen: boolean;
  // Logs modal
  logsOpen: boolean;
}

interface Actions {
  openUnsavedSrtConfirm: () => Promise<UnsavedChoice>;
  resolveUnsavedSrt: (choice: UnsavedChoice) => void;
  openCreditRanOut: () => Promise<'settings' | 'ok'>;
  resolveCreditRanOut: (choice: 'settings' | 'ok') => void;
  openChangeVideo: () => void;
  closeChangeVideo: () => void;
}

export const useModalStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    unsavedSrtOpen: false,
    _resolver: undefined,
    creditRanOutOpen: false,
    _creditResolver: undefined,
    changeVideoOpen: false,
    logsOpen: false,

    openUnsavedSrtConfirm: () =>
      new Promise<UnsavedChoice>(resolve => {
        set(s => {
          s.unsavedSrtOpen = true;
          s._resolver = resolve;
        });
      }),

    resolveUnsavedSrt: choice => {
      const resolver = get()._resolver;
      if (resolver) resolver(choice);
      set(s => {
        s.unsavedSrtOpen = false;
        s._resolver = undefined;
      });
    },

    openCreditRanOut: () =>
      new Promise<'settings' | 'ok'>(resolve => {
        set(s => {
          s.creditRanOutOpen = true;
          s._creditResolver = resolve;
        });
      }),

    resolveCreditRanOut: choice => {
      const resolver = get()._creditResolver;
      if (resolver) resolver(choice);
      set(s => {
        s.creditRanOutOpen = false;
        s._creditResolver = undefined;
      });
    },

    openChangeVideo: () =>
      set(s => {
        s.changeVideoOpen = true;
      }),
    closeChangeVideo: () =>
      set(s => {
        s.changeVideoOpen = false;
      }),
    // Logs modal controls
    openLogs: () =>
      set(s => {
        s.logsOpen = true;
      }),
    closeLogs: () =>
      set(s => {
        s.logsOpen = false;
      }),
  }))
);

export async function openUnsavedSrtConfirm(): Promise<UnsavedChoice> {
  return useModalStore.getState().openUnsavedSrtConfirm();
}

export function resolveUnsavedSrt(choice: UnsavedChoice) {
  return useModalStore.getState().resolveUnsavedSrt(choice);
}

export async function openCreditRanOut(): Promise<'settings' | 'ok'> {
  return useModalStore.getState().openCreditRanOut();
}

export function resolveCreditRanOut(choice: 'settings' | 'ok') {
  return useModalStore.getState().resolveCreditRanOut(choice);
}

export function openChangeVideo() {
  return useModalStore.getState().openChangeVideo();
}

export function closeChangeVideo() {
  return useModalStore.getState().closeChangeVideo();
}

export function openLogs() {
  return (useModalStore.getState() as any).openLogs();
}

export function closeLogs() {
  return (useModalStore.getState() as any).closeLogs();
}
