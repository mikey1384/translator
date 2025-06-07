import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';

interface CreditState {
  balance: number | null;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
}

export const useCreditStore = create<CreditState>(set => {
  // Set up listener for credit updates from main process
  SystemIPC.onCreditsUpdated((balance: number) => {
    set({ balance, loading: false });
  });

  return {
    balance: null,
    loading: true,
    error: undefined,
    refresh: async () => {
      set({ loading: true });
      const res = await SystemIPC.getCreditBalance();
      set({
        balance: res.success ? (res.balanceHours ?? 0) : null,
        loading: false,
        error: res.error,
      });
    },
  };
});

useCreditStore.getState().refresh(); // kick off once on module import
