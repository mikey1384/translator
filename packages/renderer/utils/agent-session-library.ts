import type { SrtSegment } from '@shared-types/app';

// Persistent MCP jobs mark a transcript-only plan with this placeholder
// instead of a real target language.
const NO_TRANSLATION_REQUESTED = 'translation-not-requested';

/**
 * A persistent MCP job keeps agent-authored translations in its own job store.
 * Decide whether an applied job session is a finished translation that should
 * also be saved to the subtitle library, so reopening the video later finds it.
 */
export function shouldStoreAgentSessionTranslation(args: {
  segments: Pick<SrtSegment, 'translation'>[];
  targetLanguage?: string | null;
  sourceVideoPath?: string | null;
  sourceUrl?: string | null;
}): boolean {
  const targetLanguage = String(args.targetLanguage || '').trim();
  if (!targetLanguage || targetLanguage === NO_TRANSLATION_REQUESTED) {
    return false;
  }
  const hasSource =
    Boolean(String(args.sourceVideoPath || '').trim()) ||
    Boolean(String(args.sourceUrl || '').trim());
  if (!hasSource) return false;
  if (!Array.isArray(args.segments) || args.segments.length === 0) {
    return false;
  }
  // A partial session is still in progress; storing it would make the library
  // offer a half-translated document as the video's translation.
  return args.segments.every(segment =>
    Boolean(String(segment.translation || '').trim())
  );
}
