// Lightweight tokenization + translation word-timing projection anchored to ASR beats

export function tokenizeForLang(text: string, langHint?: string): string[] {
  const s = (text || '').replace(/\r\n|\r/g, '\n').trim();
  if (!s) return [];
  const hasCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
  const hasThai = /[\u0E00-\u0E7F]/.test(s);
  if (hasCJK || hasThai || /^(zh|ja|ko|th)\b/i.test(String(langHint || ''))) {
    return Array.from(s).filter(ch => !/[\s]/.test(ch));
  }
  const tokens = s.match(/([\p{L}\p{N}]+|[^\s])/gu) || [];
  return tokens.filter(t => !/^\s+$/.test(t));
}

export function computeTranslationWordTimings(params: {
  originalWords: Array<{ start: number; end: number; word?: string }>;
  translatedText: string;
  segmentDuration: number;
  langHint?: string;
}): Array<{ start: number; end: number; word: string }> {
  const { originalWords, translatedText, segmentDuration, langHint } = params;
  const beats = Array.isArray(originalWords)
    ? originalWords
        .filter(
          w => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start
        )
        .map(w => ({ start: Math.max(0, w.start), end: Math.max(0, w.end) }))
        .sort((a, b) => a.start - b.start)
    : [];
  const dur = Math.max(0.01, Number.isFinite(segmentDuration) ? segmentDuration : 0);
  if (beats.length === 0) return [];

  const toks = tokenizeForLang(translatedText, langHint);
  if (toks.length === 0) return [];

  const n = beats.length;
  const m = toks.length;
  const buckets: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < m; i++) {
    const idx = Math.min(n - 1, Math.floor((i * n) / m));
    buckets[idx].push(i);
  }

  const out: Array<{ start: number; end: number; word: string }> = [];
  const EPS = 1e-6;
  let lastTokenIdx = -1;

  for (let b = 0; b < n; b++) {
    const beat = beats[b];
    const indices = buckets[b];
    const bStart = Math.max(0, Math.min(beat.start, dur));
    const bEnd = Math.max(bStart, Math.min(beat.end, dur));

    if (!indices || indices.length === 0) {
      if (out.length > 0) {
        out[out.length - 1].end = Math.max(out[out.length - 1].end, bEnd);
      } else if (m > 0) {
        out.push({ start: bStart, end: bEnd, word: toks[0] });
        lastTokenIdx = 0;
      }
      continue;
    }
    const weights = indices.map(i => Math.max(1, toks[i].length));
    let totalW = weights.reduce((a, c) => a + c, 0);
    let cursor = bStart;

    for (let k = 0; k < indices.length; k++) {
      const tokenIdx = indices[k];
      const token = toks[tokenIdx];
      const remainingTokens = indices.length - k;
      const remainingLen = Math.max(0, bEnd - cursor);

      let span = 0;
      if (remainingTokens <= 1) {
        span = remainingLen;
      } else if (totalW > 0 && remainingLen > 0) {
        span = (remainingLen * weights[k]) / totalW;
      }

      if (!Number.isFinite(span) || span < 0) span = 0;

      let tokenStart = cursor;
      let tokenEnd = cursor + span;
      if (tokenEnd > bEnd || k === indices.length - 1) {
        tokenEnd = bEnd;
      }
      if (tokenEnd < tokenStart) tokenEnd = tokenStart;

      if (
        lastTokenIdx === tokenIdx &&
        out.length > 0 &&
        tokenStart <= out[out.length - 1].end + EPS
      ) {
        out[out.length - 1].end = Math.max(out[out.length - 1].end, tokenEnd);
      } else {
        out.push({ start: tokenStart, end: tokenEnd, word: token });
      }

      cursor = tokenEnd;
      totalW -= weights[k];
      lastTokenIdx = tokenIdx;
    }

    if (cursor < bEnd - EPS && out.length > 0) {
      out[out.length - 1].end = Math.max(out[out.length - 1].end, bEnd);
    }
  }

  if (out.length === 0) {
    const firstBeat = beats[0];
    const bStart = Math.max(0, Math.min(firstBeat.start, dur));
    const bEnd = Math.max(bStart, Math.min(firstBeat.end, dur));
    out.push({ start: bStart, end: bEnd, word: toks[0] });
  }

  const lastBeatEnd = Math.max(...beats.map(b => Math.max(0, Math.min(b.end, dur))), 0);
  if (out.length > 0 && out[out.length - 1].end < lastBeatEnd) {
    out[out.length - 1].end = lastBeatEnd;
  }
  if (out.length > 0 && out[out.length - 1].end < dur) {
    out[out.length - 1].end = dur;
  }

  return out
    .map(w => ({
      start: Math.max(0, Math.min(w.start, dur)),
      end: Math.max(0, Math.min(w.end, dur)),
      word: w.word,
    }))
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start);
}
