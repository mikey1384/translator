import { detectTextLanguage, isTextInLanguage } from './detectTextLanguage';

type Line = {
  original?: string | null;
  translation?: string | null;
};

/**
 * The language to translate the untranslated lines into: the language the
 * translated lines are already in, else the workspace's target language (the
 * user's choice, or the UI language until they pick one). Null when that
 * language is the one the untranslated lines are already written in, so the
 * caller asks for a language instead of running a translation that has
 * nothing to do.
 */
export function chooseMissingLinesTarget(
  lines: ReadonlyArray<Line | null | undefined>,
  workspaceLanguage: string
): string | null {
  const translations: string[] = [];
  const untranslated: string[] = [];
  for (const line of lines) {
    const original = line?.original?.trim() ?? '';
    const translation = line?.translation?.trim() ?? '';
    if (translation) translations.push(translation);
    else if (original) untranslated.push(original);
  }
  const language = detectTextLanguage(translations) ?? workspaceLanguage;
  if (!language || language === 'original') return null;
  if (isTextInLanguage(untranslated, language)) return null;
  return language;
}
