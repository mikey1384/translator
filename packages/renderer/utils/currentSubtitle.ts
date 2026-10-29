/** The playing cue, or the closest cue in a pause/before/after speech. */
export function currentSubtitleIndex(
  cues: ReadonlyArray<{ start: number; end: number }>,
  time: number
): number {
  if (!Number.isFinite(time)) return -1;
  let nearest = -1;
  let distance = Infinity;
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end)) continue;
    if (time >= cue.start && time < cue.end) return index;
    const gap = Math.min(Math.abs(time - cue.start), Math.abs(time - cue.end));
    if (gap < distance) {
      distance = gap;
      nearest = index;
    }
  }
  return nearest;
}
