import { useCreditStore } from '../../../state';
import * as SystemIPC from '../../../ipc/system';

export interface CreditReservationResult {
  success: boolean;
  error?: string;
}

export async function validateAndReserveCredits(
  hoursNeeded: number,
  canBypassCredits: boolean,
  refreshCreditState: () => void
): Promise<CreditReservationResult> {
  // Skip credit operations if using OpenAI key
  if (canBypassCredits) {
    return { success: true };
  }

  // Check if user has enough credits
  const currentBalance = useCreditStore.getState().balance ?? 0;
  if (currentBalance < hoursNeeded) {
    return {
      success: false,
      error: 'Not enough credits for this video.',
    };
  }

  // Try to reserve credits on disk via main process
  const reserve = await SystemIPC.reserveCredits(hoursNeeded);
  if (!reserve.success || typeof reserve.newBalanceHours !== 'number') {
    refreshCreditState(); // Refresh balance from store
    return {
      success: false,
      error: reserve.error || 'Error reserving credits. Please try again.',
    };
  }

  // Optimistic UI update with the new balance from the reservation
  useCreditStore.setState({ balance: reserve.newBalanceHours });
  return { success: true };
}

export async function refundCreditsIfNeeded(
  hoursNeeded: number,
  canBypassCredits: boolean
): Promise<void> {
  if (!canBypassCredits && hoursNeeded !== null) {
    // Optimistic UI refund
    useCreditStore.setState(s => ({
      balance: (s.balance ?? 0) + hoursNeeded,
    }));
    // Persisted refund via main process
    await SystemIPC.refundCredits(hoursNeeded);
  }
}
