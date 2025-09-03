import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import { CREDITS_PER_TRANSLATION_AUDIO_HOUR } from '../../shared/constants';

interface CreditState {
  credits: number | null;
  hours: number | null;
  creditsPerHour: number | null;
  loading: boolean;
  error?: string;
  checkoutPending: boolean;
  refresh: () => Promise<void>;
  cleanup: () => void;
  unsub?: () => void;
}

export const useCreditStore = create<CreditState>((set, get) => {
  const unsubCredits = SystemIPC.onCreditsUpdated(
    ({ creditBalance, hoursBalance }) => {
      const credits = creditBalance ?? null;
      // Unify: compute hours using the translation-based estimate
      const hours =
        typeof credits === 'number'
          ? credits / CREDITS_PER_TRANSLATION_AUDIO_HOUR
          : null;
      set({ credits, hours, checkoutPending: false });
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
    creditsPerHour: null,
    loading: true,
    checkoutPending: false,
    error: undefined,
    unsub: unsubCredits, // Return for external disposal (deprecated)
    refresh: async () => {
      const isFirstLoad = get().credits === null;
      if (isFirstLoad) set({ loading: true });

      const res = await SystemIPC.getCreditBalance();
      if (res.success) {
        const credits = res.creditBalance ?? get().credits ?? 0;
        // Unify: always use translation-based credits/hour for estimates
        const perHour = CREDITS_PER_TRANSLATION_AUDIO_HOUR;
        const hours = typeof credits === 'number' ? credits / perHour : get().hours;
        set({
          credits,
          hours,
          creditsPerHour: perHour,
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
