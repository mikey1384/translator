export type SummaryFunnelEvent =
  | 'summary_started'
  | 'summary_completed'
  | 'summary_credit_blocked'
  | 'summary_cancelled'
  | 'summary_failed';

export function classifySummaryOutcome(result: {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}): Exclude<SummaryFunnelEvent, 'summary_started'> {
  if (result.success) return 'summary_completed';
  const errorMsg = String(result.error || '');
  // Check for the actual constant value 'insufficient-credits', not the identifier
  if (errorMsg.includes('insufficient-credits')) {
    return 'summary_credit_blocked';
  }
  if (result.cancelled) return 'summary_cancelled';
  return 'summary_failed';
}
