import { createWithEqualityFn } from 'zustand/traditional';

type SaveFn = () => Promise<void> | void;

interface State {
  save: SaveFn | null;
  saveAs: SaveFn | null;
  canSaveDirectly: boolean;
}

interface Actions {
  registerSaveHandlers: (handlers: {
    save: SaveFn | null;
    saveAs: SaveFn | null;
    canSaveDirectly: boolean;
  }) => void;
  clearSaveHandlers: () => void;
  triggerSave: () => Promise<void>;
}

export const useActionsStore = createWithEqualityFn<State & Actions>((set, get) => ({
  save: null,
  saveAs: null,
  canSaveDirectly: false,

  registerSaveHandlers: ({ save, saveAs, canSaveDirectly }) =>
    set({ save, saveAs, canSaveDirectly }),

  clearSaveHandlers: () => set({ save: null, saveAs: null, canSaveDirectly: false }),

  triggerSave: async () => {
    const { save, saveAs, canSaveDirectly } = get();
    const fn = canSaveDirectly ? save : saveAs;
    if (fn) {
      await fn();
    }
  },
}));

export async function triggerSave() {
  await useActionsStore.getState().triggerSave();
}

