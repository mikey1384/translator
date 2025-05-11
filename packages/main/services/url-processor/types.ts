export type VideoQuality = 'low' | 'mid' | 'high';
export interface ProgressInfo {
  percent: number;
  stage: string;
  error?: string | null;
}
export type ProgressCallback = (info: ProgressInfo) => void;
