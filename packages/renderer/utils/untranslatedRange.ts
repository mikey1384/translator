import { currentSubtitleIndex } from './currentSubtitle';

/**
 * Which untranslated lines a "translate from here" run covers. Pure so the
 * range rules can be tested without the stores.
 */
export interface RangeCue {
  id: string;
  start: number;
  end: number;
  original?: string | null;
  translation?: string | null;
}

/** A line with text to translate and no translation yet. */
export function isUntranslatedCue(cue: RangeCue | undefined | null): boolean {
  return Boolean(
    cue &&
    String(cue.original ?? '').trim() &&
    !String(cue.translation ?? '').trim()
  );
}

function isTranslatedCue(cue: RangeCue | undefined | null): boolean {
  return Boolean(cue && String(cue.translation ?? '').trim());
}

export interface UntranslatedRun {
  /** Position of the first untranslated line in the run. */
  firstIndex: number;
  /** Position of the last untranslated line in the run. */
  lastIndex: number;
  /** The untranslated lines to send, in order. */
  ids: string[];
  /** The already-translated line the run stops before, or -1 at the end. */
  stopIndex: number;
}

/**
 * From `fromIndex` forward: the first untranslated line at or after it, then
 * every following line up to (not including) the next translated one.
 * Lines with no text inside the run are passed over, never sent. Null when
 * nothing after `fromIndex` is untranslated.
 */
export function untranslatedRunFrom(
  cues: ReadonlyArray<RangeCue>,
  fromIndex: number
): UntranslatedRun | null {
  if (!Number.isInteger(fromIndex) || fromIndex < 0) return null;
  let first = -1;
  for (let i = fromIndex; i < cues.length; i++) {
    if (isUntranslatedCue(cues[i])) {
      first = i;
      break;
    }
  }
  if (first === -1) return null;
  const ids: string[] = [];
  let last = first;
  let stopIndex = -1;
  for (let i = first; i < cues.length; i++) {
    const cue = cues[i];
    if (isTranslatedCue(cue)) {
      stopIndex = i;
      break;
    }
    if (isUntranslatedCue(cue)) {
      ids.push(cue.id);
      last = i;
    }
  }
  return { firstIndex: first, lastIndex: last, ids, stopIndex };
}

/** Where "from here" starts when no line was picked: the line playing now. */
export function startIndexForTime(
  cues: ReadonlyArray<RangeCue>,
  time: number
): number {
  return currentSubtitleIndex(cues, time);
}

/** Every untranslated line, wherever it is. */
export function allUntranslatedIds(cues: ReadonlyArray<RangeCue>): string[] {
  return cues.filter(isUntranslatedCue).map(cue => cue.id);
}

/**
 * The lines a "translate missing" run sends: untranslated lines with text,
 * limited to `ids` when given (a "from here" range). Lines that already have
 * a translation are never sent, even when listed.
 */
export function selectMissingSegments<
  T extends { id: string; original?: string; translation?: string },
>(segments: ReadonlyArray<T>, ids?: ReadonlyArray<string>): T[] {
  const only = ids ? new Set(ids) : null;
  return segments.filter(
    s =>
      (!only || only.has(s.id)) &&
      (s.original || '').trim() &&
      !(s.translation || '').trim()
  );
}
