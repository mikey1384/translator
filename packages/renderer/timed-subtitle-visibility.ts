import type { SubtitleRenderPart } from '@shared-types/app';

export function getVisibleTimedSubtitleParts(
  parts: SubtitleRenderPart[]
): SubtitleRenderPart[] {
  const wordParts = parts.filter(
    (part): part is Extract<SubtitleRenderPart, { kind: 'word' }> =>
      part.kind === 'word'
  );
  const activeWords = wordParts.filter(part => part.state === 'active');

  if (activeWords.length === 0) {
    const hasUpcomingWord = wordParts.some(part => part.state === 'upcoming');
    if (!hasUpcomingWord) {
      return [];
    }

    const lastSpokenWord = [...wordParts]
      .reverse()
      .find(part => part.state === 'spoken');
    return lastSpokenWord ? [lastSpokenWord] : [];
  }

  return activeWords.flatMap((part, index) =>
    index === 0 ? [part] : [{ kind: 'whitespace', text: ' ' } as const, part]
  );
}

export function getVisibleTimedSubtitleText(parts: SubtitleRenderPart[]): string {
  return getVisibleTimedSubtitleParts(parts)
    .map(part => part.text)
    .join('');
}
