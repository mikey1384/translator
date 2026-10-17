/**
 * Which translation language (a `TRANSLATION_LANGUAGES` value) a set of
 * subtitle lines is written in, or null when it can't tell with confidence.
 *
 * Used to avoid paying to translate text into the language it is already in
 * and to name the language of the lines on screen. It is deliberately
 * conservative: a wrong answer would skip a translation the user wanted, so
 * anything ambiguous (Danish vs Norwegian, Malay vs Indonesian, short or
 * mixed text) returns null and the caller behaves as before.
 */

const MAX_SAMPLE_LINES = 240;
const MAX_SAMPLE_CHARS = 12000;
const MIN_LETTERS = 12;
const MIN_LATIN_WORDS = 6;

type Script =
  | 'hangul'
  | 'kana'
  | 'han'
  | 'arabic'
  | 'hebrew'
  | 'cyrillic'
  | 'greek'
  | 'thai'
  | 'devanagari'
  | 'bengali'
  | 'tamil'
  | 'telugu'
  | 'latin';

function scriptOf(code: number): Script | null {
  if (
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f)
  )
    return 'hangul';
  if (code >= 0x3040 && code <= 0x30ff) return 'kana';
  if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf))
    return 'han';
  if (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0xfb50 && code <= 0xfdff) ||
    (code >= 0xfe70 && code <= 0xfeff)
  )
    return 'arabic';
  if (code >= 0x0590 && code <= 0x05ff) return 'hebrew';
  if (code >= 0x0400 && code <= 0x04ff) return 'cyrillic';
  if (code >= 0x0370 && code <= 0x03ff) return 'greek';
  if (code >= 0x0e00 && code <= 0x0e7f) return 'thai';
  if (code >= 0x0900 && code <= 0x097f) return 'devanagari';
  if (code >= 0x0980 && code <= 0x09ff) return 'bengali';
  if (code >= 0x0b80 && code <= 0x0bff) return 'tamil';
  if (code >= 0x0c00 && code <= 0x0c7f) return 'telugu';
  if (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0x24f && code !== 0xd7 && code !== 0xf7) ||
    (code >= 0x1e00 && code <= 0x1eff)
  )
    return 'latin';
  return null;
}

// Characters that only one of the two Chinese scripts uses.
const SIMPLIFIED_ONLY = new Set(
  Array.from('这们说个时会国来对过还没么样发经问两从现进实头见话东车门让学书长')
);
const TRADITIONAL_ONLY = new Set(
  Array.from('這們說個時會國來對過還沒麼樣發經問兩從現進實頭見話東車門讓學書長')
);

// The most frequent short words of each Latin-script language. Only words that
// tell languages apart carry weight; shared ones ("a", "de") are fine because
// the score compares languages against each other.
const LATIN_STOPWORDS: Record<string, string> = {
  english:
    'the and you that is it to of what this with have are was for not just they we but he she my your do know so be all there',
  spanish:
    'el la que de y en los las es por un una lo pero no muy para con está yo qué del se eso esto como más también hay tu',
  french:
    "le la les et est je tu que pas des un une il elle vous nous ce ça qui dans pour sur avec mais du oui c'est mon on au",
  german:
    'der die das und ist ich nicht du es ein eine zu mit sie wir auf den dem auch was aber wie ja noch hier sich mir für so dann',
  italian:
    'il che di e non la un una è per sono mi ma gli con del della lo io ti questo cosa anche come perché ci sei molto ho tu',
  portuguese:
    'o que não de a é um uma do da em você eu os as para com isso mas está no na muito se ele ela por também tem vai',
  dutch:
    'de het een en is ik je niet dat van wat op te zijn maar met voor er ook hij we dit nog naar heb jij kan wel hier als',
  polish:
    'nie to się jest w i na że co jak tak z do ale mnie ja ty czy już tylko był jestem może dla go tego bardzo teraz wiem tu',
  swedish:
    'och det är att jag du inte en som på med har vi för av till den men om så var kan här ska hon han mig dig nu vad',
  turkish:
    've bir bu ne da de için ben sen çok mi mı ama var yok o gibi daha şey evet hayır değil nasıl neden bana sana onu şimdi her kadar',
  czech:
    'je to se na že jsem v a ne co tak to jak ale mi já ty jsi už tady byl není proč když jen tohle moc mě bych něco',
  hungarian:
    'a az és hogy nem egy is van ez meg de csak már igen mi én te még mit így nagyon vagy kell itt most akkor volt mert neki ki',
  romanian:
    'și nu să este în la un o pe ce cu mai eu tu de am ai asta dar pentru sunt care foarte acum aici e fi el ea da',
  finnish:
    'ja on ei se että en oli mitä minä sinä hän me te he tämä kun niin mutta jos nyt vain kuin ole olen sen myös tai täällä joo mä',
  indonesian:
    'yang dan ini itu tidak aku saya kamu ada di ke dari apa dengan untuk akan sudah bisa juga kita mereka tapi ya karena lagi harus belum sangat banyak kalau',
  tagalog:
    'ang ng sa na ko mo ako ka siya hindi at ay ito yung po lang naman kung mga kayo tayo niya din rin pa ba nga talaga ano may',
  swahili:
    'na ya wa kwa ni za la katika hii hiyo mimi wewe yeye sisi ndiyo hapana lakini kama sana tu pia hapa sasa nini kwamba huo hizi kuwa nina una',
  afrikaans:
    'die en is ek nie jy het van dit in ons sy hy wat met om maar te vir op was sal kan baie ook nou my hulle gaan daar',
};

const LATIN_SETS: Array<[string, Set<string>]> = Object.entries(
  LATIN_STOPWORDS
).map(([language, words]) => [language, new Set(words.split(' '))]);

// Vietnamese is Latin script with tone marks nothing else uses this densely.
const VIETNAMESE_MARKS =
  /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/giu;

function sampleLines(lines: ReadonlyArray<string | null | undefined>): string {
  const usable = lines.filter(
    (line): line is string => typeof line === 'string' && line.trim() !== ''
  );
  if (usable.length === 0) return '';
  const step = Math.max(1, Math.floor(usable.length / MAX_SAMPLE_LINES));
  let out = '';
  for (let i = 0; i < usable.length && out.length < MAX_SAMPLE_CHARS; i += step)
    out += `${usable[i]}\n`;
  return out;
}

function detectLatin(text: string): string | null {
  const lower = text.toLowerCase();
  const marks = lower.match(VIETNAMESE_MARKS)?.length ?? 0;
  const words = lower.match(/[\p{L}']+/gu) ?? [];
  if (words.length < MIN_LATIN_WORDS) return null;
  if (marks / words.length > 0.3) return 'vietnamese';

  const scores = LATIN_SETS.map(([language, set]) => {
    let hits = 0;
    for (const word of words) if (set.has(word)) hits += 1;
    return { language, score: hits / words.length };
  }).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < 0.12) return null;
  // Close calls stay unknown.
  if (second && best.score < second.score * 1.5) return null;
  return best.language;
}

function detectArabicScript(text: string): string {
  const urdu = text.match(/[ٹڈڑںےھ]/gu)?.length ?? 0;
  const persian = text.match(/[پچژگکی]/gu)?.length ?? 0;
  const arabic = text.match(/[يكةى]/gu)?.length ?? 0;
  if (urdu > 0 && urdu >= arabic) return 'urdu';
  if (persian > arabic) return 'farsi';
  return 'arabic';
}

function detectDevanagari(text: string): string | null {
  const marathi = text.match(/आहे|आणि|च्या|नाही|मला|तुम्ही|ळ/gu)?.length ?? 0;
  const hindi =
    text.match(/ है|हैं|में|नहीं|की |का |के |मुझे|आप /gu)?.length ?? 0;
  if (hindi === 0 && marathi === 0) return null;
  if (hindi >= marathi * 2) return 'hindi';
  if (marathi >= hindi * 2) return 'marathi';
  return null;
}

function detectChinese(text: string): string | null {
  let simplified = 0;
  let traditional = 0;
  for (const char of text) {
    if (SIMPLIFIED_ONLY.has(char)) simplified += 1;
    else if (TRADITIONAL_ONLY.has(char)) traditional += 1;
  }
  if (simplified === traditional) return null;
  return simplified > traditional
    ? 'chinese_simplified'
    : 'chinese_traditional';
}

export function detectTextLanguage(
  lines: ReadonlyArray<string | null | undefined>
): string | null {
  const text = sampleLines(lines);
  if (!text) return null;

  const counts = new Map<Script, number>();
  let letters = 0;
  for (const char of text) {
    const script = scriptOf(char.codePointAt(0) ?? 0);
    if (!script) continue;
    letters += 1;
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  if (letters < MIN_LETTERS) return null;

  const share = (script: Script) => (counts.get(script) ?? 0) / letters;

  // Korean and Japanese mix in Han characters; their own scripts decide.
  if (share('hangul') >= 0.4) return 'korean';
  if (share('kana') >= 0.15 && share('kana') + share('han') >= 0.6)
    return 'japanese';
  if (share('han') >= 0.6) return detectChinese(text);

  const [dominant, dominantCount] = [...counts.entries()].sort(
    (a, b) => b[1] - a[1]
  )[0];
  if (dominantCount / letters < 0.7) return null;

  switch (dominant) {
    case 'arabic':
      return detectArabicScript(text);
    case 'hebrew':
      return 'hebrew';
    case 'greek':
      return 'greek';
    case 'thai':
      return 'thai';
    case 'bengali':
      return 'bengali';
    case 'tamil':
      return 'tamil';
    case 'telugu':
      return 'telugu';
    case 'devanagari':
      return detectDevanagari(text);
    case 'cyrillic':
      return /[іїєґ]/iu.test(text) ? 'ukrainian' : 'russian';
    case 'latin':
      return detectLatin(text);
    default:
      return null;
  }
}

/** True when these lines are confidently already in `language`. */
export function isTextInLanguage(
  lines: ReadonlyArray<string | null | undefined>,
  language: string | null | undefined
): boolean {
  const target = String(language || '')
    .trim()
    .toLowerCase();
  if (!target || target === 'original') return false;
  return detectTextLanguage(lines) === target;
}
