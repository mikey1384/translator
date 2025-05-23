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
  high: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best[ext=mp4]/best',
  mid: 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]',
  low: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a][abr<=128]/bestvideo[height<=480]+bestaudio[abr<=128]/best[height<=480]',
};
