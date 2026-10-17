/** Seconds two durations may differ and still be the same video. */
export const SAME_VIDEO_DURATION_TOLERANCE_SEC = 1;

/**
 * True when a newly chosen file is most likely another copy of the video
 * already open (a re-encode, a re-download), judged by length. Subtitles only
 * follow a replacement when this holds; a different video starts without the
 * old video's subtitles.
 */
export function durationsLookLikeSameVideo(
  current: number | null | undefined,
  next: number | null | undefined
): boolean {
  if (
    typeof current !== 'number' ||
    typeof next !== 'number' ||
    !Number.isFinite(current) ||
    !Number.isFinite(next) ||
    current <= 0 ||
    next <= 0
  ) {
    return false;
  }
  return Math.abs(current - next) <= SAME_VIDEO_DURATION_TOLERANCE_SEC;
}
