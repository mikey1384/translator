import { useAiStore, useCreditStore } from '../../../state';
import { getTranscriptionActionState } from '../../../state/byo-runtime';
import { estimateTranscriptionCreditsForSeconds } from '../../../utils/creditEstimates';

export type TranscriptionCostPreview = {
  requiredCredits: number;
  // Null when the app has no authoritative balance yet; only the cost is shown.
  availableCredits: number | null;
};

/**
 * What transcribing this video will cost in Stage5 credits, shown before it
 * starts so nobody learns it from a refusal halfway through. Null when
 * transcription runs on the user's own ElevenLabs key, is blocked, or the
 * duration is not known yet.
 */
export function useTranscriptionCostPreview(
  durationSecs: number | null | undefined
): TranscriptionCostPreview | null {
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const availableCredits = useCreditStore(s =>
    s.authoritative ? s.credits : null
  );

  const state = getTranscriptionActionState({
    useApiKeysMode,
    byoElevenLabsUnlocked,
    elevenLabsKeyPresent,
    useByoElevenLabs,
    preferredTranscriptionProvider,
  });
  if (state.kind !== 'credits') return null;
  if (typeof durationSecs !== 'number' || !(durationSecs > 0)) return null;

  return {
    requiredCredits: estimateTranscriptionCreditsForSeconds(durationSecs),
    availableCredits,
  };
}
