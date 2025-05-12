import { SrtSegment } from '@shared-types/app';

export type ReviewBatch = {
  segments: SrtSegment[];
  startIndex: number;
  endIndex: number;
  targetLang: string;
  contextBefore: SrtSegment[];
  contextAfter: SrtSegment[];
};

export type TranslateBatchArgs = {
  batch: {
    segments: SrtSegment[];
    startIndex: number;
    endIndex: number;
    contextBefore: SrtSegment[];
    contextAfter: SrtSegment[];
  };
  targetLang: string;
  operationId: string;
  signal?: AbortSignal;
};

export type GenerateSubtitlesFullResult = {
  subtitles: string;
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  error?: string;
};
