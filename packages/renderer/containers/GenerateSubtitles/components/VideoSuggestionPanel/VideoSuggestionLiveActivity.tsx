import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  calculateOverallPipelineProgress,
  clampPercent,
  inferRetrievalStageProgressFromMessage,
  runningStageTargetPercent,
  STAGE_PROGRESS_TICK_MS,
  type StageProgressMap,
} from './video-suggestion-helpers.js';
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
  stageOutcomeStyles,
  stagePercentStyles,
  stageProgressFillClearedStyles,
  stageProgressFillStyles,
  stageProgressTrackStyles,
  stageRowClearedStyles,
  stageRowPendingStyles,
  stageRowRunningStyles,
  stageRowStyles,
  stageTimelineStyles,
  stageTitleStyles,
} from './VideoSuggestionPanel.styles.js';
import type {
  PipelineStageKey,
  PipelineStageProgress,
} from './VideoSuggestionPanel.types.js';

type VideoSuggestionLiveActivityProps = {
  activeTraceLines: string[];
  clearedStageCount: number;
  hasResults?: boolean;
  hidden?: boolean;
  loading: boolean;
  loadingElapsedSec: number;
  loadingMessage: string;
  pipelineStages: PipelineStageProgress[];
  runningStage: PipelineStageProgress | null;
  searchQuery: string;
  t: TFunction;
  pipelineStageLabel: (key: PipelineStageKey) => string;
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
  clearedStageCount,
  hasResults = false,
  hidden = false,
  loading,
  loadingElapsedSec,
  loadingMessage,
  pipelineStages,
  runningStage,
  searchQuery,
  t,
  pipelineStageLabel,
}: VideoSuggestionLiveActivityProps) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [stageProgress, setStageProgress] = useState<StageProgressMap>({});
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const stageRunStartedAtRef = useRef<
    Partial<Record<PipelineStageKey, number>>
  >({});
  const pipelineStagesRef = useRef<PipelineStageProgress[]>(pipelineStages);
  const previousLoadingRef = useRef(loading);

  useEffect(() => {
    pipelineStagesRef.current = pipelineStages;
  }, [pipelineStages]);

  const updateStageProgress = useCallback(
    (stages: PipelineStageProgress[], nowMs: number) => {
      setStageProgress(prev => {
        const next: StageProgressMap = { ...prev };
        for (const stage of stages) {
          if (stage.state === 'cleared') {
            next[stage.key] = 100;
            delete stageRunStartedAtRef.current[stage.key];
            continue;
          }

          if (stage.state === 'running') {
            const startedAt = stageRunStartedAtRef.current[stage.key] || nowMs;
            stageRunStartedAtRef.current[stage.key] = startedAt;
            const elapsedSec = Math.max(0, (nowMs - startedAt) / 1000);
            const target = runningStageTargetPercent(elapsedSec);
            const current = clampPercent(next[stage.key] ?? 0);
            next[stage.key] = clampPercent(Math.max(current, target));
            continue;
          }

          next[stage.key] = 0;
          delete stageRunStartedAtRef.current[stage.key];
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    updateStageProgress(pipelineStages, Date.now());
  }, [pipelineStages, updateStageProgress]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      updateStageProgress(pipelineStagesRef.current, Date.now());
    }, STAGE_PROGRESS_TICK_MS);
    return () => window.clearInterval(timer);
  }, [loading, updateStageProgress]);

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
  const retrievalStage = pipelineStages.find(stage => stage.key === 'retrieval');
  const hintedRetrievalProgress =
    retrievalStage?.state === 'running'
      ? inferRetrievalStageProgressFromMessage(loadingMessage)
      : null;
  const effectiveStageProgress: StageProgressMap =
    hintedRetrievalProgress == null
      ? stageProgress
      : {
          ...stageProgress,
          retrieval: Math.max(
            stageProgress.retrieval ?? 0,
            hintedRetrievalProgress
          ),
        };
  const rawOverallProgressPercent = Math.round(
    calculateOverallPipelineProgress(pipelineStages, effectiveStageProgress)
  );
  const overallProgressPercent =
    loading && rawOverallProgressPercent >= 100
      ? 99
      : rawOverallProgressPercent;

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
          <div className={liveActivityMetaStyles}>
            {loading
              ? t(
                  'input.videoSuggestion.liveActivityProgress',
                  '{{cleared}}/3 stages cleared • {{seconds}}s • {{progress}}%',
                  {
                    cleared: clearedStageCount,
                    progress: overallProgressPercent,
                    seconds: loadingElapsedSec,
                  }
                )
              : t(
                  'input.videoSuggestion.lastActivityProgress',
                  '{{cleared}}/3 stages cleared • completed in {{seconds}}s • {{progress}}%',
                  {
                    cleared: clearedStageCount,
                    progress: overallProgressPercent,
                    seconds: loadingElapsedSec,
                  }
                )}
          </div>
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
        <>
          {runningStage ? (
            <div className={liveActivityMetaStyles}>
              {t('input.videoSuggestion.currentStep', 'Current step')}:{' '}
              {runningStage.index}. {pipelineStageLabel(runningStage.key)}
            </div>
          ) : null}

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
              <div className={stageTimelineStyles}>
                {pipelineStages.map(stage => {
                  const stateText =
                    stage.state === 'cleared'
                      ? t('input.videoSuggestion.stageCleared', 'Cleared')
                      : stage.state === 'running'
                        ? t('input.videoSuggestion.stageRunning', 'Running...')
                        : t('input.videoSuggestion.stagePending', 'Pending');
                  const progressPct = Math.round(
                    clampPercent(
                      effectiveStageProgress[stage.key] ??
                        (stage.state === 'cleared' ? 100 : 0)
                    )
                  );

                  return (
                    <div
                      key={`live-${stage.key}`}
                      className={`${stageRowStyles} ${
                        stage.state === 'cleared'
                          ? stageRowClearedStyles
                          : stage.state === 'running'
                            ? stageRowRunningStyles
                            : stageRowPendingStyles
                      }`}
                    >
                      <div className={stageTitleStyles}>
                        <span>
                          {stage.index}. {pipelineStageLabel(stage.key)} -{' '}
                          {stateText}
                        </span>
                        <span className={stagePercentStyles}>
                          {progressPct}%
                        </span>
                      </div>
                      <div className={stageProgressTrackStyles}>
                        <div
                          className={`${stageProgressFillStyles} ${
                            stage.state === 'cleared'
                              ? stageProgressFillClearedStyles
                              : ''
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      {stage.outcome ? (
                        <div className={stageOutcomeStyles}>
                          {stage.outcome}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

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
        </>
      ) : null}
    </div>
  );
}
