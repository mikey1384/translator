import { css } from '@emotion/css';
import { colors } from '../../styles';
import { useEffect, useState } from 'react';
import { useSubStore } from '../../state/subtitle-store';
import { useVideoStore, useUIStore } from '../../state';
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

export default function GapList() {
  const { t } = useTranslation();
  const { order, gaps, lcRanges, origin, sourceVideoPath } = useSubStore(s => ({
    order: s.order,
    gaps: s.gapsCache,
    lcRanges: s.lcRangesCache,
    origin: s.origin,
    sourceVideoPath: s.sourceVideoPath,
  }));
  const { url, path } = useVideoStore(s => ({ url: s.url, path: s.path }));
  const hasVideo = Boolean(url || path);
  const hasSubs = (order?.length ?? 0) > 0;
  const isFreshForThisVideo =
    origin === 'fresh' &&
    !!path &&
    !!sourceVideoPath &&
    sourceVideoPath === path;
  const showContent = hasVideo && hasSubs && isFreshForThisVideo;
  const seenGaps = useUIStore(s => s.seenGaps);
  const seenLC = useUIStore(s => s.seenLC);
  const markGapSeen = useUIStore(s => s.markGapSeen);
  const markLCSeen = useUIStore(s => s.markLCSeen);

  // Tab state
  const [tab, setTab] = useState<'gaps' | 'confidence'>('gaps');
  useEffect(() => {
    // Reset tab to default when video changes
    setTab('gaps');
  }, [path, url]);

  // Track which items were clicked (seen) in session-only store
  const markSeen = (type: 'gaps' | 'lc', key: string) => {
    if (type === 'gaps') markGapSeen(key);
    else markLCSeen(key);
  };

  const lowConfidence = lcRanges;

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
    &:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  `;

  const gapItems = gaps.map((g, idx) => {
    const key = `${g.start}-${g.end}`;
    const unseen = !seenGaps.has(key);
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
          } catch {
            // no-op
          }
          markSeen('gaps', key);
        }}
      >
        <span>
          {fmt(g.start)} → {fmt(g.end)}
        </span>
        <span className={meta}>
          {unseen ? (
            <span style={{ color: '#ff7a18', marginRight: 6 }} title="new">
              !
            </span>
          ) : null}
          {Math.round(g.dur)}s
        </span>
      </button>
    );
  });

  const lcItems = lowConfidence.map((r, idx) => {
    const key = `${r.start}-${r.end}`;
    const unseen = !seenLC.has(key);
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
          } catch {
            // no-op
          }
          markSeen('lc', key);
        }}
      >
        <span>
          {fmt(r.start)} → {fmt(r.end)}
        </span>
        <span className={meta}>
          {unseen ? (
            <span style={{ color: '#ff7a18', marginRight: 6 }} title="new">
              !
            </span>
          ) : null}
          {t('panel.confidence.count', { count: r.count })}
        </span>
      </button>
    );
  });

  const hasUnseenGaps = gaps.some(g => !seenGaps.has(`${g.start}-${g.end}`));
  const hasUnseenLC = lowConfidence.some(
    r => !seenLC.has(`${r.start}-${r.end}`)
  );

  return (
    <div className={container}>
      {showContent ? (
        <>
          <div className={tabBar} role="tablist">
            <button
              className={tabBtn(tab === 'gaps')}
              role="tab"
              aria-selected={tab === 'gaps'}
              onClick={() => setTab('gaps')}
            >
              {t('panel.gaps.title', 'Gaps')}
              {hasUnseenGaps ? (
                <span style={{ color: '#ff7a18' }}>!</span>
              ) : null}
            </button>
            <button
              className={tabBtn(tab === 'confidence')}
              role="tab"
              aria-selected={tab === 'confidence'}
              onClick={() => setTab('confidence')}
            >
              {t('panel.confidence.title', 'Low Confidence')}
              {hasUnseenLC ? <span style={{ color: '#ff7a18' }}>!</span> : null}
            </button>
          </div>

          {tab === 'gaps' ? (
            gaps.length === 0 ? (
              <div className={meta}>
                {t('panel.gaps.none', 'No large gaps detected')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gapItems}
              </div>
            )
          ) : lowConfidence.length === 0 ? (
            <div className={meta}>
              {t('panel.confidence.none', 'No low-confidence lines detected')}
            </div>
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
