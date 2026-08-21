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
  if (errorMsg.includes('INSUFFICIENT_CREDITS')) {
    return 'dubbing_credit_blocked';
  }
  if (result.cancelled) return 'dubbing_cancelled';
  return 'dubbing_failed';
}
