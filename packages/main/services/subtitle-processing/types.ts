import {
  SrtSegment,
  GenerateSubtitlesOptions,
  GenerateProgressCallback,
} from '@shared-types/app';
import { AbortSignal } from 'node:events';
import OpenAI from 'openai';

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

export { SrtSegment, GenerateSubtitlesOptions, GenerateProgressCallback };
