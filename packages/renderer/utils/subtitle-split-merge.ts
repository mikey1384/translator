import type { SrtSegment } from '@shared-types/app';

/** Shortest piece a split may leave on either side, in seconds. */
const MIN_PIECE_SEC = 0.1;

export type SplitField = 'original' | 'translation';

const CJK_RX = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/u;

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Where to cut `text` near `ratio` (0..1) of its length: at the closest
 * space, or at the character itself in scripts written without spaces.
 */
export function splitIndexNearRatio(text: string, ratio: number): number {
  if (!text) return 0;
  const target = Math.round(text.length * Math.min(1, Math.max(0, ratio)));
  if (target <= 0 || target >= text.length) return target;
  let best = -1;
  for (let i = 0; i < text.length; i++) {
    if (!/\s/u.test(text[i])) continue;
    if (best === -1 || Math.abs(i - target) < Math.abs(best - target)) {
      best = i;
    }
  }
  return best === -1 ? target : best;
}

/**
 * Split one line in two at `caret` in `field` (the other field is cut at the
 * matching place). Time is divided in proportion to the text before the
 * caret. With no usable caret, the line is cut near its middle. Returns null
 * when the line is too short to split.
 */
export function splitCue(
  cue: SrtSegment,
  {
    field = 'original',
    caret,
    newId,
  }: { field?: SplitField; caret?: number | null; newId: string }
): [SrtSegment, SrtSegment] | null {
  const duration = cue.end - cue.start;
  if (!(duration >= MIN_PIECE_SEC * 2)) return null;

  const primary =
    (field === 'translation' ? cue.translation : cue.original) ?? '';
  const secondaryField: SplitField =
    field === 'translation' ? 'original' : 'translation';
  const secondary =
    (secondaryField === 'translation' ? cue.translation : cue.original) ?? '';

  let cut =
    typeof caret === 'number' && caret > 0 && caret < primary.trimEnd().length
      ? caret
      : -1;
  if (cut === -1) {
    // No caret inside the text: cut the line near its middle.
    cut = primary.trim() ? splitIndexNearRatio(primary, 0.5) : 0;
  }
  const ratio = primary.length > 0 ? cut / primary.length : 0.5;
  const effectiveRatio = ratio > 0 && ratio < 1 ? ratio : 0.5;

  const splitAt = roundMs(
    Math.min(
      cue.end - MIN_PIECE_SEC,
      Math.max(cue.start + MIN_PIECE_SEC, cue.start + duration * effectiveRatio)
    )
  );

  const secondaryCut = splitIndexNearRatio(secondary, effectiveRatio);
  const parts: Record<SplitField, [string, string]> = {
    original: ['', ''],
    translation: ['', ''],
  };
  parts[field] = [primary.slice(0, cut).trim(), primary.slice(cut).trim()];
  parts[secondaryField] = [
    secondary.slice(0, secondaryCut).trim(),
    secondary.slice(secondaryCut).trim(),
  ];

  const hasTranslation = typeof cue.translation === 'string';
  const first: SrtSegment = {
    ...cue,
    sourceCueIds: cue.sourceCueIds ?? [cue.id],
    end: splitAt,
    original: parts.original[0],
    // Word timings belonged to the whole line's text.
    words: undefined,
  };
  const second: SrtSegment = {
    ...cue,
    sourceCueIds: cue.sourceCueIds ?? [cue.id],
    id: newId,
    start: splitAt,
    original: parts.original[1],
    words: undefined,
  };
  if (hasTranslation || parts.translation[0] || parts.translation[1]) {
    first.translation = parts.translation[0];
    second.translation = parts.translation[1];
  }
  delete first._oldText;
  delete second._oldText;
  return [first, second];
}

/** Joins two pieces of text with a space, or none between CJK characters. */
export function joinCueText(a: string, b: string): string {
  const left = (a ?? '').trim();
  const right = (b ?? '').trim();
  if (!left) return right;
  if (!right) return left;
  const noSpace = CJK_RX.test(left[left.length - 1]) && CJK_RX.test(right[0]);
  return noSpace ? `${left}${right}` : `${left} ${right}`;
}

/** One line covering both: first start to the later end, texts joined. */
export function mergeCues(a: SrtSegment, b: SrtSegment): SrtSegment {
  const merged: SrtSegment = {
    ...a,
    sourceCueIds: [
      ...new Set([
        ...(a.sourceCueIds ?? [a.id]),
        ...(b.sourceCueIds ?? [b.id]),
      ]),
    ],
    start: Math.min(a.start, b.start),
    end: Math.max(a.end, b.end),
    original: joinCueText(a.original, b.original),
    words: undefined,
  };
  if (typeof a.translation === 'string' || typeof b.translation === 'string') {
    merged.translation = joinCueText(a.translation ?? '', b.translation ?? '');
  }
  delete merged._oldText;
  return merged;
}
