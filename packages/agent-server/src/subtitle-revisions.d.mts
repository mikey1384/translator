export interface TimedCue {
  id: string;
  start: number;
  end: number;
  source_ids?: string[];
  sourceCueIds?: string[];
}
export interface TimingIssue {
  code: string;
  cue_id: string;
  index: number;
  start: number;
  end: number;
  media_duration_seconds?: number;
}
export interface TimingRepairOptions {
  mediaDurationSeconds?: number | null;
  trimToMedia?: boolean;
  joinGapsUpToSeconds?: number;
  preserveGapAfterIds?: string[];
}
export function subtitleTimingIssues(
  segments: TimedCue[],
  mediaDurationSeconds?: number | null
): TimingIssue[];
export function repairSubtitleTimings<T extends TimedCue>(
  segments: T[],
  options?: TimingRepairOptions
): { segments: T[]; changes: Array<Record<string, unknown>> };
