import { useEffect, useState } from 'react';
import { useSubStore } from '../../state/subtitle-store';
import { useVideoStore, useUIStore } from '../../state';
import { useTranslation } from 'react-i18next';
import { nativeSeek } from '../../native-player';
import { shouldUseWhisperReviewHints } from '../../utils/subtitle-heuristics';
import {
  sidePanelEmptyCopyStyles,
  sidePanelItemButtonStyles,
  sidePanelListStyles,
  sidePanelMetaRowStyles,
  sidePanelNewBadgeStyles,
  sidePanelShellStyles,
  sidePanelTabButtonStyles,
  sidePanelTabsStyles,
} from './video-player-side-styles';

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
  const order = useSubStore(s => s.order);
  const gaps = useSubStore(s => s.gapsCache);
  const lcRanges = useSubStore(s => s.lcRangesCache);
  const origin = useSubStore(s => s.origin);
  const sourceVideoPath = useSubStore(s => s.sourceVideoPath);
  const transcriptionEngine = useSubStore(s => s.transcriptionEngine);
  const url = useVideoStore(s => s.url);
  const path = useVideoStore(s => s.path);
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
  const showLowConfidenceTab = shouldUseWhisperReviewHints(
    transcriptionEngine
  );

  // Tab state
  const [tab, setTab] = useState<'gaps' | 'confidence'>('gaps');
  useEffect(() => {
    // Reset tab to default when video changes
    setTab('gaps');
  }, [path, url]);

  useEffect(() => {
    if (!showLowConfidenceTab && tab === 'confidence') {
      setTab('gaps');
    }
  }, [showLowConfidenceTab, tab]);

  // Track which items were clicked (seen) in session-only store
  const markSeen = (type: 'gaps' | 'lc', key: string) => {
    if (type === 'gaps') markGapSeen(key);
    else markLCSeen(key);
  };

  const lowConfidence = lcRanges;

  const gapItems = gaps.map((g, idx) => {
    const key = `${g.start}-${g.end}`;
    const unseen = !seenGaps.has(key);
    return (
      <button
        key={`${key}-${idx}`}
        className={sidePanelItemButtonStyles}
        onClick={() => {
          try {
            const gapMidpoint = g.start + Math.max(0.05, g.dur / 2);
            nativeSeek(Math.min(g.end, gapMidpoint));
          } catch {
            // no-op
          }
          markSeen('gaps', key);
        }}
      >
        <span>
          {fmt(g.start)} → {fmt(g.end)}
        </span>
        <span className={sidePanelMetaRowStyles}>
          {unseen ? (
            <span className={sidePanelNewBadgeStyles} title={t('panel.new', 'new')}>
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
        className={sidePanelItemButtonStyles}
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
        <span className={sidePanelMetaRowStyles}>
          {unseen ? (
            <span className={sidePanelNewBadgeStyles} title={t('panel.new', 'new')}>
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
    <div className={sidePanelShellStyles}>
      {showContent ? (
        <>
          <div className={sidePanelTabsStyles} role="tablist">
            <button
              className={sidePanelTabButtonStyles(tab === 'gaps')}
              role="tab"
              aria-selected={tab === 'gaps'}
              onClick={() => setTab('gaps')}
            >
              {t('panel.gaps.title', 'Gaps')}
              {hasUnseenGaps ? (
                <span className={sidePanelNewBadgeStyles}>!</span>
              ) : null}
            </button>
            {showLowConfidenceTab ? (
              <button
                className={sidePanelTabButtonStyles(tab === 'confidence')}
                role="tab"
                aria-selected={tab === 'confidence'}
                onClick={() => setTab('confidence')}
              >
                {t('panel.confidence.title', 'Low Confidence')}
                {hasUnseenLC ? (
                  <span className={sidePanelNewBadgeStyles}>!</span>
                ) : null}
              </button>
            ) : null}
          </div>

          {tab === 'gaps' ? (
            gaps.length === 0 ? (
              <div className={sidePanelEmptyCopyStyles}>
                {t('panel.gaps.none', 'No large gaps detected')}
              </div>
            ) : (
              <div className={sidePanelListStyles}>{gapItems}</div>
            )
          ) : lowConfidence.length === 0 ? (
            <div className={sidePanelEmptyCopyStyles}>
              {t('panel.confidence.none', 'No low-confidence lines detected')}
            </div>
          ) : (
            <div className={sidePanelListStyles}>{lcItems}</div>
          )}
        </>
      ) : null}
    </div>
  );
}
