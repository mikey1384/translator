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

// H.264 plays in Translator's player on every machine; HEVC does not (TikTok
// and Twitch clips often serve it). Off YouTube, take an H.264 rendition whose
// short side is at least ~2/3 of the wanted one (1080p wanted: 720p+ H.264 is
// fine), otherwise the normal pick; a non-web codec result is re-encoded after
// download (playback-compat.ts). Portrait videos are measured by width, so a
// 720x1280 phone video counts as 720p.
const H264_VCODEC = "[vcodec~='^(?:avc|h264)']";

export function minPreferredH264Height(capHeight: number): number {
  return Math.min(capHeight, Math.max(360, Math.round((capHeight * 2) / 3)));
}

export function withH264Preference(
  format: string,
  capHeightValue: number | null
): string {
  // Uncapped ("best") keeps the best picture; only the sort breaks ties.
  if (capHeightValue === null || !Number.isFinite(capHeightValue)) {
    return format;
  }
  const min = minPreferredH264Height(capHeightValue);
  const landscape = `${H264_VCODEC}[aspect_ratio>=1][height>=${min}][height<=${capHeightValue}]`;
  const portrait = `${H264_VCODEC}[aspect_ratio<1][width>=${min}][width<=${capHeightValue}]`;
  return [
    `bv*${landscape}+ba`,
    `bv*${portrait}+ba`,
    `b${landscape}`,
    `b${portrait}`,
    format,
  ].join('/');
}

/** Same resolution and frame rate: H.264 first, HEVC last among equals. */
export const NON_YOUTUBE_SORT = 'res,fps,vcodec:h264';
