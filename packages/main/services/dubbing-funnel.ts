export type DubbingFunnelEvent =
  | 'dubbing_started'
  | 'dubbing_completed'
  | 'dubbing_credit_blocked'
  | 'dubbing_cancelled'
  | 'dubbing_failed';

export function classifyDubbingOutcome(result: {
  success: boolean;
  cancelled?: boolean;
  error?: string;
}): Exclude<DubbingFunnelEvent, 'dubbing_started'> {
  if (result.success) return 'dubbing_completed';
  const errorMsg = String(result.error || '');
  // Check for the actual constant value 'insufficient-credits', not the identifier
  if (errorMsg.includes('insufficient-credits')) {
    return 'dubbing_credit_blocked';
  }
  if (result.cancelled) return 'dubbing_cancelled';
  return 'dubbing_failed';
}
