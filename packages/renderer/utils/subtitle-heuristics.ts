// Shared subtitle utilities for heuristics and gap handling

export const UNCERTAIN_LOGPROB_MAX = -1.1; // avg_logprob <= -1.1
export const UNCERTAIN_NO_SPEECH_MIN = 0.5; // no_speech_prob >= 0.5
export const CPS_HIGH = 20; // characters per second considered too dense
export const CPS_LOW = 1; // characters per second considered too sparse
export const LONG_DUR_SEC = 10; // long duration threshold for sparsity check

export function flattenText(s: string | undefined | null): string {
  return String(s || '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}

// Minimal segment shape used by heuristics
type AnySeg = {
  id?: string;
  start?: number;
  end?: number;
  original?: string;
  avg_logprob?: number;
  no_speech_prob?: number;
};

export function isUncertainSeg(seg: AnySeg | undefined | null): boolean {
  if (!seg) return false;
  const lp = typeof seg.avg_logprob === 'number' ? seg.avg_logprob! : 0;
  const ns = typeof seg.no_speech_prob === 'number' ? seg.no_speech_prob! : 0;
  const text = flattenText(seg.original);
  const len = text.length;
  const dur = Math.max(0, (seg.end ?? 0) - (seg.start ?? 0));
  const cps = dur > 0 ? len / dur : len > 0 ? Infinity : 0;
  const tooDense = cps >= CPS_HIGH; // a lot of text in very short time
  const tooSparse =
    (dur >= LONG_DUR_SEC && cps <= CPS_LOW) ||
    (dur >= 60 && cps <= CPS_LOW * 2);
  const short = len <= 2; // extremely short text
  return (
    lp <= UNCERTAIN_LOGPROB_MAX ||
    ns >= UNCERTAIN_NO_SPEECH_MIN ||
    tooDense ||
    tooSparse ||
    short
  );
}

export function groupUncertainRanges(
  order: string[],
  segments: Record<string, AnySeg | undefined>
): Array<{ start: number; end: number; count: number; firstId?: string }> {
  const out: Array<{
    start: number;
    end: number;
    count: number;
    firstId?: string;
  }> = [];
  if (!Array.isArray(order) || order.length === 0) return out;

  let i = 0;
  while (i < order.length) {
    const id = order[i];
    const seg = segments[id];
    if (!seg || !isUncertainSeg(seg)) {
      i++;
      continue;
    }
    let start = seg.start ?? 0;
    let end = seg.end ?? start;
    let count = 1;
    const firstId = seg.id ?? id;
    let j = i + 1;
    while (j < order.length && isUncertainSeg(segments[order[j]])) {
      const s = segments[order[j]]!;
      start = Math.min(start, s.start ?? start);
      end = Math.max(end, s.end ?? end);
      count++;
      j++;
    }
    out.push({ start, end, count, firstId });
    i = j;
  }

  return out;
}

export function synthesizePlaceholdersWithinWindow(
  pieces: Array<{ start: number; end: number; original?: string }>,
  windowStart: number,
  windowEnd: number,
  minGapSec: number
): Array<{ start: number; end: number; original: string }> {
  const norm = pieces
    .map(p => ({
      start: Number(p.start) || 0,
      end: Number(p.end) || 0,
      original: flattenText(p.original),
    }))
    .filter(p => p.end > p.start)
    .sort((a, b) => a.start - b.start);

  const out: Array<{ start: number; end: number; original: string }> = [];
  let cursor = Math.max(0, windowStart);
  for (const p of norm) {
    if (p.start - cursor >= minGapSec) {
      out.push({ start: cursor, end: p.start, original: '' });
    }
    out.push({ start: p.start, end: p.end, original: p.original });
    cursor = p.end;
  }
  if (windowEnd - cursor >= minGapSec) {
    out.push({ start: cursor, end: windowEnd, original: '' });
  }
  return out;
}
