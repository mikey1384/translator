import { SrtSegment } from '@shared-types/app';

export type ReviewBatch = {
  segments: SrtSegment[];
  startIndex: number;
  endIndex: number;
  targetLang: string;
  contextBefore: SrtSegment[];
  contextAfter: SrtSegment[];
};

export type GenerateSubtitlesFullResult = {
  subtitles: string;
  segments: SrtSegment[];
  speechIntervals: Array<{ start: number; end: number }>;
  tempFileSaved: boolean;
  tempFilePath?: string;
  tempFileError?: string;
  error?: string;
};
