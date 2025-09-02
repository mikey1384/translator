import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface State {
  unsavedSrtOpen: boolean;
  _resolver?: (choice: UnsavedChoice) => void;
}

interface Actions {
  openUnsavedSrtConfirm: () => Promise<UnsavedChoice>;
  resolveUnsavedSrt: (choice: UnsavedChoice) => void;
}

export const useModalStore = createWithEqualityFn<State & Actions>()(
  immer((set, get) => ({
    unsavedSrtOpen: false,
    _resolver: undefined,

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
  }))
);

export async function openUnsavedSrtConfirm(): Promise<UnsavedChoice> {
  return useModalStore.getState().openUnsavedSrtConfirm();
}

export function resolveUnsavedSrt(choice: UnsavedChoice) {
  return useModalStore.getState().resolveUnsavedSrt(choice);
}
