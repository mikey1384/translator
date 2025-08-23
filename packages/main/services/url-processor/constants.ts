import { VideoQuality } from './types.js';

export const PROGRESS = {
  WARMUP_START: 0,
  WARMUP_END: 10,

  DL1_START: 10,
  DL1_END: 40,

  FINAL_START: 40,
  FINAL_END: 100,
} as const;

export const qualityFormatMap: Record<VideoQuality, string> = {
  high: 'bv*+ba/b',
  mid:
    'bv*[height<=720]+ba/b[height<=720]/' +
    'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]',
  low:
    'bv*[height<=480]+ba[abr<=128]/b[height<=480]/' +
    'bv*[height<=480][ext=mp4]+ba[ext=m4a][abr<=128]/b[height<=480][ext=mp4]',
};
