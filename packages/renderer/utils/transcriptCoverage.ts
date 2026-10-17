/** Gap after the last line that counts as "transcription stopped early". */
export const CONTINUE_TRANSCRIBING_MIN_GAP_SEC = 60;

/**
 * Where the subtitles stop when they end well before the video does (a
 * stopped or partial transcription), else null.
 */
export function transcriptStopsEarlyAt({
  durationSecs,
  lastEndSecs,
}: {
  durationSecs: number | null | undefined;
  lastEndSecs: number | null | undefined;
}): number | null {
  if (typeof durationSecs !== 'number' || !Number.isFinite(durationSecs))
    return null;
  if (typeof lastEndSecs !== 'number' || !Number.isFinite(lastEndSecs))
    return null;
  return durationSecs - lastEndSecs >= CONTINUE_TRANSCRIBING_MIN_GAP_SEC
    ? lastEndSecs
    : null;
}

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClockTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
