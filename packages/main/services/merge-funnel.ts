export type MergeFunnelEvent =
  | 'merge_started'
  | 'merge_completed'
  | 'merge_cancelled'
  | 'merge_failed';

export function classifyMergeOutcome(result: {
  success: boolean;
  cancelled?: boolean;
}): Exclude<MergeFunnelEvent, 'merge_started'> {
  if (result.success) return 'merge_completed';
  if (result.cancelled) return 'merge_cancelled';
  return 'merge_failed';
}
