import type { SrtSegment } from '@shared-types/app';

export function attachPartialTranslation(
  error: unknown,
  segments: SrtSegment[]
): void {
  if (error && typeof error === 'object')
    Object.defineProperty(error, 'partialSegments', {
      value: segments.map(s => ({ ...s })),
      configurable: true,
      enumerable: false,
    });
}
export class IncompleteTranslationError extends Error {
  declare readonly partialSegments: SrtSegment[];
  constructor(partialSegments: SrtSegment[]) {
    super('__i18n__:errors.translationIncomplete');
    this.name = 'IncompleteTranslationError';
    attachPartialTranslation(this, partialSegments);
  }
}
const clean = (text: string) => text.replace(/[\uFEFF\u200B]/g, '').trim();

/** IDs are authoritative. Never fill a missing ID with a neighbouring line,
 * context, duplicate ID or commentary merely because the output count matches. */
export function parseTranslationLines(
  response: string,
  ids: number[]
): Map<number, string> {
  const expected = new Set(ids);
  const values = new Map<number, string>();
  const duplicates = new Set<number>();
  for (const raw of String(response || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const match = clean(raw).match(
      /^(?:@@SUB_LINE@@\s*|Line\s*)?(\d+)\s*[:-]\s*(.*)$/i
    );
    if (!match) continue;
    const id = Number(match[1]);
    if (!expected.has(id)) continue;
    if (values.has(id)) {
      duplicates.add(id);
      continue;
    }
    values.set(id, clean(match[2]));
  }
  for (const id of duplicates) values.delete(id);
  return values;
}

export async function completeTranslationCoverage(options: {
  segments: SrtSegment[];
  startIndex: number;
  draft: string;
  repair: (missing: { id: number; original: string }[]) => Promise<string>;
  signal?: AbortSignal;
}): Promise<SrtSegment[]> {
  const ids = options.segments.map((_, i) => options.startIndex + i + 1);
  const values = parseTranslationLines(options.draft, ids);
  const result = () =>
    options.segments.map((segment, i) => ({
      ...segment,
      translation: values.get(ids[i]) || '',
    }));
  const checkCancellation = () => {
    try {
      options.signal?.throwIfAborted();
    } catch (error) {
      attachPartialTranslation(error, result());
      throw error;
    }
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    checkCancellation();
    const missing = options.segments.flatMap((s, i) =>
      clean(s.original || '') && !values.get(ids[i])
        ? [{ id: ids[i], original: s.original }]
        : []
    );
    if (!missing.length) return result();
    // Provider/auth/cancel failures propagate. They must never turn into source
    // text disguised as a completed translation.
    let response: string;
    try {
      response = await options.repair(missing);
    } catch (error) {
      attachPartialTranslation(error, result());
      throw error;
    }
    for (const [id, text] of parseTranslationLines(
      response,
      missing.map(m => m.id)
    ))
      if (text) values.set(id, text);
    // A completed response still belongs to the user when cancellation races
    // its delivery. Preserve it without treating the operation as successful.
    checkCancellation();
  }
  const partial = result();
  if (partial.some(s => clean(s.original || '') && !clean(s.translation || '')))
    throw new IncompleteTranslationError(partial);
  return partial;
}
