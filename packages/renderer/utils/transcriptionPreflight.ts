import { useAiStore, useCreditStore } from '../state';
import { resolveTranscriptionProvider } from '../state/byo-runtime';
import { transcriptionBalanceIsShort } from './creditShortfall';
import { notifyInsufficientCredits } from './taskFailure';

/**
 * Before a paid partial transcription (the tail of a video): open the
 * credits dialog right away when the balance can't cover it. Returns true
 * when the run should not start.
 */
export function refuseShortTranscription(seconds: number): boolean {
  if (resolveTranscriptionProvider(useAiStore.getState() as any) !== 'stage5') {
    return false;
  }
  const { credits, authoritative } = useCreditStore.getState();
  if (!transcriptionBalanceIsShort({ seconds, credits, authoritative })) {
    return false;
  }
  notifyInsufficientCredits({
    kind: 'transcription',
    transcriptionSeconds: null,
  });
  return true;
}
