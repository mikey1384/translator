import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface State {
  unsavedSrtOpen: boolean;
  _resolver?: (choice: UnsavedChoice) => void;
  // Credit ran out modal
  creditRanOutOpen: boolean;
  _creditResolver?: (choice: 'settings' | 'ok') => void;
}

interface Actions {
  openUnsavedSrtConfirm: () => Promise<UnsavedChoice>;
  resolveUnsavedSrt: (choice: UnsavedChoice) => void;
  openCreditRanOut: () => Promise<'settings' | 'ok'>;
  resolveCreditRanOut: (choice: 'settings' | 'ok') => void;
}

export const useModalStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    unsavedSrtOpen: false,
    _resolver: undefined,
    creditRanOutOpen: false,
    _creditResolver: undefined,

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
