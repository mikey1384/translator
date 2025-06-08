import { useCreditStore } from '../../../state';
import { CREDITS_PER_AUDIO_SECOND } from '../../../../shared/constants';

export function secondsToCredits({ seconds }: { seconds: number }): number {
  return Math.ceil(seconds * CREDITS_PER_AUDIO_SECOND);
}

export function estimateCreditsForVideo(videoLengthSec: number): number {
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
