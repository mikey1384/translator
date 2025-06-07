import { useCreditStore } from '../../../state';
import * as SystemIPC from '../../../ipc/system';

export interface CreditReservationResult {
  success: boolean;
  error?: string;
}

export async function validateAndReserveCredits(
  hoursNeeded: number,
  refreshCreditState: () => void
): Promise<CreditReservationResult> {
  const currentBalance = useCreditStore.getState().hours ?? 0;
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
  useCreditStore.setState({
    credits: reserve.newBalanceCredits ?? useCreditStore.getState().credits,
    hours: reserve.newBalanceHours,
  });
  return { success: true };
}

export async function refundCreditsIfNeeded(
  hoursNeeded: number
): Promise<void> {
  if (hoursNeeded !== null) {
    const result = await SystemIPC.refundCredits(hoursNeeded);
    if (result.success) {
      // Update store with the actual returned values
      useCreditStore.setState({
        credits: result.newBalanceCredits ?? useCreditStore.getState().credits,
        hours: result.newBalanceHours ?? useCreditStore.getState().hours,
      });
    }
  }
}
