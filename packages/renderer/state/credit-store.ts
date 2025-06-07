import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';

interface CreditState {
  credits: number | null;
  hours: number | null;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

export const useCreditStore = create<CreditState>(set => {
  // Set up listener for credit updates from main process
  SystemIPC.onCreditsUpdated(() => {
    useCreditStore.getState().refresh();
  });

  return {
    credits: null,
    hours: null,
    loading: true,
    error: undefined,
    refresh: async () => {
      set({ loading: true });
      const res = await SystemIPC.getCreditBalance();
      if (res.success) {
        set({
          credits: res.creditBalance ?? null,
          hours: res.balanceHours ?? null,
          loading: false,
          error: undefined,
        });
      } else {
        set({ error: res.error, loading: false });
      }
    },
  };
});

useCreditStore.getState().refresh(); // kick off once on module import
