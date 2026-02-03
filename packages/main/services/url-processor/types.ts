export type VideoQuality =
  | 'high'
  | 'mid'
  | 'low'
  // Explicit resolution caps (max height). Values are string-literals so we can
  // round-trip them through IPC safely.
  | '4320p'
  | '2160p'
  | '1440p'
  | '1080p'
  | '720p'
  | '480p'
  | '360p'
  | '240p';
export interface ProgressInfo {
  percent: number;
  stage: string;
  error?: string | null;
}
export type ProgressCallback = (info: ProgressInfo) => void;
