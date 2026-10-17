/**
 * One rule for which cue is on screen, shared by the player and the burned-in
 * export so they never disagree: a cue shows while start <= t <= end, and
 * when cues overlap the one that started later wins (ties go to the cue that
 * comes later in the list).
 */

export type TimedCue = { start: number; end: number };

function wins(
  cues: readonly TimedCue[],
  candidate: number,
  current: number
): boolean {
  if (current < 0) return true;
  const a = cues[candidate];
  const b = cues[current];
  return a.start > b.start || (a.start === b.start && candidate > current);
}

/** Index of the cue showing at time `t`, or -1 when none is. */
export function findActiveCueIndex(
  cues: readonly TimedCue[],
  t: number
): number {
  let best = -1;
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (!cue || !(cue.start <= t && t <= cue.end)) continue;
    if (wins(cues, i, best)) best = i;
  }
  return best;
}

export type CueTimelineSpan = { start: number; end: number; cueIndex: number };

/**
 * The same rule as `findActiveCueIndex`, as contiguous spans: which cue
 * shows from each boundary to the next. Spans with no cue are left out.
 * Cue times past `limit` are clamped to it; empty cues are ignored.
 */
export function buildCueTimeline(
  cues: readonly TimedCue[],
  limit = Number.POSITIVE_INFINITY
): CueTimelineSpan[] {
  const valid: number[] = [];
  const boundaries = new Set<number>();
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (!cue) continue;
    const start = Math.max(0, cue.start);
    const end = Math.min(cue.end, limit);
    if (!(start < end)) continue;
    valid.push(i);
    boundaries.add(start);
    boundaries.add(end);
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const byStart = [...valid].sort(
    (a, b) => Math.max(0, cues[a].start) - Math.max(0, cues[b].start) || a - b
  );

  const spans: CueTimelineSpan[] = [];
  const active = new Set<number>();
  let next = 0;
  for (let p = 0; p < points.length - 1; p += 1) {
    const from = points[p];
    const to = points[p + 1];
    while (
      next < byStart.length &&
      Math.max(0, cues[byStart[next]].start) <= from
    ) {
      active.add(byStart[next]);
      next += 1;
    }
    let best = -1;
    for (const index of active) {
      if (Math.min(cues[index].end, limit) <= from) {
        active.delete(index);
        continue;
      }
      if (wins(cues, index, best)) best = index;
    }
    if (best < 0) continue;
    const last = spans.at(-1);
    if (last && last.cueIndex === best && last.end === from) {
      last.end = to;
    } else {
      spans.push({ start: from, end: to, cueIndex: best });
    }
  }
  return spans;
}
