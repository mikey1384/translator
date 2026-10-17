/**
 * The one yellow action under the video, from what is on screen. Pure so the
 * rules can be tested without rendering.
 */
export type WorkspacePrimaryKind =
  | 'none'
  | 'makeItSpeak'
  | 'translate'
  | 'translateMissing'
  | 'export'
  | 'save';

export interface WorkspacePrimaryInput {
  busy: boolean;
  hasVideo: boolean;
  hasEditor: boolean;
  /** A free-preview offer (open or dismissed) stands for this video. */
  previewStands: boolean;
  /** Subtitle lines. */
  count: number;
  /** Lines with a translation. */
  translated: number;
  /** Lines with text but no translation. */
  missing: number;
  /** The language the original lines are in, when known. */
  sourceLanguage: string | null;
  /** The language the user wants. */
  targetLanguage: string;
}

export function chooseWorkspacePrimary(
  input: WorkspacePrimaryInput
): WorkspacePrimaryKind {
  const {
    busy,
    hasVideo,
    hasEditor,
    previewStands,
    count,
    translated,
    missing,
    sourceLanguage,
    targetLanguage,
  } = input;
  if (busy) return 'none';
  if (count === 0) {
    // The offer (or its quiet line) carries the action while it stands.
    return hasVideo && !previewStands ? 'makeItSpeak' : 'none';
  }
  const finished = hasVideo ? 'export' : hasEditor ? 'save' : 'none';
  if (translated === 0) {
    // Never offer to translate lines into the language they're already in.
    if (sourceLanguage && sourceLanguage === targetLanguage) return finished;
    return hasEditor ? 'translate' : finished;
  }
  if (missing > 0) return 'translateMissing';
  return finished;
}
