import { useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  detailsSummaryStyles,
  liveActivityDetailsBodyStyles,
  liveActivityDetailsStyles,
  liveActivityHeaderActionsStyles,
  liveActivityHeaderStyles,
  liveActivityMetaStyles,
  liveActivityPanelStyles,
  liveActivityTraceBadgeStyles,
  liveActivityTraceLabelStyles,
  liveActivityToggleButtonStyles,
  liveActivityTitleStyles,
  liveActivityTraceLineStyles,
  liveActivityTraceMessageStyles,
  liveActivityTraceStyles,
} from './VideoSuggestionPanel.styles.js';

type VideoSuggestionLiveActivityProps = {
  activeTraceLines: string[];
  hasResults?: boolean;
  hidden?: boolean;
  loading: boolean;
  loadingElapsedSec: number;
  loadingMessage: string;
  t: TFunction;
};

type ParsedTraceLine = {
  elapsedLabel: string | null;
  phaseLabel: string | null;
  message: string;
};

function truncateTraceMessage(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function parseTraceLine(line: string): ParsedTraceLine {
  const fallback = truncateTraceMessage(line);
  let remaining = String(line ?? '').trim();
  if (!remaining) {
    return {
      elapsedLabel: null,
      phaseLabel: null,
      message: fallback,
    };
  }

  let elapsedLabel: string | null = null;
  let phaseLabel: string | null = null;

  const elapsedMatch = remaining.match(/^(\d+s)\s*·\s*/);
  if (elapsedMatch) {
    elapsedLabel = elapsedMatch[1];
    remaining = remaining.slice(elapsedMatch[0].length).trim();
  }

  const phaseMatch = remaining.match(/^\[([^\]]+)\]\s*/);
  if (phaseMatch) {
    phaseLabel = phaseMatch[1];
    remaining = remaining.slice(phaseMatch[0].length).trim();
  }

  return {
    elapsedLabel,
    phaseLabel,
    message: truncateTraceMessage(remaining || fallback),
  };
}

export default function VideoSuggestionLiveActivity({
  activeTraceLines,
  hasResults = false,
  hidden = false,
  loading,
  loadingElapsedSec,
  loadingMessage,
  t,
}: VideoSuggestionLiveActivityProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const previousLoadingRef = useRef(loading);

  useEffect(() => {
    if (!detailsOpen || !loading) return;
    const node = detailsBodyRef.current;
    if (!node) return;
    if (!shouldAutoScrollRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [activeTraceLines, loading, detailsOpen]);

  useEffect(() => {
    if (loading) {
      setPanelOpen(true);
      setDetailsOpen(true);
      shouldAutoScrollRef.current = true;
      previousLoadingRef.current = true;
      return;
    }

    const justFinishedLoading = previousLoadingRef.current;
    previousLoadingRef.current = false;

    if (justFinishedLoading && hasResults) {
      setPanelOpen(false);
      setDetailsOpen(false);
    }
  }, [hasResults, loading]);

  const updateAutoScrollPreference = () => {
    const node = detailsBodyRef.current;
    if (!node) return;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 28;
  };

  const compactTraceLines = activeTraceLines.slice(-6).map(parseTraceLine);

  return (
    <div
      className={liveActivityPanelStyles}
      style={hidden ? { display: 'none' } : undefined}
    >
      <div className={liveActivityHeaderStyles}>
        <div className={liveActivityTitleStyles}>
          {loading
            ? t(
                'input.videoSuggestion.liveActivityTitle',
                'Live search activity'
              )
            : t(
                'input.videoSuggestion.lastActivityTitle',
                'Latest search activity'
              )}
        </div>
        <div className={liveActivityHeaderActionsStyles}>
          <div className={liveActivityMetaStyles}>{loadingElapsedSec}s</div>
          <button
            type="button"
            className={liveActivityToggleButtonStyles}
            onClick={() => setPanelOpen(value => !value)}
            aria-expanded={panelOpen}
          >
            {panelOpen
              ? t('input.videoSuggestion.minimizeActivity', 'Minimize')
              : t('input.videoSuggestion.expandActivity', 'Expand')}
          </button>
        </div>
      </div>

      {panelOpen ? (
        <details
          className={liveActivityDetailsStyles}
          open={detailsOpen}
          onToggle={event => {
            const isOpen = event.currentTarget.open;
            setDetailsOpen(isOpen);
            if (isOpen) {
              shouldAutoScrollRef.current = true;
              requestAnimationFrame(() => {
                const node = detailsBodyRef.current;
                if (!node) return;
                node.scrollTop = node.scrollHeight;
              });
            }
          }}
        >
          <summary className={detailsSummaryStyles}>
            {t('input.videoSuggestion.liveDetailsToggle', 'Live details')}
          </summary>
          <div
            ref={detailsBodyRef}
            className={liveActivityDetailsBodyStyles}
            onScroll={updateAutoScrollPreference}
          >
            {compactTraceLines.length > 0 ? (
              <div className={liveActivityTraceStyles}>
                <div className={liveActivityTraceLabelStyles}>
                  {t('input.videoSuggestion.recentEvents', 'Recent events')}
                </div>
                {compactTraceLines.map((line, index) => (
                  <div
                    key={`trace-${index}-${line.message.slice(0, 24)}`}
                    className={liveActivityTraceLineStyles}
                  >
                    {line.elapsedLabel ? (
                      <span className={liveActivityTraceBadgeStyles}>
                        {line.elapsedLabel}
                      </span>
                    ) : null}
                    {line.phaseLabel ? (
                      <span className={liveActivityTraceBadgeStyles}>
                        {line.phaseLabel}
                      </span>
                    ) : null}
                    <span className={liveActivityTraceMessageStyles}>
                      {line.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className={liveActivityMetaStyles}>
                {loading
                  ? loadingMessage
                  : t(
                      'input.videoSuggestion.activityComplete',
                      'Search activity complete.'
                    )}
              </div>
            )}
          </div>
        </details>
      ) : null}
    </div>
  );
}
