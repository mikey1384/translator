import { useCreditStore } from '../../../state';
import * as SystemIPC from '../../../ipc/system';

export interface CreditReservationResult {
  success: boolean;
  error?: string;
}

// Match the backend calculation exactly
const CREDITS_PER_AUDIO_HOUR = 83_333;

export function secondsToCredits({ seconds }: { seconds: number }): number {
  // Direct conversion: 83,333 credits per hour
  return Math.ceil(seconds * (CREDITS_PER_AUDIO_HOUR / 3600));
}

export function estimateCreditsForVideo(videoLengthSec: number): number {
  // Add 15% buffer for processing overhead
  return Math.ceil(secondsToCredits({ seconds: videoLengthSec }) * 1.15);
}

export function checkSufficientCredits(videoLengthSec: number): {
  hasSufficientCredits: boolean;
  estimatedCredits: number;
  currentBalance: number;
} {
  const estimatedCredits = estimateCreditsForVideo(videoLengthSec);
  const currentBalance = useCreditStore.getState().credits ?? 0;

  return {
    hasSufficientCredits: currentBalance >= estimatedCredits,
    estimatedCredits,
    currentBalance,
  };
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
