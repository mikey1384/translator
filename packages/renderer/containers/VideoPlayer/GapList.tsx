import { css } from '@emotion/css';
import { colors } from '../../styles';
import { useMemo, useEffect, useState, useRef } from 'react';
import { useSubStore } from '../../state/subtitle-store';
import { useVideoStore } from '../../state';
import { useTranslation } from 'react-i18next';

const container = css`
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 8px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid ${colors.border};
  border-radius: 6px;
  padding: 8px 8px;
  backdrop-filter: blur(4px);
  height: 100%;
  overflow: auto;
`;

const header = css`
  font-size: 0.9rem;
  font-weight: 600;
  margin: 0 0 6px 0;
  color: #fff;
`;

const item = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: #fff;
  outline: none;
  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: ${colors.border};
  }
  &:focus-visible {
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
  }
`;

const meta = css`
  color: #d1d5db;
  font-size: 0.8rem;
`;

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return '00:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h
    ? [h, m, sec].map(n => String(n).padStart(2, '0')).join(':')
    : [m, sec].map(n => String(n).padStart(2, '0')).join(':');
};

const GAP_THRESHOLD_SEC = 3; // Show gaps >= 3s
// Heuristics for low-confidence picks
const UNCERTAIN_LOGPROB_MAX = -1.1; // avg_logprob <= -1.1
const UNCERTAIN_NO_SPEECH_MIN = 0.5; // no_speech_prob >= 0.5
// Readability density heuristics (characters per second)
const CPS_HIGH = 20; // too dense
const CPS_LOW = 1; // too sparse
const LONG_DUR_SEC = 10; // slots >= 10s with very little text flagged

export default function GapList() {
  const { t } = useTranslation();
  const { order, segments, sourceId } = useSubStore(s => ({ order: s.order, segments: s.segments, sourceId: s.sourceId }));
  const { url, path } = useVideoStore(s => ({ url: s.url, path: s.path }));
  const hasVideo = Boolean(url || path);
  const hasSubs = (order?.length ?? 0) > 0;
  const showContent = hasVideo && hasSubs;

  // Tab state
  const [tab, setTab] = useState<'gaps' | 'confidence'>('gaps');

  // Track which items were clicked (seen) per sourceId to reduce noise
  const seenGapsRef = useRef<Set<string>>(new Set());
  const seenLCRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Reset when source changes
    const gapsKey = `seen_gaps_${sourceId}`;
    const lcKey = `seen_lc_${sourceId}`;
    try {
      const a = JSON.parse(localStorage.getItem(gapsKey) || '[]');
      const b = JSON.parse(localStorage.getItem(lcKey) || '[]');
      seenGapsRef.current = new Set(Array.isArray(a) ? a : []);
      seenLCRef.current = new Set(Array.isArray(b) ? b : []);
    } catch {
      seenGapsRef.current = new Set();
      seenLCRef.current = new Set();
    }
  }, [sourceId]);
  const markSeen = (type: 'gaps' | 'lc', key: string) => {
    const storageKey = type === 'gaps' ? `seen_gaps_${sourceId}` : `seen_lc_${sourceId}`;
    const ref = type === 'gaps' ? seenGapsRef : seenLCRef;
    ref.current.add(key);
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(ref.current)));
    } catch {}
  };

  const gaps = useMemo(() => {
    const out: Array<{ start: number; end: number; dur: number; nextId?: string; prevId?: string }> = [];
    if (!showContent || !order || order.length < 1) return out;
    const isEmpty = (id: string) => !String(segments[id]?.original || '').trim();
    for (let i = 0; i < order.length; ) {
      const id = order[i];
      const a = segments[id];
      if (!a) {
        i++;
        continue;
      }
      if (isEmpty(id)) {
        // Merge consecutive empties and include any following time hole up to next non-empty
        const start = a.start;
        let runEnd = a.end;
        let j = i + 1;
        while (j < order.length && isEmpty(order[j])) {
          runEnd = Math.max(runEnd, segments[order[j]]!.end);
          j++;
        }
        const next = j < order.length ? segments[order[j]] : undefined;
        const finalEnd = next && next.start > runEnd ? next.start : runEnd;
        const dur = finalEnd - start;
        if (dur >= GAP_THRESHOLD_SEC) {
          out.push({ start, end: finalEnd, dur, nextId: next?.id, prevId: segments[order[i]]?.id });
        }
        i = j;
      } else {
        // Plain time hole between non-empty neighbors
        const next = i + 1 < order.length ? segments[order[i + 1]] : undefined;
        if (next) {
          const gap = Math.max(0, next.start - a.end);
          if (gap >= GAP_THRESHOLD_SEC) {
            out.push({ start: a.end, end: next.start, dur: gap, nextId: next.id, prevId: a.id });
          }
        }
        i++;
      }
    }
    return out;
  }, [order, segments]);

  // Low-confidence segments grouped into contiguous ranges
  const lowConfidence = useMemo(() => {
    const out: Array<{ start: number; end: number; count: number; firstId?: string }> = [];
    if (!showContent || !order || order.length === 0) return out;
    const isUncertain = (id: string) => {
      const seg = segments[id];
      if (!seg) return false;
      const lp = typeof seg.avg_logprob === 'number' ? seg.avg_logprob! : 0;
      const ns = typeof seg.no_speech_prob === 'number' ? seg.no_speech_prob! : 0;
      const text = (seg.original || '').trim();
      const len = text.length;
      const dur = Math.max(0, (seg.end ?? 0) - (seg.start ?? 0));
      const cps = dur > 0 ? len / dur : len > 0 ? Infinity : 0;
      const tooDense = cps >= CPS_HIGH; // a lot of text in very short time
      const tooSparse = (dur >= LONG_DUR_SEC && cps <= CPS_LOW) || (dur >= 60 && cps <= CPS_LOW * 2);
      const short = len <= 2; // extremely short text
      return (
        lp <= UNCERTAIN_LOGPROB_MAX ||
        ns >= UNCERTAIN_NO_SPEECH_MIN ||
        tooDense ||
        tooSparse ||
        short
      );
    };

    let i = 0;
    while (i < order.length) {
      const id = order[i];
      if (!segments[id]) {
        i++;
        continue;
      }
      if (!isUncertain(id)) {
        i++;
        continue;
      }
      let start = segments[id]!.start;
      let end = segments[id]!.end;
      let count = 1;
      const firstId = id;
      let j = i + 1;
      while (j < order.length && isUncertain(order[j])) {
        const s = segments[order[j]]!;
        start = Math.min(start, s.start);
        end = Math.max(end, s.end);
        count++;
        j++;
      }
      out.push({ start, end, count, firstId });
      i = j;
    }
    return out;
  }, [order, segments]);

  // Tab UI styles
  const tabBar = css`
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  `;
  const tabBtn = (active: boolean) => css`
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid ${colors.border};
    background: ${active ? 'rgba(255,255,255,0.15)' : 'transparent'};
    color: #fff;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    &:hover { background: rgba(255,255,255,0.12); }
  `;

  const gapItems = gaps.map((g, idx) => {
    const key = `${g.start}-${g.end}`;
    const unseen = !seenGapsRef.current.has(key);
    return (
      <button
        key={`${key}-${idx}`}
        className={item}
        onClick={() => {
          try {
            const st = useSubStore.getState();
            const id = g.nextId || g.prevId;
            if (id) {
              st.seek(id);
              requestAnimationFrame(() => st.scrollToCurrent());
            }
          } catch {}
          markSeen('gaps', key);
        }}
      >
        <span>{fmt(g.start)} → {fmt(g.end)}</span>
        <span className={meta}>
          {unseen ? (
            <span style={{ color: '#ff7a18', marginRight: 6 }} title="new">!</span>
          ) : null}
          {Math.round(g.dur)}s
        </span>
      </button>
    );
  });

  const lcItems = lowConfidence.map((r, idx) => {
    const key = `${r.start}-${r.end}`;
    const unseen = !seenLCRef.current.has(key);
    return (
      <button
        key={`lc-${key}-${idx}`}
        className={item}
        onClick={() => {
          try {
            const st = useSubStore.getState();
            if (r.firstId) {
              st.seek(r.firstId);
              requestAnimationFrame(() => st.scrollToCurrent());
            }
          } catch {}
          markSeen('lc', key);
        }}
      >
        <span>
          {fmt(r.start)} → {fmt(r.end)}
        </span>
        <span className={meta}>
          {unseen ? (
            <span style={{ color: '#ff7a18', marginRight: 6 }} title="new">!</span>
          ) : null}
          {t('panel.confidence.count', { count: r.count })}
        </span>
      </button>
    );
  });

  const hasUnseenGaps = gaps.some(g => !seenGapsRef.current.has(`${g.start}-${g.end}`));
  const hasUnseenLC = lowConfidence.some(r => !seenLCRef.current.has(`${r.start}-${r.end}`));

  return (
    <div className={container}>
      {showContent ? (
        <>
          <div className={tabBar} role="tablist">
            <button className={tabBtn(tab === 'gaps')} role="tab" aria-selected={tab === 'gaps'} onClick={() => setTab('gaps')}>
              {t('panel.gaps.title', 'Gaps')}
              {hasUnseenGaps ? <span style={{ color: '#ff7a18' }}>!</span> : null}
            </button>
            <button className={tabBtn(tab === 'confidence')} role="tab" aria-selected={tab === 'confidence'} onClick={() => setTab('confidence')}>
              {t('panel.confidence.title', 'Low Confidence')}
              {hasUnseenLC ? <span style={{ color: '#ff7a18' }}>!</span> : null}
            </button>
          </div>

          {tab === 'gaps' ? (
            gaps.length === 0 ? (
              <div className={meta}>{t('panel.gaps.none', 'No large gaps detected')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gapItems}
              </div>
            )
          ) : lowConfidence.length === 0 ? (
            <div className={meta}>{t('panel.confidence.none', 'No low-confidence lines detected')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lcItems}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
