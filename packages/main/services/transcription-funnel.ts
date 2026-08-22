export type TranscriptionFunnelEvent =
  | 'transcription_started'
  | 'transcription_completed'
  | 'transcription_credit_blocked'
  | 'transcription_cancelled'
  | 'transcription_failed';

export function classifyTranscriptionOutcome(result: {
  success: boolean;
  blockedReason?: 'insufficient_credits';
  cancelled?: boolean;
}): Exclude<TranscriptionFunnelEvent, 'transcription_started'> {
  if (result.success) return 'transcription_completed';
  if (result.blockedReason === 'insufficient_credits') {
    return 'transcription_credit_blocked';
  }
  if (result.cancelled) return 'transcription_cancelled';
  return 'transcription_failed';
}
