import type {
  CreditHistorySummary,
  MonthlyFreeCreditsInfo,
} from '@shared-types/app';
import { creditsToWholeMinutes } from './formatCostInMinutes';

/**
 * What the balance means, shared by the header pill and the Settings card so
 * both say the same thing:
 * - loading / unavailable: no balance yet (the pill still shows, neutrally)
 * - welcomePending: a new device whose welcome grant hasn't landed (the
 *   server caps grants per network); it arrives on a later launch
 * - freeBack: empty, the monthly top-up refills it on a date
 * - empty: empty, nothing free is coming
 * - freeThisMonth: what is left of this month's free top-up
 * - free: free minutes (welcome grant) for a device that never paid
 * - paid: anything a purchase or transfer is part of
 */
export type CreditBalanceState =
  | 'loading'
  | 'unavailable'
  | 'welcomePending'
  | 'freeBack'
  | 'empty'
  | 'freeThisMonth'
  | 'free'
  | 'paid'
  // The server can't be reached and the cached balance is empty: say so
  // instead of "no minutes left", which may be false.
  | 'offline';

export function resolveCreditBalanceState({
  credits,
  loading,
  monthlyFree,
  history,
  offline = false,
}: {
  credits: number | null;
  loading: boolean;
  monthlyFree: MonthlyFreeCreditsInfo | null;
  history: CreditHistorySummary | null;
  offline?: boolean;
}): CreditBalanceState {
  if (credits === null || !Number.isFinite(credits)) {
    if (offline) return 'offline';
    return loading ? 'loading' : 'unavailable';
  }
  const minutes = creditsToWholeMinutes(credits, 'balance');
  // A cached positive balance is still worth showing; a cached empty one
  // (often a fresh profile that never reached the server) is not.
  if (offline && minutes < 1) return 'offline';
  // The ledger is read after the first balance; until then, never guess
  // "free" wording, which is wrong for paying users.
  const neverPaid = history != null && history.everPaid !== true;
  if (minutes < 1) {
    // No ledger rows at all: the device never got its welcome grant.
    if (history && !history.everHadCredits) return 'welcomePending';
    return monthlyFree ? 'freeBack' : 'empty';
  }
  if (!neverPaid) return 'paid';
  if (monthlyFree && credits <= monthlyFree.credits) return 'freeThisMonth';
  return 'free';
}
