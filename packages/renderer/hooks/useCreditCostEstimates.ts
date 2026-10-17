import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStore } from '../state/ai-store';
import { useCreditStore } from '../state/credit-store';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import {
  estimateDubbingCreditsFromChars,
  estimateTranslationCreditsFromChars,
  formatCreditBalance,
  formatCredits,
} from '../utils/creditEstimates';
import {
  isDubbingBlockedInApiKeyMode,
  isDubbingByo,
  isTranslationByo,
  resolveDubbingCreditProvider,
  resolveEffectiveTranslationReviewModel,
  type ByoRuntimeState,
} from '../state/byo-runtime';

/**
 * Credit cost of translating and dubbing the mounted subtitles, shared by
 * every place those actions can start (the Step 2 panel and the video side
 * menu) so no entry point starts a paid job without showing what it costs.
 */
export function useCreditCostEstimates() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  // Dubbing cost estimation
  const segments = useSubStore(s => s.segments);
  const order = useSubStore(s => s.order);
  const credits = useCreditStore(s => s.credits);
  const byoUnlocked = useAiStore(s => s.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(s => s.byoAnthropicUnlocked);
  const byoElevenLabsUnlocked = useAiStore(s => s.byoElevenLabsUnlocked);
  const stage5AnthropicReviewAvailable = useAiStore(
    s => s.stage5AnthropicReviewAvailable
  );
  const preferredTranscriptionProvider = useAiStore(
    s => s.preferredTranscriptionProvider
  );
  const preferredDubbingProvider = useAiStore(s => s.preferredDubbingProvider);
  const stage5DubbingTtsProvider = useAiStore(s => s.stage5DubbingTtsProvider);
  const useApiKeysMode = useAiStore(s => s.useApiKeysMode);
  const useByo = useAiStore(s => s.useByo);
  const keyPresent = useAiStore(s => s.keyPresent);
  const anthropicKeyPresent = useAiStore(s => s.anthropicKeyPresent);
  const useByoAnthropic = useAiStore(s => s.useByoAnthropic);
  const useByoElevenLabs = useAiStore(s => s.useByoElevenLabs);
  const elevenLabsKeyPresent = useAiStore(s => s.elevenLabsKeyPresent);
  const preferClaudeTranslation = useAiStore(s => s.preferClaudeTranslation);
  const preferClaudeReview = useAiStore(s => s.preferClaudeReview);
  const preferClaudeSummary = useAiStore(s => s.preferClaudeSummary);

  const runtimeState = useMemo<ByoRuntimeState>(
    () => ({
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
      useByo,
      useByoAnthropic,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    }),
    [
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      byoElevenLabsUnlocked,
      stage5AnthropicReviewAvailable,
      useByo,
      useByoAnthropic,
      useByoElevenLabs,
      keyPresent,
      anthropicKeyPresent,
      elevenLabsKeyPresent,
      preferClaudeTranslation,
      preferClaudeReview,
      preferClaudeSummary,
      preferredTranscriptionProvider,
      preferredDubbingProvider,
      stage5DubbingTtsProvider,
    ]
  );

  // Calculate total character count from subtitles (use translation if available, else original)
  const dubbingEstimate = useMemo(() => {
    let charCount = 0;
    for (const id of order) {
      const seg = segments[id];
      if (!seg) continue;
      const text = (seg.translation || seg.original || '').trim();
      charCount += text.length;
    }
    if (charCount === 0) return null;

    // Dubbing is ElevenLabs-only (eleven_v4); the estimate uses that price.
    const ttsProvider = resolveDubbingCreditProvider(runtimeState);
    const isByo = isDubbingByo(runtimeState);
    const blockedInApiKeyMode = isDubbingBlockedInApiKeyMode(runtimeState);

    const estimatedCredits = estimateDubbingCreditsFromChars(
      charCount,
      ttsProvider
    );

    return {
      charCount,
      ttsProvider,
      estimatedCredits,
      isByo,
      blockedInApiKeyMode,
      hasEnoughCredits:
        !blockedInApiKeyMode &&
        (isByo || credits == null || credits >= estimatedCredits),
    };
  }, [order, segments, credits, runtimeState]);

  // Translation cost estimation
  const qualityTranslation = useUIStore(s => s.qualityTranslation);

  const translationEstimate = useMemo(() => {
    let charCount = 0;
    for (const id of order) {
      const seg = segments[id];
      if (!seg) continue;
      // Translation is based on original text
      const text = (seg.original || '').trim();
      charCount += text.length;
    }
    if (charCount === 0) return null;

    const isByo = isTranslationByo(runtimeState);
    const reviewModel = resolveEffectiveTranslationReviewModel(runtimeState);

    const estimatedCredits = estimateTranslationCreditsFromChars(
      charCount,
      qualityTranslation,
      reviewModel
    );
    return {
      charCount,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
      qualityEnabled: qualityTranslation,
    };
  }, [order, segments, credits, qualityTranslation, runtimeState]);

  // Cost next to the balance it comes out of: a bare "~132k cr" did not tell
  // anyone that a dub would use most of what they had just bought.
  const formatCostLabel = (estimatedCredits: number) =>
    credits != null
      ? t('credits.costOfBalance', '{{cost}} of your {{balance}} credits', {
          cost: formatCredits(estimatedCredits, locale),
          balance: formatCreditBalance(credits, locale),
        })
      : t('credits.estimateAmount', '{{credits}} credits', {
          credits: formatCredits(estimatedCredits, locale),
        });

  return {
    credits,
    runtimeState,
    dubbingEstimate,
    translationEstimate,
    formatCostLabel,
  };
}
