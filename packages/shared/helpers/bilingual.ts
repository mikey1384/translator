import type { SrtSegment } from '@shared-types/app';

// Lightweight script detection to separate original vs translation
// without external dependencies. Focuses on distinguishing Latin
// from non-Latin scripts (CJK, Cyrillic, etc.).

type Script =
  | 'Latin'
  | 'Cyrillic'
  | 'Greek'
  | 'Arabic'
  | 'Hebrew'
  | 'Devanagari'
  | 'Thai'
  | 'Hiragana'
  | 'Katakana'
  | 'Hangul'
  | 'CJK'
  | 'Other'
  | 'Unknown';

const NON_LETTER_RE = /[\s\d\p{P}\p{S}]/u; // whitespace, digits, punctuation, symbols

function charScript(ch: string): Script {
  const code = ch.codePointAt(0)!;
  // Quick ignore for separators/digits/punctuations
  if (NON_LETTER_RE.test(ch)) return 'Other';

  // Latin incl. extended + combining diacritics range approximations
  if (
    (code >= 0x0041 && code <= 0x007a) || // Basic Latin A-z
    (code >= 0x00c0 && code <= 0x024f) || // Latin-1 Supplement + Latin Extended-A/B
    (code >= 0x1e00 && code <= 0x1eff) // Latin Extended Additional
  )
    return 'Latin';

  // Cyrillic
  if ((code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f))
    return 'Cyrillic';

  // Greek
  if (code >= 0x0370 && code <= 0x03ff) return 'Greek';

  // Arabic
  if (
    (code >= 0x0600 && code <= 0x06ff) ||
    (code >= 0x0750 && code <= 0x077f) ||
    (code >= 0x08a0 && code <= 0x08ff)
  )
    return 'Arabic';

  // Hebrew
  if (code >= 0x0590 && code <= 0x05ff) return 'Hebrew';

  // Devanagari
  if (code >= 0x0900 && code <= 0x097f) return 'Devanagari';

  // Thai
  if (code >= 0x0e00 && code <= 0x0e7f) return 'Thai';

  // Hiragana, Katakana, Hangul, CJK
  if (code >= 0x3040 && code <= 0x309f) return 'Hiragana';
  if (code >= 0x30a0 && code <= 0x30ff) return 'Katakana';
  if ((code >= 0xac00 && code <= 0xd7af) || (code >= 0x1100 && code <= 0x11ff))
    return 'Hangul';
  if (
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) // CJK Extension A
  )
    return 'CJK';

  return 'Other';
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function splitNonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function dominantScriptOf(line: string): {
  script: Script;
  confidence: number;
} {
  const counts: Record<Script, number> = Object.create(null);
  let letters = 0;
  for (const ch of line) {
    const sc = charScript(ch);
    if (sc === 'Other') continue;
    counts[sc] = (counts[sc] ?? 0) + 1;
    letters++;
  }
  if (letters === 0) return { script: 'Unknown', confidence: 0 };
  let best: Script = 'Unknown';
  let max = 0;
  for (const k of Object.keys(counts) as Script[]) {
    if (counts[k]! > max) {
      best = k;
      max = counts[k]!;
    }
  }
  return { script: best, confidence: max / letters };
}

function isNonLatin(sc: Script) {
  return sc !== 'Latin' && sc !== 'Other' && sc !== 'Unknown';
}

/**
 * Infer candidate script pair {originalScript, translationScript} by scanning
 * all cue lines. Prefers (NonLatin, Latin) when present.
 */
function inferScriptPair(
  segments: SrtSegment[]
): { original: Script; translation: Script; confidence: number } | null {
  // Count scripts across all non-empty lines
  const counts: Record<Script, number> = Object.create(null);
  const samples: Array<{ first: Script; second: Script }> = [];

  for (const seg of segments) {
    const lines = splitNonEmptyLines(stripTags(seg.original || ''));
    for (const line of lines) {
      const { script } = dominantScriptOf(line);
      counts[script] = (counts[script] ?? 0) + 1;
    }
    if (lines.length >= 2) {
      const a = dominantScriptOf(lines[0]).script;
      const b = dominantScriptOf(lines[1]).script;
      if (a !== 'Unknown' && b !== 'Unknown') {
        samples.push({ first: a, second: b });
      }
    }
  }

  // Prefer NonLatin + Latin pair if both are present
  let topNonLatin: Script | null = null;
  const topLatinCount = counts['Latin'] || 0;
  // Find the most frequent non-Latin script
  for (const sc of Object.keys(counts) as Script[]) {
    if (isNonLatin(sc)) {
      if (
        topNonLatin == null ||
        (counts[sc] ?? 0) > (counts[topNonLatin] ?? 0)
      ) {
        topNonLatin = sc;
      }
    }
  }

  // If we have both Latin and a non-Latin present, estimate orientation by samples
  if (topNonLatin && topLatinCount > 0) {
    let nonLatinFirst = 0;
    let latinFirst = 0;
    let pairHits = 0;
    for (const s of samples) {
      const isPair =
        (s.first === topNonLatin && s.second === 'Latin') ||
        (s.first === 'Latin' && s.second === topNonLatin);
      if (!isPair) continue;
      pairHits++;
      if (s.first === topNonLatin) nonLatinFirst++;
      else latinFirst++;
    }
    if (
      pairHits >= 5 &&
      (nonLatinFirst / pairHits >= 0.7 || latinFirst / pairHits >= 0.7)
    ) {
      const original =
        nonLatinFirst >= latinFirst ? topNonLatin : ('Latin' as Script);
      const translation =
        original === 'Latin' ? topNonLatin : ('Latin' as Script);
      const confidence = Math.max(nonLatinFirst, latinFirst) / pairHits;
      return { original, translation, confidence };
    }
    // If few samples but strong presence overall, still attempt with low confidence
    const totalLines =
      Object.values(counts).reduce((a, b) => a + (b || 0), 0) || 1;
    const nlRatio = (counts[topNonLatin] || 0) / totalLines;
    const latRatio = (counts['Latin'] || 0) / totalLines;
    if (nlRatio > 0.15 && latRatio > 0.15) {
      return { original: topNonLatin, translation: 'Latin', confidence: 0.55 };
    }
  }

  // Otherwise, give up (likely single language or both Latin-family)
  return null;
}

/**
 * Attempt to split multi-line cues into original/translation when the file appears
 * to be bilingual in two different scripts (e.g., Japanese + English).
 *
 * Returns a new array of SrtSegment with updated `original` and `translation` fields
 * where confidently detected. If no confident mapping is found, returns input untouched.
 */
export function autoSplitBilingualCues(segments: SrtSegment[]): SrtSegment[] {
  if (!Array.isArray(segments) || segments.length === 0) return segments;

  const pair = inferScriptPair(segments);
  if (!pair) return segments;

  const origScript = pair.original;
  const transScript = pair.translation;

  // Only act when we have a meaningful non-Latin vs Latin pair
  const out: SrtSegment[] = segments.map(seg => ({ ...seg }));

  for (const seg of out) {
    const raw = seg.original || '';
    const linesRaw = raw.split(/\r?\n/);
    const lines = linesRaw.map(l => l.trim());
    const nonEmptyIdx = lines
      .map((l, i) => ({ i, l }))
      .filter(x => x.l.length > 0)
      .map(x => x.i);

    if (nonEmptyIdx.length <= 1) {
      seg.translation = seg.translation ?? '';
      continue; // single-line cue → leave as original only
    }

    // Determine script of each non-empty line
    const lineScripts = lines.map(l => dominantScriptOf(stripTags(l)).script);

    // Basic grouping: collect contiguous head lines matching origScript, then tail lines matching transScript
    let splitAt: number | null = null;
    for (let i = 0; i < lines.length - 1; i++) {
      const scHere = lineScripts[i];
      const scNext = lineScripts[i + 1];
      // Look for a transition from original-script cluster to translation-script cluster
      const isOrigHere =
        scHere === origScript ||
        (origScript === 'CJK' &&
          (scHere === 'Hiragana' ||
            scHere === 'Katakana' ||
            scHere === 'Hangul' ||
            scHere === 'CJK'));
      const isTransNext = scNext === transScript;
      if (isOrigHere && isTransNext) {
        splitAt = i + 1;
        break;
      }
    }

    // Fallback: exactly two non-empty lines with opposing scripts
    if (splitAt == null && nonEmptyIdx.length === 2) {
      const i1 = nonEmptyIdx[0];
      const i2 = nonEmptyIdx[1];
      const s1 = lineScripts[i1];
      const s2 = lineScripts[i2];
      const okPair =
        (s1 === origScript && s2 === transScript) ||
        (s1 === 'CJK' && origScript === 'CJK' && s2 === transScript) ||
        ((s1 === 'Hiragana' || s1 === 'Katakana' || s1 === 'Hangul') &&
          origScript === 'CJK' &&
          s2 === 'Latin');
      if (okPair) splitAt = i2;
    }

    if (splitAt == null) {
      // No confident split for this cue; leave as original-only
      seg.translation = seg.translation ?? '';
      continue;
    }

    // Compose fields, preserving original line content (not stripped)
    const head = linesRaw.slice(0, splitAt).join('\n').trim();
    const tail = linesRaw.slice(splitAt).join('\n').trim();

    // Ensure we don't mistakenly drop legitimate multi-line originals
    // Require that tail predominantly matches the translation script
    const tailDom = dominantScriptOf(stripTags(tail));
    if (
      tailDom.script !== transScript &&
      !(transScript === 'Latin' && tailDom.script === 'Latin')
    ) {
      seg.translation = seg.translation ?? '';
      continue;
    }

    seg.original = head;
    seg.translation = tail;
  }

  return out;
}
