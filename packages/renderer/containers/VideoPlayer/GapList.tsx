import { css } from '@emotion/css';
import { colors } from '../../styles';
import { useMemo } from 'react';
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

export default function GapList() {
  const { t } = useTranslation();
  const { order, segments } = useSubStore(s => ({ order: s.order, segments: s.segments }));
  const { url, path } = useVideoStore(s => ({ url: s.url, path: s.path }));
  const hasVideo = Boolean(url || path);
  const hasSubs = (order?.length ?? 0) > 0;
  const showContent = hasVideo && hasSubs;

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
      const short = (seg.original || '').trim().length <= 2; // very short text
      return lp <= UNCERTAIN_LOGPROB_MAX || ns >= UNCERTAIN_NO_SPEECH_MIN || short;
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

  return (
    <div className={container}>
      {showContent ? (
        <>
          <h4 className={header}>{t('panel.gaps.title', 'Gaps')}</h4>
          {gaps.length === 0 ? (
            <div className={meta}>{t('panel.gaps.none', 'No large gaps detected')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {gaps.map((g, idx) => (
                <button
                  key={`${g.start}-${g.end}-${idx}`}
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
                  }}
                >
                  <span>{fmt(g.start)} → {fmt(g.end)}</span>
                  <span className={meta}>{Math.round(g.dur)}s</span>
                </button>
              ))}
            </div>
          )}

          <h4 className={header} style={{ marginTop: 10 }}>{t('panel.confidence.title', 'Low Confidence')}</h4>
          {lowConfidence.length === 0 ? (
            <div className={meta}>{t('panel.confidence.none', 'No low-confidence lines detected')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lowConfidence.map((r, idx) => (
                <button
                  key={`lc-${r.start}-${r.end}-${idx}`}
                  className={item}
                  onClick={() => {
                    try {
                      const st = useSubStore.getState();
                      if (r.firstId) {
                        st.seek(r.firstId);
                        requestAnimationFrame(() => st.scrollToCurrent());
                      }
                    } catch {}
                  }}
                >
                  <span>
                    {fmt(r.start)} → {fmt(r.end)}
                  </span>
                  <span className={meta}>{t('panel.confidence.count', { count: r.count })}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
