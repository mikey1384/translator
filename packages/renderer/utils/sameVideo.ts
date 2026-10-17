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

/**
 * Whether a finished link download keeps the subtitles the user opened from
 * a file. Subtitles loaded with no video (or for a video they don't belong
 * to) follow the first downloaded video, but when the Change Video dialog
 * asked for the replacement its "Keep the current subtitles" choice is final.
 */
export function downloadKeepsFileOpenedSubtitles({
  replaceCurrent,
  subtitleCount,
  origin,
  libraryEntryId,
}: {
  replaceCurrent: boolean;
  subtitleCount: number;
  origin: string | null | undefined;
  libraryEntryId: string | null | undefined;
}): boolean {
  if (replaceCurrent) return false;
  return subtitleCount > 0 && origin === 'disk' && !libraryEntryId;
}
