import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import {
  detailsSummaryStyles,
  liveActivityDetailsBodyStyles,
  liveActivityDetailsStyles,
  liveActivityHeaderActionsStyles,
  liveActivityHeaderStyles,
  liveActivityMetaStyles,
  liveActivityPanelStyles,
  liveActivityToggleButtonStyles,
  liveActivityTitleStyles,
  liveActivityTraceLineStyles,
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

const STAGE_PROGRESS_TICK_MS = 450;
const STAGE_PROGRESS_RUNNING_MIN = 7;
const STAGE_PROGRESS_RUNNING_MAX = 95;
const STAGE_PROGRESS_EASE_SEC = 28;

type StageProgressMap = Partial<Record<PipelineStageKey, number>>;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function runningStageTargetPercent(elapsedSec: number): number {
  const safeElapsed = Math.max(0, elapsedSec);
  const eased = 1 - Math.exp(-safeElapsed / STAGE_PROGRESS_EASE_SEC);
  return (
    STAGE_PROGRESS_RUNNING_MIN +
    (STAGE_PROGRESS_RUNNING_MAX - STAGE_PROGRESS_RUNNING_MIN) * eased
  );
}

export default function VideoSuggestionLiveActivity({
  activeTraceLines,
  clearedStageCount,
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

  const updateAutoScrollPreference = () => {
    const node = detailsBodyRef.current;
    if (!node) return;
    const distanceFromBottom =
      node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 28;
  };

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
                  '{{cleared}}/4 stages cleared • {{seconds}}s',
                  {
                    cleared: clearedStageCount,
                    seconds: loadingElapsedSec,
                  }
                )
              : t(
                  'input.videoSuggestion.lastActivityProgress',
                  '{{cleared}}/4 stages cleared • completed in {{seconds}}s',
                  {
                    cleared: clearedStageCount,
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

          {searchQuery.trim() ? (
            <div className={liveActivityMetaStyles}>
              {t('input.videoSuggestion.searchQueryLabel', 'Search query')}
              :&nbsp; &quot;{searchQuery.trim()}&quot;
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
                      stageProgress[stage.key] ??
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

              {activeTraceLines.length > 0 ? (
                <div className={liveActivityTraceStyles}>
                  {activeTraceLines.map((line, index) => (
                    <div
                      key={`trace-${index}-${line.slice(0, 24)}`}
                      className={liveActivityTraceLineStyles}
                    >
                      {line}
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
