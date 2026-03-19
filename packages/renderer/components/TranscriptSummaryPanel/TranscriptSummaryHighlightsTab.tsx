import type { DragEvent } from 'react';
import type { TFunction } from 'i18next';
import type {
  HighlightAspectMode,
  TranscriptHighlight,
  TranscriptHighlightStatus,
} from '@shared-types/app';
import Button from '../Button';
import {
  formatRange,
  getHighlightKey,
  toFileUrl,
  type HighlightClipCutState,
} from './TranscriptSummaryPanel.helpers';
import {
  aspectModeButtonStyles,
  aspectModeIconStyles,
  aspectModeLabelStyles,
  aspectModeRowStyles,
  aspectModeToggleStyles,
  combineControlsStyles,
  combinedResultStyles,
  combineCutProgressFillStyles,
  combineCutProgressStyles,
  combineCutRowStyles,
  highlightActions,
  highlightCard,
  highlightCheckboxStyles,
  highlightCutProgressFill,
  highlightCutProgressTrack,
  highlightDesc,
  highlightFormatRowStyles,
  highlightHeader,
  highlightPlaceholder,
  highlightPlaceholderText,
  highlightsGridStyles,
  highlightsTabStyles,
  highlightStatusError,
  highlightStatusSuccess,
  highlightTime,
  highlightTitle,
  highlightVideo,
  noHighlightsStyles,
  reorderContainerStyles,
  reorderIndexStyles,
  reorderItemStyles,
  reorderLabelStyles,
  reorderListStyles,
  reorderTimeStyles,
  reorderTitleStyles,
} from './TranscriptSummaryPanel.styles';

type CombineCutState = {
  status: 'idle' | 'cutting' | 'ready' | 'error' | 'cancelled';
  percent: number;
  error?: string;
  operationId?: string | null;
  outputPath?: string;
};

type TranscriptSummaryHighlightsTabProps = {
  activeOperationId: string | null;
  combineAspectMode: HighlightAspectMode;
  combineCutState: CombineCutState;
  combineMode: boolean;
  downloadStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  getHighlightAspectMode: (
    highlight: TranscriptHighlight
  ) => HighlightAspectMode;
  getHighlightStateKey: (highlight: TranscriptHighlight) => string;
  hasSummaryResult: boolean;
  highlightWarningMessage: string | null;
  highlightStatus: TranscriptHighlightStatus;
  highlightCutState: Record<string, HighlightClipCutState>;
  highlights: TranscriptHighlight[];
  isGenerating: boolean;
  isHighlightCutting: (highlight: TranscriptHighlight) => boolean;
  onCutCombined: () => void;
  onCutHighlightClip: (highlight: TranscriptHighlight) => void;
  onDownloadCombined: (outputPath: string) => void;
  onDownloadHighlight: (highlight: TranscriptHighlight, index: number) => void;
  onDragStart: (event: DragEvent, index: number) => void;
  onDrop: (event: DragEvent, targetIndex: number) => void;
  onSetCombineAspectMode: (mode: HighlightAspectMode) => void;
  onSetHighlightAspectMode: (
    highlight: TranscriptHighlight,
    mode: HighlightAspectMode
  ) => void;
  onToggleCombineMode: () => void;
  onToggleHighlightSelect: (
    highlight: TranscriptHighlight,
    checked: boolean
  ) => void;
  orderedSelection: TranscriptHighlight[];
  selectedHighlights: Set<string>;
  t: TFunction;
  videoAvailableForHighlights: boolean;
};

const CLIP_MODE_OPTIONS: HighlightAspectMode[] = [
  'vertical_reframe',
  'vertical_fit',
  'original',
];

function getAspectModeLabel(mode: HighlightAspectMode, t: TFunction): string {
  if (mode === 'original') {
    return t('summary.originalFormat', 'Original');
  }
  if (mode === 'vertical_fit') {
    return t('summary.verticalFitFormat', 'Shorts Fit');
  }
  return t('summary.verticalFormat', 'Shorts Reframe');
}

function getAspectModeDescription(
  mode: HighlightAspectMode,
  t: TFunction
): string {
  if (mode === 'original') {
    return t('summary.originalFormatDesc', 'Keep original video dimensions');
  }
  if (mode === 'vertical_fit') {
    return t(
      'summary.verticalFitFormatDesc',
      'Fit the original frame inside a 9:16 canvas'
    );
  }
  return t(
    'summary.verticalFormatDesc',
    'Crop and reframe for YouTube Shorts, TikTok, Reels (9:16)'
  );
}

function AspectModeIcon({ mode }: { mode: HighlightAspectMode }) {
  if (mode === 'original') {
    return (
      <svg
        aria-hidden="true"
        className={aspectModeIconStyles}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="3.5"
          y="6.5"
          width="17"
          height="11"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  if (mode === 'vertical_fit') {
    return (
      <svg
        aria-hidden="true"
        className={aspectModeIconStyles}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="7.5"
          y="2.5"
          width="9"
          height="19"
          rx="2.5"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <rect
          x="8.5"
          y="9"
          width="7"
          height="5"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className={aspectModeIconStyles}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="7.5"
        y="2.5"
        width="9"
        height="19"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M5.5 9.5h4M5.5 14.5h4M14.5 9.5h4M14.5 14.5h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function AspectModeToggle({
  activeMode,
  disabled,
  onSelectMode,
  t,
}: {
  activeMode: HighlightAspectMode;
  disabled?: boolean;
  onSelectMode: (mode: HighlightAspectMode) => void;
  t: TFunction;
}) {
  return (
    <div className={aspectModeToggleStyles}>
      {CLIP_MODE_OPTIONS.map(mode => (
        <button
          key={mode}
          className={aspectModeButtonStyles(activeMode === mode)}
          disabled={disabled}
          onClick={() => onSelectMode(mode)}
          title={getAspectModeDescription(mode, t)}
        >
          <AspectModeIcon mode={mode} />
          {getAspectModeLabel(mode, t)}
        </button>
      ))}
    </div>
  );
}

export default function TranscriptSummaryHighlightsTab({
  activeOperationId,
  combineAspectMode,
  combineCutState,
  combineMode,
  downloadStatus,
  getHighlightAspectMode,
  getHighlightStateKey,
  hasSummaryResult,
  highlightWarningMessage,
  highlightStatus,
  highlightCutState,
  highlights,
  isGenerating,
  isHighlightCutting,
  onCutCombined,
  onCutHighlightClip,
  onDownloadCombined,
  onDownloadHighlight,
  onDragStart,
  onDrop,
  onSetCombineAspectMode,
  onSetHighlightAspectMode,
  onToggleCombineMode,
  onToggleHighlightSelect,
  orderedSelection,
  selectedHighlights,
  t,
  videoAvailableForHighlights,
}: TranscriptSummaryHighlightsTabProps) {
  const combineSelectionLocked = combineCutState.status === 'cutting';

  return (
    <div className={highlightsTabStyles}>
      {hasSummaryResult && highlights.length > 1 ? (
        <div className={aspectModeRowStyles}>
          <Button
            variant={combineMode ? 'primary' : 'secondary'}
            size="sm"
            onClick={onToggleCombineMode}
            disabled={combineSelectionLocked}
          >
            {combineMode
              ? t('summary.exitCombineMode', 'Exit Combine')
              : t('summary.combineMode', 'Combine')}
          </Button>
        </div>
      ) : null}

      {combineMode && orderedSelection.length > 0 ? (
        <div className={combineControlsStyles}>
          <div className={highlightFormatRowStyles}>
            <span className={aspectModeLabelStyles}>
              {t('summary.clipFormat', 'Clip format:')}
            </span>
            <AspectModeToggle
              activeMode={combineAspectMode}
              disabled={combineSelectionLocked}
              onSelectMode={onSetCombineAspectMode}
              t={t}
            />
          </div>

          <div className={reorderListStyles}>
            <span className={reorderLabelStyles}>
              {t('summary.reorderHint', 'Drag to reorder:')}
            </span>
            <div className={reorderContainerStyles}>
              {orderedSelection.map((highlight, index) => (
                <div
                  key={getHighlightKey(highlight)}
                  draggable={!combineSelectionLocked}
                  onDragStart={event => {
                    if (combineSelectionLocked) return;
                    onDragStart(event, index);
                  }}
                  onDragOver={event => {
                    if (combineSelectionLocked) return;
                    event.preventDefault();
                  }}
                  onDrop={event => {
                    if (combineSelectionLocked) return;
                    onDrop(event, index);
                  }}
                  className={reorderItemStyles}
                >
                  <span className={reorderIndexStyles}>{index + 1}.</span>
                  <span className={reorderTitleStyles}>
                    {highlight.title ||
                      formatRange(highlight.start, highlight.end)}
                  </span>
                  <span className={reorderTimeStyles}>
                    {formatRange(highlight.start, highlight.end)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {orderedSelection.length >= 2 ? (
            <div className={combineCutRowStyles}>
              <Button
                variant="primary"
                size="sm"
                onClick={onCutCombined}
                disabled={
                  combineCutState.status === 'cutting' ||
                  !videoAvailableForHighlights
                }
              >
                {combineCutState.status === 'cutting'
                  ? t('summary.cuttingCombined', 'Cutting...')
                  : t(
                      'summary.cutCombined',
                      `Cut ${orderedSelection.length} Combined`
                    )}
              </Button>

              {combineCutState.status === 'cutting' ? (
                <div className={combineCutProgressStyles}>
                  <div
                    className={combineCutProgressFillStyles}
                    style={{ width: `${combineCutState.percent}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {combineCutState.status === 'ready' && combineCutState.outputPath ? (
        <div className={combinedResultStyles}>
          <h4>
            {t('summary.combinedHighlightReady', 'Combined Highlight Ready')}
          </h4>
          <video
            className={highlightVideo}
            controls
            src={toFileUrl(combineCutState.outputPath)}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onDownloadCombined(combineCutState.outputPath!)}
          >
            {t('summary.downloadCombined', 'Download Combined Clip')}
          </Button>
        </div>
      ) : null}

      {hasSummaryResult && highlightWarningMessage ? (
        <div className={noHighlightsStyles}>
          <span className={highlightStatusError}>
            {highlightWarningMessage}
          </span>
        </div>
      ) : null}

      {hasSummaryResult &&
      highlightStatus === 'degraded' &&
      !highlightWarningMessage ? (
        <div className={noHighlightsStyles}>
          <span className={highlightStatusError}>
            {t(
              'summary.highlightsPartialWarning',
              'Highlight extraction was partial. These highlights may be incomplete. Regenerate to refresh.'
            )}
          </span>
        </div>
      ) : null}

      {!hasSummaryResult ? (
        <div className={noHighlightsStyles}>
          {t(
            'summary.summaryRequiredForHighlights',
            'Generate highlights to analyze the transcript first.'
          )}
        </div>
      ) : highlights.length === 0 ? (
        <div className={noHighlightsStyles}>
          {t(
            'summary.noHighlights',
            'No highlights yet. Generate highlights to find the best moments.'
          )}
        </div>
      ) : (
        <div className={highlightsGridStyles}>
          {highlights.map((highlight, index) => {
            const stateKey = getHighlightStateKey(highlight);
            const activeMode = getHighlightAspectMode(highlight);
            const downloadState = downloadStatus[stateKey] || 'idle';
            const cutState = highlightCutState[stateKey];
            const cutStatus =
              cutState?.status || (highlight.videoPath ? 'ready' : 'idle');
            const cutPercent =
              typeof cutState?.percent === 'number'
                ? cutState.percent
                : highlight.videoPath
                  ? 100
                  : 0;
            const cutError = cutState?.error;
            const clipCutting = isHighlightCutting(highlight);
            const cutDisabled =
              clipCutting ||
              !videoAvailableForHighlights ||
              isGenerating ||
              Boolean(activeOperationId);

            return (
              <div key={getHighlightKey(highlight)} className={highlightCard}>
                <div className={highlightHeader}>
                  {combineMode ? (
                    <input
                      type="checkbox"
                      checked={selectedHighlights.has(
                        getHighlightKey(highlight)
                      )}
                      disabled={combineSelectionLocked}
                      onChange={event =>
                        onToggleHighlightSelect(highlight, event.target.checked)
                      }
                      className={highlightCheckboxStyles}
                    />
                  ) : null}
                  <div className={highlightTitle}>
                    {highlight.title || t('summary.highlight', 'Highlight')}
                  </div>
                  <div className={highlightTime}>
                    {formatRange(highlight.start, highlight.end)}
                  </div>
                </div>

                <div className={highlightFormatRowStyles}>
                  <span className={aspectModeLabelStyles}>
                    {t('summary.clipFormat', 'Clip format:')}
                  </span>
                  <AspectModeToggle
                    activeMode={activeMode}
                    disabled={clipCutting}
                    onSelectMode={mode =>
                      onSetHighlightAspectMode(highlight, mode)
                    }
                    t={t}
                  />
                </div>

                {highlight.videoPath ? (
                  <video
                    className={highlightVideo}
                    controls
                    src={toFileUrl(highlight.videoPath)}
                  />
                ) : (
                  <div className={highlightPlaceholder}>
                    <p className={highlightPlaceholderText}>
                      {t('summary.highlightPlaceholder', 'Clip not yet cut.')}
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onCutHighlightClip(highlight)}
                      disabled={cutDisabled}
                    >
                      {cutStatus === 'cutting'
                        ? t('summary.cuttingHighlightClip', 'Cutting…')
                        : t('summary.cutHighlightClip', 'Cut this highlight')}
                    </Button>

                    {cutStatus === 'cutting' ? (
                      <div className={highlightCutProgressTrack}>
                        <div
                          className={highlightCutProgressFill}
                          style={{ width: `${cutPercent}%` }}
                        />
                      </div>
                    ) : null}

                    {cutError ? (
                      <span className={highlightStatusError}>{cutError}</span>
                    ) : null}

                    {!videoAvailableForHighlights ? (
                      <span className={highlightStatusError}>
                        {t(
                          'summary.noVideoForHighlights',
                          'Open the source video to cut highlight clips.'
                        )}
                      </span>
                    ) : null}
                  </div>
                )}

                {highlight.description ? (
                  <div className={highlightDesc}>{highlight.description}</div>
                ) : null}

                {highlight.videoPath ? (
                  <div className={highlightActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onDownloadHighlight(highlight, index)}
                      disabled={downloadState === 'saving'}
                    >
                      {downloadState === 'saving'
                        ? t('summary.downloadingHighlight', 'Saving…')
                        : t('summary.downloadHighlight', 'Download clip')}
                    </Button>
                    {downloadState === 'saved' ? (
                      <span className={highlightStatusSuccess}>
                        {t('summary.highlightSaved', 'Saved!')}
                      </span>
                    ) : null}
                    {downloadState === 'error' ? (
                      <span className={highlightStatusError}>
                        {t('summary.highlightSaveError', 'Save failed')}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
