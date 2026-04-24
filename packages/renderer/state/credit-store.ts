import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import { estimateTranslatableHours } from '../utils/creditEstimates';

interface CreditState {
  credits: number | null;
  hours: number | null;
  creditsPerHour: number | null;
  authoritative: boolean;
  loading: boolean;
  error?: string;
  checkoutPending: boolean;
  checkoutUnresolved: boolean;
  checkoutBaselineCredits: number | null;
  beginCheckoutPending: () => void;
  clearCheckoutPending: () => void;
  dismissUnresolvedCheckout: () => void;
  cleanup: () => void;
  unsub?: () => void;
}

const CHECKOUT_UNRESOLVED_REFRESH_INTERVAL_MS = 2_500;
const CHECKOUT_UNRESOLVED_REFRESH_MAX_MS = 10 * 60_000;
const CHECKOUT_UNRESOLVED_FOCUS_REFRESH_DEBOUNCE_MS = 1_000;
const INITIAL_AUTHORITATIVE_REFRESH_INTERVAL_MS = 5_000;
const INITIAL_AUTHORITATIVE_REFRESH_MAX_MS = 60_000;
const INITIAL_AUTHORITATIVE_REFRESH_MAX_ATTEMPTS = 12;

let checkoutRefreshInterval: ReturnType<typeof setInterval> | null = null;
let checkoutRefreshStartedAt: number | null = null;
let checkoutRefreshInFlight = false;
let lastCheckoutFocusRefreshAt = 0;
let initialAuthoritativeRefreshInterval: ReturnType<typeof setInterval> | null =
  null;
let initialAuthoritativeRefreshStartedAt: number | null = null;
let initialAuthoritativeRefreshAttempts = 0;
let initialAuthoritativeRefreshInFlight = false;

function stopCheckoutRefreshLoop() {
  if (checkoutRefreshInterval) {
    clearInterval(checkoutRefreshInterval);
    checkoutRefreshInterval = null;
  }
  checkoutRefreshInFlight = false;
}

function stopInitialAuthoritativeRefreshLoop() {
  if (initialAuthoritativeRefreshInterval) {
    clearInterval(initialAuthoritativeRefreshInterval);
    initialAuthoritativeRefreshInterval = null;
  }
  initialAuthoritativeRefreshStartedAt = null;
  initialAuthoritativeRefreshAttempts = 0;
  initialAuthoritativeRefreshInFlight = false;
}

export const useCreditStore = create<CreditState>((set, get) => {
  const refreshUnresolvedCheckout = () => {
    const state = get();
    if (!state.checkoutUnresolved) {
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
      return;
    }

    if (
      checkoutRefreshStartedAt &&
      Date.now() - checkoutRefreshStartedAt > CHECKOUT_UNRESOLVED_REFRESH_MAX_MS
    ) {
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
      return;
    }

    if (checkoutRefreshInFlight) {
      return;
    }

    checkoutRefreshInFlight = true;
    void SystemIPC.refreshCreditSnapshot()
      .then(snapshot => {
        const nextState = get();
        const baseline = nextState.checkoutBaselineCredits;
        if (
          nextState.checkoutUnresolved &&
          typeof baseline === 'number' &&
          snapshot &&
          snapshot.creditBalance > baseline
        ) {
          set({
            checkoutPending: false,
            checkoutUnresolved: false,
            checkoutBaselineCredits: null,
          });
          checkoutRefreshStartedAt = null;
          stopCheckoutRefreshLoop();
        }
      })
      .catch(error => {
        console.warn(
          '[credit-store] Failed to refresh unresolved checkout snapshot:',
          error
        );
      })
      .finally(() => {
        checkoutRefreshInFlight = false;
        const nextState = get();
        if (!nextState.checkoutUnresolved) {
          checkoutRefreshStartedAt = null;
          stopCheckoutRefreshLoop();
        }
      });
  };

  const startCheckoutRefreshLoop = () => {
    if (!checkoutRefreshStartedAt) {
      checkoutRefreshStartedAt = Date.now();
    }

    refreshUnresolvedCheckout();

    if (checkoutRefreshInterval) {
      return;
    }

    checkoutRefreshInterval = setInterval(() => {
      refreshUnresolvedCheckout();
    }, CHECKOUT_UNRESOLVED_REFRESH_INTERVAL_MS);
  };

  const applyCreditSnapshot = ({
    creditBalance,
    hoursBalance,
    creditsPerHour,
    authoritative,
  }: {
    creditBalance: number;
    hoursBalance?: number | null;
    creditsPerHour?: number | null;
    authoritative?: boolean;
  }) => {
    const credits = creditBalance ?? null;
    const hours =
      typeof hoursBalance === 'number'
        ? hoursBalance
        : estimateTranslatableHours(credits, false);
    set(state => ({
      credits,
      hours,
      creditsPerHour:
        typeof creditsPerHour === 'number' ? creditsPerHour : null,
      authoritative: Boolean(authoritative),
      loading: false,
      error: undefined,
      checkoutPending: state.checkoutPending,
      checkoutUnresolved: state.checkoutUnresolved,
    }));

    if (authoritative) {
      stopInitialAuthoritativeRefreshLoop();
    }
  };

  const unsubCredits = SystemIPC.onCreditsUpdated(
    ({ creditBalance, hoursBalance, creditsPerHour, authoritative }) => {
      applyCreditSnapshot({
        creditBalance,
        hoursBalance,
        creditsPerHour,
        authoritative,
      });
    }
  );

  const refreshInitialAuthoritativeSnapshot = () => {
    if (initialAuthoritativeRefreshInFlight) {
      return;
    }

    const elapsedMs = initialAuthoritativeRefreshStartedAt
      ? Date.now() - initialAuthoritativeRefreshStartedAt
      : 0;
    if (
      initialAuthoritativeRefreshAttempts >=
        INITIAL_AUTHORITATIVE_REFRESH_MAX_ATTEMPTS ||
      elapsedMs >= INITIAL_AUTHORITATIVE_REFRESH_MAX_MS
    ) {
      stopInitialAuthoritativeRefreshLoop();
      return;
    }

    initialAuthoritativeRefreshInFlight = true;
    initialAuthoritativeRefreshAttempts += 1;
    void SystemIPC.refreshCreditSnapshot()
      .then(snapshot => {
        if (!snapshot) {
          return;
        }

        applyCreditSnapshot(snapshot);
        if (snapshot.authoritative) {
          stopInitialAuthoritativeRefreshLoop();
        }
      })
      .catch(error => {
        console.warn(
          '[credit-store] Failed to refresh initial authoritative credit snapshot:',
          error
        );
      })
      .finally(() => {
        initialAuthoritativeRefreshInFlight = false;
        const totalElapsedMs = initialAuthoritativeRefreshStartedAt
          ? Date.now() - initialAuthoritativeRefreshStartedAt
          : 0;
        if (
          initialAuthoritativeRefreshAttempts >=
            INITIAL_AUTHORITATIVE_REFRESH_MAX_ATTEMPTS ||
          totalElapsedMs >= INITIAL_AUTHORITATIVE_REFRESH_MAX_MS
        ) {
          stopInitialAuthoritativeRefreshLoop();
        }
      });
  };

  const startInitialAuthoritativeRefreshLoop = () => {
    if (initialAuthoritativeRefreshInterval) {
      return;
    }

    initialAuthoritativeRefreshStartedAt = Date.now();
    initialAuthoritativeRefreshAttempts = 0;
    refreshInitialAuthoritativeSnapshot();
    initialAuthoritativeRefreshInterval = setInterval(
      refreshInitialAuthoritativeSnapshot,
      INITIAL_AUTHORITATIVE_REFRESH_INTERVAL_MS
    );
  };

  const beginCheckoutPending = () => {
    const state = get();
    set({
      checkoutPending: true,
      checkoutUnresolved: false,
      checkoutBaselineCredits:
        state.authoritative && typeof state.credits === 'number'
          ? state.credits
          : state.checkoutBaselineCredits,
    });
    checkoutRefreshStartedAt = null;
    stopCheckoutRefreshLoop();
  };

  const clearCheckoutPending = () => {
    set({
      checkoutPending: false,
      checkoutUnresolved: false,
      checkoutBaselineCredits: null,
    });
    checkoutRefreshStartedAt = null;
    stopCheckoutRefreshLoop();
  };

  const refreshUnresolvedCheckoutAfterReturn = () => {
    const state = get();
    if (!state.checkoutUnresolved) return;

    const now = Date.now();
    if (
      now - lastCheckoutFocusRefreshAt <
      CHECKOUT_UNRESOLVED_FOCUS_REFRESH_DEBOUNCE_MS
    ) {
      return;
    }
    lastCheckoutFocusRefreshAt = now;

    startCheckoutRefreshLoop();
  };

  const onWindowFocus = () => refreshUnresolvedCheckoutAfterReturn();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      refreshUnresolvedCheckoutAfterReturn();
    }
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  void SystemIPC.getCreditSnapshot()
    .then(snapshot => {
      if (!snapshot) {
        set({
          loading: false,
          error: 'Unable to load credits.',
        });
        startInitialAuthoritativeRefreshLoop();
        return;
      }
      applyCreditSnapshot(snapshot);
      if (!snapshot.authoritative) {
        startInitialAuthoritativeRefreshLoop();
      }
    })
    .catch(error => {
      console.error('[credit-store] Failed to get initial credit snapshot:', error);
      set({
        loading: false,
        error: 'Unable to load credits.',
      });
      startInitialAuthoritativeRefreshLoop();
    });

  // Set up listeners for checkout status
  const unsubPending = SystemIPC.onCheckoutPending(() => {
    beginCheckoutPending();
  });

  const unsubConfirmed = SystemIPC.onCheckoutConfirmed(() => {
    clearCheckoutPending();
  });

  const unsubUnresolved = SystemIPC.onCheckoutUnresolved(() => {
    set(state => ({
      checkoutPending: false,
      checkoutUnresolved: true,
      checkoutBaselineCredits:
        typeof state.checkoutBaselineCredits === 'number'
          ? state.checkoutBaselineCredits
          : state.authoritative && typeof state.credits === 'number'
            ? state.credits
            : null,
    }));
    checkoutRefreshStartedAt = Date.now();
    startCheckoutRefreshLoop();
  });

  const unsubCancelled = SystemIPC.onCheckoutCancelled(() => {
    clearCheckoutPending();
  });

  // Clean up on hot reload during development
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
      stopInitialAuthoritativeRefreshLoop();
      unsubCredits();
      unsubPending();
      unsubConfirmed();
      unsubUnresolved();
      unsubCancelled();
    });
  }

  return {
    credits: null,
    hours: null,
    creditsPerHour: null,
    authoritative: false,
    loading: true,
    checkoutPending: false,
    checkoutUnresolved: false,
    checkoutBaselineCredits: null,
    error: undefined,
    unsub: unsubCredits, // Return for external disposal (deprecated)
    beginCheckoutPending,
    clearCheckoutPending,
    dismissUnresolvedCheckout: () => {
      set({ checkoutUnresolved: false, checkoutBaselineCredits: null });
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
    },
    cleanup: () => {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('focus', onWindowFocus);
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
      stopInitialAuthoritativeRefreshLoop();
      unsubCredits();
      unsubPending();
      unsubConfirmed();
      unsubUnresolved();
      unsubCancelled();
    },
  };
});
