// Parsing and validation for the editor's start/end time fields.

/**
 * Reads a typed timecode. Accepts full SRT times (`00:01:02,500`) and the
 * short forms people actually type: `1:02`, `1:02.5`, `62.5`, `1:00:02`.
 * Returns seconds, or null when the text isn't a time.
 */
export function parseTimecodeInput(raw: string): number | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const match =
    /^(?:(\d{1,3}):)??(?:(\d{1,2}):)?(\d{1,5})(?:[,.](\d{1,3}))?$/.exec(value);
  if (!match) return null;
  const [, hoursRaw, minutesRaw, secondsRaw, fractionRaw] = match;
  const hours = hoursRaw ? Number(hoursRaw) : 0;
  const minutes = minutesRaw ? Number(minutesRaw) : 0;
  const seconds = Number(secondsRaw);
  // With a minutes field, seconds must be a clock value (0-59); a bare
  // number of seconds ("90") may be any size. Same for minutes under hours.
  if (minutesRaw !== undefined && seconds > 59) return null;
  if (hoursRaw !== undefined && minutes > 59) return null;
  const fraction = fractionRaw ? Number(fractionRaw.padEnd(3, '0')) / 1000 : 0;
  const total = hours * 3600 + minutes * 60 + seconds + fraction;
  return Number.isFinite(total) ? Math.round(total * 1000) / 1000 : null;
}

export type TimecodeEditError = 'unreadable' | 'endBeforeStart';

/**
 * Validates an edit to one side of a cue. The stored cue only changes when
 * the result is ok, so the field never shows a value the file won't have.
 */
export function validateCueTimeEdit(args: {
  field: 'start' | 'end';
  input: string;
  start: number;
  end: number;
}): { ok: true; seconds: number } | { ok: false; error: TimecodeEditError } {
  const seconds = parseTimecodeInput(args.input);
  if (seconds === null) return { ok: false, error: 'unreadable' };
  const nextStart = args.field === 'start' ? seconds : args.start;
  const nextEnd = args.field === 'end' ? seconds : args.end;
  if (!(nextEnd > nextStart)) return { ok: false, error: 'endBeforeStart' };
  return { ok: true, seconds };
}

export type CueOverlap = 'previous' | 'next' | 'both';

// Times are kept to the millisecond; anything closer is touching, not overlap.
const OVERLAP_EPSILON = 0.0005;

/**
 * Whether a cue's times run into its neighbours: it starts before the
 * previous line ends, or ends after the next line starts. The edit still
 * applies (overlaps can be deliberate); the editor only warns.
 */
export function findCueOverlap(args: {
  start: number;
  end: number;
  previousEnd?: number | null;
  nextStart?: number | null;
}): CueOverlap | null {
  const overlapsPrevious =
    typeof args.previousEnd === 'number' &&
    args.start < args.previousEnd - OVERLAP_EPSILON;
  const overlapsNext =
    typeof args.nextStart === 'number' &&
    args.end > args.nextStart + OVERLAP_EPSILON;
  if (overlapsPrevious && overlapsNext) return 'both';
  if (overlapsPrevious) return 'previous';
  if (overlapsNext) return 'next';
  return null;
}
