// packages/shared/constants/runtime-config.ts
// All runtime configuration defaults live here – zero env access.

/* Rendering & Processing Timeouts */
export const SUBTITLE_RENDER_TIMEOUT = 120_000; // 2 minutes
export const WHISPER_PARALLEL = 3;
export const MAX_AI_PARALLEL = 4;

/* Audio Processing */
export const ASR_USE_FLAC = false; // Set to true to use FLAC instead of WebM
export const ASR_FAST_MODE = false; // Set to true for faster processing with lower quality

/* Subtitle Rendering */
export const BASELINE_HEIGHT = 720;
export const BASELINE_FONT_SIZE = 30;

/* Progress & UI */
export const DEBOUNCE_DELAY_MS = 300;
export const HEARTBEAT_INTERVAL_MS = 5_000; // Progress heartbeat every 5s

/* Video Processing */
export const MIN_VIDEO_HEIGHT = 360;
export const MIN_FONT_SCALE = 0.5;
export const MAX_FONT_SCALE = 2.0;

/* File Handling */
export const DEFAULT_FILENAME = 'edited_subtitles.srt';

/* Utility Functions */
export function fontScale(height: number): number {
  const effectiveHeight = Math.max(height, MIN_VIDEO_HEIGHT);
  return Math.min(
    Math.max(effectiveHeight / BASELINE_HEIGHT, MIN_FONT_SCALE),
    MAX_FONT_SCALE
  );
}
