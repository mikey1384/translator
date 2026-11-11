import type { SrtSegment } from '@shared-types/app';
import { translationReviewStatus } from '../../../shared/helpers/translation-review.js';

export type TranslationWindow = {
  start: number;
  end: number;
  contextStart: number;
  contextEnd: number;
};

/** Credit recovery keeps each cue intact and limits source-only context.
 * Child targets never overlap; even a very long neighbouring cue is omitted
 * rather than making every smaller request as expensive as the parent. */
export function creditRecoveryWindow(
  segments: SrtSegment[],
  start: number,
  end: number
): TranslationWindow {
  const targetBytes = segments
    .slice(start, end)
    .reduce(
      (sum, segment) => sum + Buffer.byteLength(segment.original || '', 'utf8'),
      0
    );
  const contextBudget =
    end - start === 1 ? 0 : Math.min(512, Math.floor(targetBytes / 4));
  let contextStart = start;
  let contextEnd = end;
  let bytes = 0;
  while (contextStart > 0 && start - contextStart < 2) {
    const size = Buffer.byteLength(
      segments[contextStart - 1].original || '',
      'utf8'
    );
    if (bytes + size > contextBudget) break;
    bytes += size;
    contextStart--;
  }
  bytes = 0;
  while (contextEnd < segments.length && contextEnd - end < 2) {
    const size = Buffer.byteLength(segments[contextEnd].original || '', 'utf8');
    if (bytes + size > contextBudget) break;
    bytes += size;
    contextEnd++;
  }
  return { start, end, contextStart, contextEnd };
}
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

export function planPendingReviewWindows(
  segments: SrtSegment[],
  targetLanguage: string
): TranslationWindow[] {
  return planTranslationWindows(segments, 'review').flatMap(window => {
    const pending: TranslationWindow[] = [];
    for (let start = window.start; start < window.end; ) {
      if (
        translationReviewStatus(segments[start], targetLanguage) !== 'pending'
      ) {
        start++;
        continue;
      }
      let end = start + 1;
      while (
        end < window.end &&
        translationReviewStatus(segments[end], targetLanguage) === 'pending'
      )
        end++;
      let contextStart = start;
      let contextEnd = end;
      const size = (i: number) =>
        Buffer.byteLength(segments[i].original || '', 'utf8') +
        Buffer.byteLength(segments[i].translation || '', 'utf8');
      let bytes = 0;
      while (contextStart > 0 && start - contextStart < 15) {
        const next = size(contextStart - 1);
        if (bytes + next > 6_000) break;
        bytes += next;
        contextStart--;
      }
      bytes = 0;
      while (contextEnd < segments.length && contextEnd - end < 15) {
        const next = size(contextEnd);
        if (bytes + next > 6_000) break;
        bytes += next;
        contextEnd++;
      }
      pending.push({ start, end, contextStart, contextEnd });
      start = end;
    }
    return pending;
  });
}
