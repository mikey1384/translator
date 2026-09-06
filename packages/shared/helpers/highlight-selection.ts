import type { HighlightEditorialPlan } from '@shared-types/app';
import {
  validateHighlightEditorialPlan,
  editorialSourceSignature,
} from './highlight-editorial';
import type { SrtSegment, TranscriptHighlight } from '@shared-types/app';

export function selectHighlightsByCue(
  cues: readonly SrtSegment[],
  selections: readonly {
    id: string;
    startCueId: string;
    endCueId: string;
    title: string;
    description?: string;
    reason?: string;
    editorial?: HighlightEditorialPlan;
  }[]
): TranscriptHighlight[] {
  if (!Array.isArray(selections) || selections.length > 20)
    throw new Error('Choose at most 20 highlights.');
  const ids = new Set<string>();
  return selections.map(selection => {
    if (!/^[\p{L}\p{N}_-]{1,80}$/u.test(selection.id) || ids.has(selection.id))
      throw new Error(
        'Highlight IDs must be distinct names of at most 80 characters.'
      );
    ids.add(selection.id);
    const first = cues.findIndex(c => c.id === selection.startCueId);
    const last = cues.findIndex(c => c.id === selection.endCueId);
    if (first < 0 || last < first)
      throw new Error('Unknown or reversed cue boundaries.');
    const start = cues[first].start;
    const end = cues[last].end;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end - start < 2 ||
      end - start > 180
    )
      throw new Error(
        'Each highlight must contain a complete 2–180 second source interval.'
      );
    const title = selection.title?.trim();
    if (!title || title.length > 160)
      throw new Error('A concise title of at most 160 characters is required.');
    return {
      editorialSourceSignature: selection.editorial
        ? editorialSourceSignature(cues, start, end)
        : undefined,
      editorial: selection.editorial
        ? validateHighlightEditorialPlan(selection.editorial, end - start)
        : undefined,
      id: selection.id,
      start,
      end,
      title,
      description: selection.description?.trim(),
      justification: selection.reason?.trim(),
      lineStart: first + 1,
      lineEnd: last + 1,
    };
  });
}
