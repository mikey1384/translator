import { createWithEqualityFn } from 'zustand/traditional';

/**
 * One set of find rules for the counter, the highlights and Replace All, so
 * what is highlighted is exactly what gets replaced. The search text is
 * literal: "?" or "(" are just characters.
 */
export interface FindOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A global regex for `term`, or null when there is nothing to find. */
export function buildFindRegex(
  term: string,
  options: FindOptions = {}
): RegExp | null {
  if (!term || !term.trim()) return null;
  let pattern = escapeRegExp(term);
  // Letters and digits in any script count as word characters.
  if (options.wholeWord) {
    pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
  }
  return new RegExp(pattern, options.matchCase ? 'gu' : 'giu');
}

export function textMatches(
  text: string,
  term: string,
  options: FindOptions = {}
): boolean {
  const re = buildFindRegex(term, options);
  if (!re || !text) return false;
  return re.test(text);
}

/** Replace every match (literal replacement: "$" is just a dollar sign). */
export function replaceMatches(
  text: string,
  term: string,
  replace: string,
  options: FindOptions = {}
): string {
  const re = buildFindRegex(term, options);
  if (!re || !text) return text;
  return text.replace(re, () => replace);
}

/** Split text into plain and matched pieces for highlighting. */
export function splitByMatches(
  text: string,
  term: string,
  options: FindOptions = {}
): Array<{ text: string; match: boolean }> {
  const re = buildFindRegex(term, options);
  if (!re || !text) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last)
      parts.push({ text: text.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts;
}

interface FindOptionsState {
  matchCase: boolean;
  wholeWord: boolean;
  setMatchCase(value: boolean): void;
  setWholeWord(value: boolean): void;
}

/** The find bar's Match case / Whole word toggles. */
export const useFindOptions = createWithEqualityFn<FindOptionsState>()(set => ({
  matchCase: false,
  wholeWord: false,
  setMatchCase: value => set({ matchCase: value }),
  setWholeWord: value => set({ wholeWord: value }),
}));

export function currentFindOptions(): FindOptions {
  const { matchCase, wholeWord } = useFindOptions.getState();
  return { matchCase, wholeWord };
}
