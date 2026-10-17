/**
 * A language name as it reads inside a sentence of the UI language.
 * Labels and chips keep the proper name ("Español", "中文（简体）"); sentences
 * need "en español", "en français", "tiếng Việt", "用中文看懂".
 */

// UI languages that write language names in lowercase mid-sentence.
const LOWERCASE_MID_SENTENCE = new Set([
  'es',
  'pt',
  'fr',
  'it',
  'ro',
  'ca',
  'sv',
  'da',
  'no',
  'nb',
  'fi',
  'pl',
  'cs',
  'sk',
  'hu',
  'ru',
  'uk',
  'el',
  'vi',
]);

export function sentenceLanguageName(name: string, uiLanguage: string): string {
  // Drop a trailing variant in brackets: "中文（简体）" → "中文",
  // "Chinês (simplificado)" → "Chinês".
  const base = String(name || '')
    .replace(/\s*[（(][^）)]*[）)]\s*$/u, '')
    .trim();
  if (!base) return name;
  const ui = String(uiLanguage || 'en')
    .split('-')[0]
    .toLowerCase();
  if (!LOWERCASE_MID_SENTENCE.has(ui)) return base;
  // Only the first letter: "Tiếng Việt" → "tiếng Việt", "Español" → "español".
  return base.charAt(0).toLocaleLowerCase(ui) + base.slice(1);
}
