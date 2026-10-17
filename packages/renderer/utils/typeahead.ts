/**
 * Listbox type-ahead: keystrokes typed within TYPEAHEAD_RESET_MS build up a
 * prefix ("deu" finds Deutsch, not English), and repeating one letter cycles
 * through the items that start with it ("e" English, "e" Español, …). Each
 * item can be matched by several names (its own name, the name in the UI
 * language, the English name) so a Latin keyboard reaches 日本語 by "ja".
 */

export const TYPEAHEAD_RESET_MS = 700;

export interface TypeaheadItem {
  value: string;
  names: string[];
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

function matches(item: TypeaheadItem, prefix: string): boolean {
  return item.names.some(name => normalize(name).startsWith(prefix));
}

/** The value to make active for `query`, or null when nothing matches. */
export function findTypeaheadMatch(
  items: TypeaheadItem[],
  query: string,
  currentValue: string | null
): string | null {
  const prefix = normalize(query);
  if (!prefix || items.length === 0) return null;
  const start = Math.max(
    0,
    items.findIndex(item => item.value === currentValue)
  );
  const chars = Array.from(prefix);
  const repeatedLetter = chars.length > 1 && chars.every(c => c === chars[0]);
  // A fresh single letter or a repeated one moves past the current item; a
  // longer prefix may stay on it ("d" Dansk → "de" Deutsch, "da" Dansk).
  const cycling = chars.length === 1 || repeatedLetter;
  const needle = repeatedLetter ? chars[0] : prefix;
  for (let step = cycling ? 1 : 0; step <= items.length; step++) {
    const item = items[(start + step) % items.length];
    if (matches(item, needle)) return item.value;
  }
  return null;
}

/** Accumulates keystrokes, starting over after a pause. */
export function createTypeaheadBuffer(resetMs = TYPEAHEAD_RESET_MS) {
  let text = '';
  let last = 0;
  return {
    push(key: string, now = Date.now()): string {
      text = now - last > resetMs ? key : text + key;
      last = now;
      return text;
    },
    reset() {
      text = '';
      last = 0;
    },
  };
}
