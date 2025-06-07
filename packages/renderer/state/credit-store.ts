import { create } from 'zustand';
import { debounce } from 'lodash-es';
import * as SystemIPC from '@ipc/system';

interface CreditState {
  credits: number | null;
  hours: number | null;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  unsub?: () => void; // For external cleanup
}

export const useCreditStore = create<CreditState>((set, get) => {
  // Debounced sync function to prevent rapid API calls
  const sync = debounce(() => get().refresh(), 250);

  // Set up listener for credit updates from main process
  const unsub = SystemIPC.onCreditsUpdated(
    ({ creditBalance, hoursBalance }) => {
      set({ credits: creditBalance, hours: hoursBalance });
    }
  );

  // Clean up on hot reload during development
  if (import.meta.hot) {
    import.meta.hot.dispose(unsub);
  }

  return {
    credits: null,
    hours: null,
    loading: true,
    error: undefined,
    unsub, // Return for external disposal
    refresh: async () => {
      // Only show loading spinner on first load, not on updates
      const isFirstLoad = get().credits === null;
      if (isFirstLoad) set({ loading: true });

      const res = await SystemIPC.getCreditBalance();
      if (res.success) {
        set({
          credits: res.creditBalance ?? get().credits, // Keep previous if missing
          hours: res.balanceHours ?? get().hours, // Keep previous if missing
          loading: false,
          error: undefined,
        });
      } else {
        set({ error: res.error, loading: false });
      }
    },
  };
});

useCreditStore.getState().refresh();
