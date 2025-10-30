import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { useSubStore, useUIStore } from '../state';
import { getNativePlayerInstance } from '../native-player';
import { SUBTITLE_STYLE_PRESETS, SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles';

const WORD_WINDOW_SIZE = 3;

function tokenizeForLang(text: string, langHint?: string): string[] {
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

function computeTranslationWordTimings(params: {
  originalWords: Array<{ start: number; end: number; word?: string }>;
  translatedText: string;
  segmentDuration: number;
  langHint?: string;
}): Array<{ start: number; end: number; word: string }> {
  const { originalWords, translatedText, segmentDuration, langHint } = params;
  const beats = Array.isArray(originalWords)
    ? originalWords
        .filter(w => Number.isFinite(w?.start) && Number.isFinite(w?.end) && w.end > w.start)
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
  const MIN_TOKEN_SEC = 0.06;
  const base = beats[0]?.start ?? 0;
  for (let b = 0; b < n; b++) {
    const beat = beats[b];
    const indices = buckets[b];
    if (!indices || indices.length === 0) continue;
    const bStart = Math.max(0, Math.min(beat.start, dur));
    const bEnd = Math.max(bStart, Math.min(beat.end, dur));
    const bLen = Math.max(0, bEnd - bStart);
    const weights = indices.map(i => Math.max(1, toks[i].length));
    const totalW = weights.reduce((a, c) => a + c, 0);
    let cursor = bStart;
    for (let k = 0; k < indices.length; k++) {
      const iTok = indices[k];
      const token = toks[iTok];
      let span = totalW > 0 ? (bLen * weights[k]) / totalW : bLen / indices.length;
      span = Math.max(MIN_TOKEN_SEC, span);
      let tEnd = cursor + span;
      if (k === indices.length - 1 || tEnd > bEnd) tEnd = bEnd;
      out.push({ start: Math.max(0, cursor - base), end: Math.max(0, tEnd - base), word: token });
      cursor = tEnd;
      if (cursor >= bEnd - 1e-3) break;
    }
  }
  return out
    .map(w => ({ start: Math.max(0, Math.min(w.start, dur)), end: Math.max(0, Math.min(w.end, dur)), word: w.word }))
    .filter(w => w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

function tokensForWindow(tokens: Array<{ start: number; end: number; word: string }>, idx: number) {
  const half = Math.floor((WORD_WINDOW_SIZE - 1) / 2);
  const from = Math.max(0, idx - half);
  const to = Math.min(tokens.length - 1, from + WORD_WINDOW_SIZE - 1);
  return { from, to };
}

function findActiveIndex(tokens: Array<{ start: number; end: number }>, t: number) {
  if (!tokens.length) return -1;
  let lo = 0, hi = tokens.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = tokens[mid];
    if (t < w.start) hi = mid - 1;
    else if (t > w.end) lo = mid + 1;
    else { ans = mid; break; }
  }
  return ans;
}

export default function KineticCaptionOverlay({
  stylePreset,
  isFullScreen,
}: {
  stylePreset: SubtitleStylePresetKey;
  isFullScreen?: boolean;
}) {
  const { stylizeMerge, showOriginalText } = useUIStore(s => ({ stylizeMerge: s.stylizeMerge, showOriginalText: s.showOriginalText }));
  const store = useSubStore();
  const [currentLine, setCurrentLine] = useState<{ orig: string; trans: string; oTok: any[]; tTok: any[] } | null>(null);
  const rafRef = useRef<number | null>(null);

  const preset = SUBTITLE_STYLE_PRESETS[stylePreset] || SUBTITLE_STYLE_PRESETS.Default;

  const containerCls = useMemo(() => css`
    position: absolute;
    left: 0; right: 0; bottom: 6%;
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    pointer-events: none;
    color: white;
    font-family: ${preset.fontName};
    font-size: ${Math.max(10, preset.fontSize)}px;
    text-align: center;
  `, [preset]);

  const lineCls = useMemo(() => css`
    background: rgba(0,0,0,0.2);
    padding: 2px 8px;
    border-radius: 4px;
  `, []);

  const highlightColor = preset.secondaryColor; // matches merge highlight

  useEffect(() => {
    if (!stylizeMerge) return;
    const step = () => {
      const v = getNativePlayerInstance();
      if (!v) { rafRef.current = requestAnimationFrame(step); return; }
      const t = v.currentTime;
      const { segments, order } = useSubStore.getState();
      // find active segment
      let lo = 0, hi = order.length - 1, idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segments[order[mid]];
        if (!s) break;
        if (t < s.start) hi = mid - 1; else if (t > s.end) lo = mid + 1; else { idx = mid; break; }
      }
      if (idx >= 0) {
        const seg: any = segments[order[idx]];
        const rel = t - seg.start;
        const oTok = Array.isArray(seg.origWords) ? seg.origWords : (Array.isArray(seg.words) ? seg.words : []);
        const tTok = Array.isArray(seg.transWords) ? seg.transWords : [];
        setCurrentLine({ orig: seg.original || '', trans: seg.translation || '', oTok, tTok });
      } else {
        setCurrentLine(null);
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [stylizeMerge]);

  if (!stylizeMerge || !currentLine) return null;

  const v = getNativePlayerInstance();
  const cur = v ? v.currentTime : 0;
  const { oTok, tTok } = currentLine;
  const seg: any = (() => {
    const { segments, order } = useSubStore.getState();
    let lo = 0, hi = order.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo+hi)>>1; const s = segments[order[mid]]; if (cur < s.start) hi=mid-1; else if (cur>s.end) lo=mid+1; else { idx=mid; break; } }
    return idx>=0 ? segments[order[idx]] : null;
  })();
  if (!seg) return null;
  const relT = cur - seg.start;
  const oi = findActiveIndex(oTok, relT);
  const ti = findActiveIndex(tTok, relT);

  const renderWindow = (tokens: any[], activeIdx: number) => {
    if (activeIdx < 0) return null;
    const { from, to } = tokensForWindow(tokens, activeIdx);
    return (
      <span>
        {tokens.slice(from, to + 1).map((w, i) => {
          const isCur = (from + i) === activeIdx;
          return (
            <span key={from + i} style={{
              color: isCur ? 'white' : 'white',
              fontWeight: isCur ? 700 : 400,
              background: isCur ? 'transparent' : 'transparent',
              textShadow: isCur ? `0 0 0 #000` : undefined,
              marginRight: 4,
            }}>
              <span style={{ color: isCur ? (highlightColor?.startsWith('&H')? '#00B4FF': highlightColor) : undefined }}>
                {String(w.word || '').replace(/\s+/g, ' ')}
              </span>
            </span>
          );
        })}
      </span>
    );
  };

  const isDual = showOriginalText;
  // Decide which lines to show: if translation is missing, always show original (even if not dual)
  const hasOrigText = (seg.original || '').trim().length > 0;
  const hasTransText = (seg.translation || '').trim().length > 0;
  const showOrig = isDual || !hasTransText;
  const showTrans = hasTransText; // show translation whenever it exists; in dual, both lines show
  // Strict error surfacing only for visible lines
  const origError = showOrig && hasOrigText && (!oTok || oTok.length === 0);
  const transError = showTrans && hasTransText && (!tTok || tTok.length === 0);
  if (origError || transError) {
    const msg = 'Stylize (word window) requires per-word timings for all visible lines.';
    return (
      <div className={containerCls}>
        <div className={css`background: rgba(160,0,0,0.8); padding: 6px 10px; border-radius: 4px;`}>
          {msg}
        </div>
      </div>
    );
  }

  return (
    <div className={containerCls}>
      {/* Original */}
      {showOrig && renderWindow(oTok, oi) && (
        <div className={lineCls}>
          {renderWindow(oTok, oi)}
        </div>
      )}
      {/* Translation */}
      {showTrans && renderWindow(tTok, ti) && (
        <div className={lineCls}>
          {renderWindow(tTok, ti)}
        </div>
      )}
    </div>
  );
}
