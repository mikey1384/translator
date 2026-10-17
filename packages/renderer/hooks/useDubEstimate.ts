import { useMemo } from 'react';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useCreditCostEstimates } from './useCreditCostEstimates';
import {
  estimateDubbingCreditsFromChars,
  estimateTranslationCreditsFromChars,
} from '../utils/creditEstimates';
import {
  isDubbingBlockedInApiKeyMode,
  isDubbingByo,
  isTranslationByo,
  resolveDubbingCreditProvider,
  resolveEffectiveTranslationReviewModel,
} from '../state/byo-runtime';
import { dubCharCount, planDubText } from '../utils/dubPlan';

/**
 * What pressing Dub really costs: the voice, plus the translation it runs
 * first when the subtitles are not in the chosen language yet (and nothing
 * for a same-language "translation", which is skipped).
 */
export function useDubEstimate() {
  const order = useSubStore(s => s.order);
  const segmentMap = useSubStore(s => s.segments);
  const translatedLanguage = useSubStore(s => s.targetLanguage);
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const qualityTranslation = useUIStore(s => s.qualityTranslation);
  const { credits, runtimeState } = useCreditCostEstimates();

  const segments = useMemo(
    () => order.map(id => segmentMap[id]).filter(Boolean),
    [order, segmentMap]
  );
  const hasSubtitles = segments.some(seg =>
    String(seg.translation || seg.original || '').trim()
  );
  const plan = useMemo(
    () => planDubText(segments, targetLanguage, translatedLanguage),
    [segments, targetLanguage, translatedLanguage]
  );

  const estimate = useMemo(() => {
    if (!hasSubtitles) return null;
    const blocked = isDubbingBlockedInApiKeyMode(runtimeState);
    const dubCredits = isDubbingByo(runtimeState)
      ? 0
      : estimateDubbingCreditsFromChars(
          dubCharCount(segments, plan),
          resolveDubbingCreditProvider(runtimeState)
        );
    let translateCredits = 0;
    if (plan === 'translate' && !isTranslationByo(runtimeState)) {
      const originalChars = segments.reduce(
        (sum, seg) => sum + String(seg.original || '').trim().length,
        0
      );
      translateCredits = estimateTranslationCreditsFromChars(
        originalChars,
        qualityTranslation,
        resolveEffectiveTranslationReviewModel(runtimeState)
      );
    }
    const total = dubCredits + translateCredits;
    return {
      blocked,
      total,
      translateCredits,
      free: total === 0,
      hasEnoughCredits: !blocked && (credits == null || credits >= total),
    };
  }, [hasSubtitles, segments, plan, runtimeState, qualityTranslation, credits]);

  return { estimate, hasSubtitles, plan };
}
