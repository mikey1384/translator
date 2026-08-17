export type TranslationFunnelEvent =
  | 'translation_started'
  | 'translation_completed'
  | 'translation_credit_blocked'
  | 'translation_cancelled'
  | 'translation_failed';

export function classifyTranslationOutcome(result: {
  success: boolean;
  blockedReason?: 'insufficient_credits';
  cancelled?: boolean;
}): Exclude<TranslationFunnelEvent, 'translation_started'> {
  if (result.success) return 'translation_completed';
  if (result.blockedReason === 'insufficient_credits') {
    return 'translation_credit_blocked';
  }
  if (result.cancelled) return 'translation_cancelled';
  return 'translation_failed';
}

export function isTranslationMeaningfulUse(
  event: TranslationFunnelEvent
): boolean {
  return event === 'translation_completed';
}
