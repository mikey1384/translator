import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import { estimateTranslatableHours } from '../utils/creditEstimates';
import { CREDIT_PACKS } from '../../shared/constants';
import type {
  CheckoutTransitionInfo,
  CreditHistorySummary,
  CreditPackId,
  MonthlyFreeCreditsInfo,
} from '@shared-types/app';

/** A payment that just landed, shown as "+32m added" for a short while. */
export type CheckoutSuccess = {
  // Credits the payment added, when known (pack size or balance change).
  creditsAdded: number | null;
  at: number;
};

interface CreditState {
  credits: number | null;
  hours: number | null;
  creditsPerHour: number | null;
  // This month's free top-up allowance (null when the API doesn't report one).
  monthlyFree: MonthlyFreeCreditsInfo | null;
  authoritative: boolean;
  // The last refresh couldn't reach the server: `credits` is only the cached
  // value (a fresh profile's 0), so screens must not present it as known.
  offline: boolean;
  loading: boolean;
  // An i18n key (rendered with t()); never English text.
  error?: string;
  checkoutPending: boolean;
  checkoutUnresolved: boolean;
  checkoutBaselineCredits: number | null;
  // The pack being paid for, so its card can say "Waiting for payment…".
  checkoutPackId: CreditPackId | null;
  checkoutSuccess: CheckoutSuccess | null;
  // Where the balance came from (welcome grant only, ever had any). Null until
  // the ledger has been read, or when it could not be.
  history: CreditHistorySummary | null;
  refreshHistory: () => void;
  /** Try loading the balance again after a failed first load. */
  retryLoad: () => void;
  beginCheckoutPending: (packId?: CreditPackId | null) => void;
  clearCheckoutPending: () => void;
  dismissUnresolvedCheckout: () => void;
  /** Mark the pack the user just clicked, before main confirms the session. */
  noteCheckoutPack: (packId: CreditPackId) => void;
  /**
   * "Choose another pack": stop waiting on the open checkout here and in main,
   * so the next pack click starts a fresh session.
   */
  chooseAnotherPack: () => void;
  dismissCheckoutSuccess: () => void;
  cleanup: () => void;
  unsub?: () => void;
}

export const CREDITS_LOAD_FAILED = 'credits.loadFailed';

const CHECKOUT_UNRESOLVED_REFRESH_INTERVAL_MS = 2_500;
const CHECKOUT_UNRESOLVED_REFRESH_MAX_MS = 10 * 60_000;
const CHECKOUT_UNRESOLVED_FOCUS_REFRESH_DEBOUNCE_MS = 1_000;
const CHECKOUT_SUCCESS_VISIBLE_MS = 12_000;
const INITIAL_AUTHORITATIVE_REFRESH_INTERVAL_MS = 5_000;
const INITIAL_AUTHORITATIVE_REFRESH_MAX_MS = 60_000;
const INITIAL_AUTHORITATIVE_REFRESH_MAX_ATTEMPTS = 12;

let checkoutSuccessTimer: ReturnType<typeof setTimeout> | null = null;
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

function packIdFrom(info?: CheckoutTransitionInfo): CreditPackId | null {
  const id = info?.packId;
  return id && id in CREDIT_PACKS ? (id as CreditPackId) : null;
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
  const showCheckoutSuccess = (creditsAdded: number | null) => {
    set({ checkoutSuccess: { creditsAdded, at: Date.now() } });
    if (checkoutSuccessTimer) clearTimeout(checkoutSuccessTimer);
    checkoutSuccessTimer = setTimeout(() => {
      checkoutSuccessTimer = null;
      set({ checkoutSuccess: null });
    }, CHECKOUT_SUCCESS_VISIBLE_MS);
  };

  const stopWaitingOnCheckout = () => {
    set({
      checkoutPending: false,
      checkoutUnresolved: false,
      checkoutBaselineCredits: null,
      checkoutPackId: null,
    });
    checkoutRefreshStartedAt = null;
    stopCheckoutRefreshLoop();
  };

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
      // Ten minutes without a payment: treat it as abandoned instead of
      // telling the user to "finish paying" for the rest of the session.
      // Main keeps reconciling, so a late payment still adds its minutes.
      stopWaitingOnCheckout();
      void SystemIPC.abandonCheckoutSession().catch(() => {});
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
          stopWaitingOnCheckout();
          showCheckoutSuccess(snapshot.creditBalance - baseline);
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

  let historyInFlight = false;
  let historyRequested = false;
  const refreshHistory = () => {
    if (historyInFlight) return;
    historyInFlight = true;
    historyRequested = true;
    void SystemIPC.getCreditHistorySummary()
      .then(history => {
        if (history) set({ history });
      })
      .catch(error => {
        console.warn('[credit-store] Failed to read credit history:', error);
      })
      .finally(() => {
        historyInFlight = false;
      });
  };

  const applyCreditSnapshot = ({
    creditBalance,
    hoursBalance,
    creditsPerHour,
    authoritative,
    offline,
    monthlyFree,
  }: {
    creditBalance: number;
    hoursBalance?: number | null;
    creditsPerHour?: number | null;
    authoritative?: boolean;
    offline?: boolean;
    monthlyFree?: MonthlyFreeCreditsInfo | null;
  }) => {
    const credits = creditBalance ?? null;
    const previousCredits = get().credits;
    const hours =
      typeof hoursBalance === 'number'
        ? hoursBalance
        : estimateTranslatableHours(credits, false);
    set(state => ({
      credits,
      hours,
      creditsPerHour:
        typeof creditsPerHour === 'number' ? creditsPerHour : null,
      monthlyFree: monthlyFree === undefined ? state.monthlyFree : monthlyFree,
      authoritative: Boolean(authoritative),
      offline: Boolean(offline),
      loading: false,
      error: undefined,
      checkoutPending: state.checkoutPending,
      checkoutUnresolved: state.checkoutUnresolved,
    }));

    if (authoritative) {
      stopInitialAuthoritativeRefreshLoop();
      // First authoritative read, or credits arrived (purchase, transfer):
      // re-check where they came from.
      if (
        !historyRequested ||
        (typeof credits === 'number' &&
          typeof previousCredits === 'number' &&
          credits > previousCredits)
      ) {
        refreshHistory();
      }
    }
  };

  const unsubCredits = SystemIPC.onCreditsUpdated(
    ({
      creditBalance,
      hoursBalance,
      creditsPerHour,
      authoritative,
      offline,
      monthlyFree,
    }) => {
      applyCreditSnapshot({
        creditBalance,
        hoursBalance,
        creditsPerHour,
        authoritative,
        offline,
        monthlyFree,
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

  const beginCheckoutPending = (packId?: CreditPackId | null) => {
    const state = get();
    set({
      checkoutPackId: packId ?? state.checkoutPackId,
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
    stopWaitingOnCheckout();
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

  // Back online after the balance couldn't be read: read it again now rather
  // than waiting for the next job to refresh it.
  const onBackOnline = () => {
    if (!get().offline) return;
    void SystemIPC.refreshCreditSnapshot(true)
      .then(snapshot => {
        if (snapshot) applyCreditSnapshot(snapshot);
      })
      .catch(error => {
        console.warn('[credit-store] Refresh after reconnect failed:', error);
      });
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('online', onBackOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  void SystemIPC.getCreditSnapshot()
    .then(snapshot => {
      if (!snapshot) {
        set({
          loading: false,
          error: CREDITS_LOAD_FAILED,
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
      console.error(
        '[credit-store] Failed to get initial credit snapshot:',
        error
      );
      set({
        loading: false,
        error: CREDITS_LOAD_FAILED,
      });
      startInitialAuthoritativeRefreshLoop();
    });

  // Set up listeners for checkout status
  const unsubPending = SystemIPC.onCheckoutPending(info => {
    beginCheckoutPending(packIdFrom(info));
  });

  const unsubConfirmed = SystemIPC.onCheckoutConfirmed(info => {
    const packId = packIdFrom(info) ?? get().checkoutPackId;
    clearCheckoutPending();
    showCheckoutSuccess(packId ? CREDIT_PACKS[packId].credits : null);
  });

  const unsubUnresolved = SystemIPC.onCheckoutUnresolved(info => {
    set(state => ({
      checkoutPackId: packIdFrom(info) ?? state.checkoutPackId,
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
        window.removeEventListener('online', onBackOnline);
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
    monthlyFree: null,
    creditsPerHour: null,
    authoritative: false,
    offline: false,
    loading: true,
    checkoutPending: false,
    checkoutUnresolved: false,
    checkoutBaselineCredits: null,
    checkoutPackId: null,
    checkoutSuccess: null,
    history: null,
    refreshHistory,
    retryLoad: () => {
      set({ loading: true, error: undefined });
      void SystemIPC.refreshCreditSnapshot(true)
        .then(snapshot => {
          if (snapshot) applyCreditSnapshot(snapshot);
          else set({ loading: false, error: CREDITS_LOAD_FAILED });
        })
        .catch(error => {
          console.warn(
            '[credit-store] Retrying the credit load failed:',
            error
          );
          set({ loading: false, error: CREDITS_LOAD_FAILED });
        });
    },
    error: undefined,
    unsub: unsubCredits, // Return for external disposal (deprecated)
    beginCheckoutPending,
    clearCheckoutPending,
    dismissUnresolvedCheckout: () => {
      set({ checkoutUnresolved: false, checkoutBaselineCredits: null });
      checkoutRefreshStartedAt = null;
      stopCheckoutRefreshLoop();
    },
    noteCheckoutPack: packId => set({ checkoutPackId: packId }),
    chooseAnotherPack: () => {
      stopWaitingOnCheckout();
      void SystemIPC.abandonCheckoutSession().catch(error => {
        console.warn('[credit-store] Abandoning the checkout failed:', error);
      });
    },
    dismissCheckoutSuccess: () => {
      if (checkoutSuccessTimer) clearTimeout(checkoutSuccessTimer);
      checkoutSuccessTimer = null;
      set({ checkoutSuccess: null });
    },
    cleanup: () => {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        window.removeEventListener('focus', onWindowFocus);
        window.removeEventListener('online', onBackOnline);
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
