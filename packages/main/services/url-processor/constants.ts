import { VideoQuality } from './types.js';

export const PROGRESS = {
  WARMUP_START: 0,
  WARMUP_END: 5,

  // First stream (typically video): 5→70
  DL1_START: 5,
  DL1_END: 70,

  // Second stream (typically audio): 70→90
  DL2_START: 70,
  DL2_END: 90,

  FINAL_START: 90,
  FINAL_END: 100,
} as const;

const capHeight = (height: number) =>
  `bv*[height<=${height}]+ba/b[height<=${height}]/b[height<=${height}]`;

export const qualityFormatMap: Record<VideoQuality, string> = {
  // Absolute best: do not restrict container/codec; let yt-dlp pick highest
  high: 'bestvideo+bestaudio/best',
  // Medium should align with the explicit 720p option expectation.
  mid: capHeight(720),
  // Low keeps a conservative, broadly compatible profile
  low:
    'bv*[height<=480]+ba[abr<=128]/b[height<=480]/' +
    'bv*[height<=480][ext=mp4]+ba[ext=m4a][abr<=128]/b[height<=480][ext=mp4]',

  // Explicit resolution caps (max height)
  '4320p': capHeight(4320), // 8K
  '2160p': capHeight(2160), // 4K
  '1440p': capHeight(1440), // 2K
  '1080p': capHeight(1080),
  '720p': capHeight(720),
  '480p': capHeight(480),
  '360p': capHeight(360),
  '240p': capHeight(240),
};
