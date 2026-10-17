import { useAiStore } from '../state/ai-store';
import { useCreditStore } from '../state/credit-store';
import { openCreditRanOut } from '../state/modal-store';
import {
  getTranscriptionActionState,
  resolveTranslationDraftProvider,
  type ByoRuntimeState,
} from '../state/byo-runtime';

/**
 * Whether a credit-paid action should stop before it starts because the
 * balance is known to be empty. Unknown balances (still loading, offline)
 * let the request go: the server is the authority.
 */
export function isKnownOutOfCredits(
  credits: number | null | undefined
): boolean {
  return (
    typeof credits === 'number' && Number.isFinite(credits) && credits <= 0
  );
}

/**
 * Before a short transcription (one line, Improve): with Stage5 credits at
 * zero, show the credits dialog instead of a progress window that can only
 * end in a refusal. Returns true when the action may go ahead.
 */
export function precheckTranscriptionCredits(): boolean {
  const ai = useAiStore.getState();
  const route = getTranscriptionActionState({
    useApiKeysMode: ai.useApiKeysMode,
    byoElevenLabsUnlocked: ai.byoElevenLabsUnlocked,
    elevenLabsKeyPresent: ai.elevenLabsKeyPresent,
    useByoElevenLabs: ai.useByoElevenLabs,
    preferredTranscriptionProvider: ai.preferredTranscriptionProvider,
  });
  if (route.kind !== 'credits') return true;
  if (!isKnownOutOfCredits(useCreditStore.getState().credits)) return true;
  void openCreditRanOut({ kind: 'transcription', transcriptionSeconds: null });
  return false;
}

function byoRuntimeState(): ByoRuntimeState {
  const ai = useAiStore.getState();
  return {
    useApiKeysMode: ai.useApiKeysMode,
    byoUnlocked: ai.byoUnlocked,
    byoAnthropicUnlocked: ai.byoAnthropicUnlocked,
    byoElevenLabsUnlocked: ai.byoElevenLabsUnlocked,
    stage5AnthropicReviewAvailable: ai.stage5AnthropicReviewAvailable,
    useByo: ai.useByo,
    useByoAnthropic: ai.useByoAnthropic,
    useByoElevenLabs: ai.useByoElevenLabs,
    keyPresent: ai.keyPresent,
    anthropicKeyPresent: ai.anthropicKeyPresent,
    elevenLabsKeyPresent: ai.elevenLabsKeyPresent,
    preferClaudeTranslation: ai.preferClaudeTranslation,
    preferClaudeReview: ai.preferClaudeReview,
    preferClaudeSummary: ai.preferClaudeSummary,
    preferredTranscriptionProvider: ai.preferredTranscriptionProvider,
    preferredDubbingProvider: ai.preferredDubbingProvider,
    stage5DubbingTtsProvider: ai.stage5DubbingTtsProvider,
  } as ByoRuntimeState;
}

/** The same check before translating one line with Stage5 credits. */
export function precheckTranslationCredits(): boolean {
  if (resolveTranslationDraftProvider(byoRuntimeState()) !== 'stage5') {
    return true;
  }
  if (!isKnownOutOfCredits(useCreditStore.getState().credits)) return true;
  void openCreditRanOut({ kind: 'translation', transcriptionSeconds: null });
  return false;
}
