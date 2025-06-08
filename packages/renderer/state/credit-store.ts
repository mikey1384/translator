import { create } from 'zustand';
import { debounce } from 'lodash-es';
import * as SystemIPC from '@ipc/system';

interface CreditState {
  credits: number | null;
  hours: number | null;
  loading: boolean;
  error?: string;
  checkoutPending: boolean; // True when payment is processing
  refresh: () => Promise<void>;
  cleanup: () => void; // Clean up listeners
  unsub?: () => void; // For external cleanup (deprecated, use cleanup)
}

export const useCreditStore = create<CreditState>((set, get) => {
  // Debounced sync function to prevent rapid API calls
  const sync = debounce(() => get().refresh(), 250);

  // Set up listener for credit updates from main process
  const unsubCredits = SystemIPC.onCreditsUpdated(
    ({ creditBalance, hoursBalance }) => {
      set({
        credits: creditBalance,
        hours: hoursBalance,
        checkoutPending: false,
      });
    }
  );

  // Set up listeners for checkout status
  const unsubPending = SystemIPC.onCheckoutPending(() => {
    set({ checkoutPending: true });
  });

  const unsubConfirmed = SystemIPC.onCheckoutConfirmed(() => {
    set({ checkoutPending: false });
    // Belt-and-suspenders: refresh balance just in case IPC event didn't come through
    get().refresh();
  });

  // Clean up on hot reload during development
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubCredits();
      unsubPending();
      unsubConfirmed();
    });
  }

  return {
    credits: null,
    hours: null,
    loading: true,
    checkoutPending: false,
    error: undefined,
    unsub: unsubCredits, // Return for external disposal (deprecated)
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
    cleanup: () => {
      unsubCredits();
      unsubPending();
      unsubConfirmed();
    },
  };
});

useCreditStore.getState().refresh();
