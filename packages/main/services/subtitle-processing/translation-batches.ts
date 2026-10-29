import type { SrtSegment } from '@shared-types/app';

export type TranslationWindow = {
  start: number;
  end: number;
  contextStart: number;
  contextEnd: number;
};
/** Bound both cue count and UTF-8 text size (CJK text is not cheap per character).
 * Neighbouring context is retained, but paid target ranges never overlap.
 * A single long cue stays intact in its own request. */
export function planTranslationWindows(
  segments: SrtSegment[],
  phase: 'draft' | 'review'
): TranslationWindow[] {
  const maxCues = 40;
  const maxBytes = phase === 'review' ? 12_000 : 8_000;
  const contextCues = phase === 'review' ? 15 : 12;
  const windows: TranslationWindow[] = [];
  const textBytes = (cue: SrtSegment) =>
    Buffer.byteLength(cue.original || '', 'utf8') +
    (phase === 'review' ? Buffer.byteLength(cue.translation || '', 'utf8') : 0);
  for (let start = 0; start < segments.length; ) {
    let end = start;
    let bytes = 0;
    while (end < segments.length && end - start < maxCues) {
      const cue = segments[end];
      const size = textBytes(cue);
      if (end > start && bytes + size > maxBytes) break;
      bytes += size;
      end++;
    }
    let contextStart = start;
    let contextEnd = end;
    let contextBytes = 0;
    while (contextStart > 0 && start - contextStart < contextCues) {
      const size = textBytes(segments[contextStart - 1]);
      if (contextBytes + size > maxBytes / 2) break;
      contextBytes += size;
      contextStart--;
    }
    contextBytes = 0;
    while (contextEnd < segments.length && contextEnd - end < contextCues) {
      const size = textBytes(segments[contextEnd]);
      if (contextBytes + size > maxBytes / 2) break;
      contextBytes += size;
      contextEnd++;
    }
    windows.push({ start, end, contextStart, contextEnd });
    start = end;
  }
  return windows;
}
