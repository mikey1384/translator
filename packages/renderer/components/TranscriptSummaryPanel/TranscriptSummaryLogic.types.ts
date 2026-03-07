export type SummaryEstimate = {
  charCount: number;
  estimatedCredits: number;
  isByo: boolean;
  hasEnoughCredits: boolean;
};

export type CombineCutState = {
  status: 'idle' | 'cutting' | 'ready' | 'error' | 'cancelled';
  percent: number;
  error?: string;
  operationId?: string | null;
  outputPath?: string;
};
