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
  // Tamil names ending in -ம் are nouns ("ஆங்கிலம்"); in a sentence they take
  // the adjective form like the rest ("ஆங்கில மொழியில்", "கொரிய மொழியில்").
  if (ui === 'ta') return base.replace(/ம்$/u, '');
  if (!LOWERCASE_MID_SENTENCE.has(ui)) return base;
  // Only the first letter: "Tiếng Việt" → "tiếng Việt", "Español" → "español".
  return base.charAt(0).toLocaleLowerCase(ui) + base.slice(1);
}

/**
 * Language names in the "into X" form for UI languages that inflect them
 * (Finnish "englanniksi", Ukrainian "англійську", Czech "angličtiny").
 * Strings may use {{languageInto}} wherever {{language}} would need a case
 * the plain name can't take; every other locale gets the sentence name.
 * Keyed by target-language code. Filled from reviewed native forms.
 */
export const INTO_LANGUAGE_FORMS: Record<string, Record<string, string>> = {
  uk: {
    english: 'англійську',
    korean: 'корейську',
    japanese: 'японську',
    chinese_simplified: 'китайську',
    chinese_traditional: 'китайську',
    vietnamese: 'в’єтнамську',
    spanish: 'іспанську',
    french: 'французьку',
    german: 'німецьку',
    italian: 'італійську',
    portuguese: 'португальську',
    russian: 'російську',
    dutch: 'голландську',
    polish: 'польську',
    swedish: 'шведську',
    turkish: 'турецьку',
    norwegian: 'норвезьку',
    danish: 'данську',
    finnish: 'фінську',
    greek: 'грецьку',
    czech: 'чеську',
    hungarian: 'угорську',
    romanian: 'румунську',
    ukrainian: 'українську',
    hindi: 'гінді',
    indonesian: 'індонезійську',
    thai: 'тайську',
    malay: 'малайську',
    tagalog: 'тагальську',
    bengali: 'бенгальську',
    tamil: 'тамільську',
    telugu: 'телугу',
    marathi: 'маратхі',
    urdu: 'урду',
    arabic: 'арабську',
    hebrew: 'іврит',
    farsi: 'фарсі',
    swahili: 'суахілі',
    afrikaans: 'африкаанс',
  },
  cs: {
    english: 'angličtiny',
    korean: 'korejštiny',
    japanese: 'japonštiny',
    chinese_simplified: 'čínštiny',
    chinese_traditional: 'čínštiny',
    vietnamese: 'vietnamštiny',
    spanish: 'španělštiny',
    french: 'francouzštiny',
    german: 'němčiny',
    italian: 'italštiny',
    portuguese: 'portugalštiny',
    russian: 'ruštiny',
    dutch: 'nizozemštiny',
    polish: 'polštiny',
    swedish: 'švédštiny',
    turkish: 'turečtiny',
    norwegian: 'norštiny',
    danish: 'dánštiny',
    finnish: 'finštiny',
    greek: 'řečtiny',
    czech: 'češtiny',
    hungarian: 'maďarštiny',
    romanian: 'rumunštiny',
    ukrainian: 'ukrajinštiny',
    hindi: 'hindštiny',
    indonesian: 'indonéštiny',
    thai: 'thajštiny',
    malay: 'malajštiny',
    tagalog: 'tagalogu',
    bengali: 'bengálštiny',
    tamil: 'tamilštiny',
    telugu: 'telugštiny',
    marathi: 'maráthštiny',
    urdu: 'urdštiny',
    arabic: 'arabštiny',
    hebrew: 'hebrejštiny',
    farsi: 'perštiny',
    swahili: 'svahilštiny',
    afrikaans: 'afrikánštiny',
  },
  fi: {
    english: 'englanniksi',
    korean: 'koreaksi',
    japanese: 'japaniksi',
    chinese_simplified: 'kiinaksi',
    chinese_traditional: 'kiinaksi',
    vietnamese: 'vietnamiksi',
    spanish: 'espanjaksi',
    french: 'ranskaksi',
    german: 'saksaksi',
    italian: 'italiaksi',
    portuguese: 'portugaliksi',
    russian: 'venäjäksi',
    dutch: 'hollanniksi',
    polish: 'puolaksi',
    swedish: 'ruotsiksi',
    turkish: 'turkiksi',
    norwegian: 'norjaksi',
    danish: 'tanskaksi',
    finnish: 'suomeksi',
    greek: 'kreikaksi',
    czech: 'tšekiksi',
    hungarian: 'unkariksi',
    romanian: 'romaniaksi',
    ukrainian: 'ukrainaksi',
    hindi: 'hindiksi',
    indonesian: 'indonesiaksi',
    thai: 'thaiksi',
    malay: 'malaijiksi',
    tagalog: 'tagalogiksi',
    bengali: 'bengaliksi',
    tamil: 'tamiliksi',
    telugu: 'teluguksi',
    marathi: 'marathiksi',
    urdu: 'urduksi',
    arabic: 'arabiaksi',
    hebrew: 'hepreaksi',
    farsi: 'farsiksi',
    swahili: 'swahiliksi',
    afrikaans: 'afrikaansiksi',
  },
};

export function intoLanguageName(
  code: string,
  sentenceName: string,
  uiLanguage: string
): string {
  const ui = String(uiLanguage || 'en')
    .split('-')[0]
    .toLowerCase();
  return INTO_LANGUAGE_FORMS[ui]?.[code] || sentenceName;
}
