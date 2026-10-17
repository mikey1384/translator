import { isTextInLanguage } from './detectTextLanguage';

type DubCue = {
  original?: string | null;
  translation?: string | null;
};

/**
 * What the voice should read for a dub into `selectedLanguage`:
 * - 'use-original': the subtitles are already in that language, so the voice
 *   reads them as they are (no paid same-language "translation").
 * - 'translate': lines are missing a translation, or the translations are in
 *   another language; translate first.
 * - 'ready': the translations are in the selected language (or of unknown
 *   language, as mounted SRTs often are); dub them as they are.
 */
export type DubTextPlan = 'use-original' | 'translate' | 'ready';

export function planDubText(
  segments: readonly DubCue[],
  selectedLanguage: string | null | undefined,
  translatedLanguage: string | null | undefined
): DubTextPlan {
  if (!segments.length) return 'ready';
  const selected = String(selectedLanguage || '')
    .trim()
    .toLowerCase();
  if (
    isTextInLanguage(
      segments.map(seg => seg.original),
      selected
    )
  ) {
    return 'use-original';
  }
  const hasUntranslated = segments.some(
    seg => (seg.original || '').trim() && !(seg.translation || '').trim()
  );
  const translated = String(translatedLanguage || '')
    .trim()
    .toLowerCase();
  // Only re-translate when we know the translations are in another language.
  const translatedToOtherLanguage = Boolean(
    translated && selected && translated !== selected
  );
  return hasUntranslated || translatedToOtherLanguage ? 'translate' : 'ready';
}

/** The cues as the dubber should voice them under `plan`. */
export function segmentsForDub<T extends DubCue>(
  segments: readonly T[],
  plan: DubTextPlan
): T[] {
  if (plan !== 'use-original') return [...segments];
  return segments.map(seg => ({ ...seg, translation: seg.original ?? '' }));
}

/** Characters the voice will read, for the cost estimate. */
export function dubCharCount(
  segments: readonly DubCue[],
  plan: DubTextPlan
): number {
  let count = 0;
  for (const seg of segments) {
    const text =
      plan === 'ready'
        ? seg.translation || seg.original || ''
        : // A translation is usually about as long as the original.
          seg.original || '';
    count += text.trim().length;
  }
  return count;
}
