import type { DragEvent } from 'react';
import type { TFunction } from 'i18next';
import type {
  HighlightAspectMode,
  TranscriptHighlight,
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
  combineCutState: CombineCutState;
  combineMode: boolean;
  downloadStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  hasSummaryResult: boolean;
  highlightAspectMode: HighlightAspectMode;
  highlightCutState: Record<string, HighlightClipCutState>;
  highlights: TranscriptHighlight[];
  isGenerating: boolean;
  onCutCombined: () => void;
  onCutHighlightClip: (highlight: TranscriptHighlight) => void;
  onDownloadCombined: (outputPath: string) => void;
  onDownloadHighlight: (highlight: TranscriptHighlight, index: number) => void;
  onDragStart: (event: DragEvent, index: number) => void;
  onDrop: (event: DragEvent, targetIndex: number) => void;
  onSetHighlightAspectMode: (mode: HighlightAspectMode) => void;
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

export default function TranscriptSummaryHighlightsTab({
  activeOperationId,
  combineCutState,
  combineMode,
  downloadStatus,
  hasSummaryResult,
  highlightAspectMode,
  highlightCutState,
  highlights,
  isGenerating,
  onCutCombined,
  onCutHighlightClip,
  onDownloadCombined,
  onDownloadHighlight,
  onDragStart,
  onDrop,
  onSetHighlightAspectMode,
  onToggleCombineMode,
  onToggleHighlightSelect,
  orderedSelection,
  selectedHighlights,
  t,
  videoAvailableForHighlights,
}: TranscriptSummaryHighlightsTabProps) {
  return (
    <div className={highlightsTabStyles}>
      {hasSummaryResult && highlights.length > 0 ? (
        <div className={aspectModeRowStyles}>
          <span className={aspectModeLabelStyles}>
            {t('summary.clipFormat', 'Clip format:')}
          </span>
          <div className={aspectModeToggleStyles}>
            <button
              className={aspectModeButtonStyles(
                highlightAspectMode === 'vertical'
              )}
              onClick={() => onSetHighlightAspectMode('vertical')}
              title={t(
                'summary.verticalFormatDesc',
                'Optimized for YouTube Shorts, TikTok, Reels (9:16)'
              )}
            >
              {t('summary.verticalFormat', '9:16 Vertical')}
            </button>
            <button
              className={aspectModeButtonStyles(
                highlightAspectMode === 'original'
              )}
              onClick={() => onSetHighlightAspectMode('original')}
              title={t(
                'summary.originalFormatDesc',
                'Keep original video dimensions'
              )}
            >
              {t('summary.originalFormat', 'Original')}
            </button>
          </div>
          {highlights.length > 1 ? (
            <Button
              variant={combineMode ? 'primary' : 'secondary'}
              size="sm"
              onClick={onToggleCombineMode}
              disabled={combineCutState.status === 'cutting'}
            >
              {combineMode
                ? t('summary.exitCombineMode', 'Exit Combine')
                : t('summary.combineMode', 'Combine')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {combineMode && orderedSelection.length > 0 ? (
        <div className={combineControlsStyles}>
          <div className={reorderListStyles}>
            <span className={reorderLabelStyles}>
              {t('summary.reorderHint', 'Drag to reorder:')}
            </span>
            <div className={reorderContainerStyles}>
              {orderedSelection.map((highlight, index) => (
                <div
                  key={getHighlightKey(highlight)}
                  draggable
                  onDragStart={event => onDragStart(event, index)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => onDrop(event, index)}
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

      {!hasSummaryResult ? (
        <div className={noHighlightsStyles}>
          {t(
            'summary.summaryRequiredForHighlights',
            'Generate a transcript summary before cutting highlight clips.'
          )}
        </div>
      ) : highlights.length === 0 ? (
        <div className={noHighlightsStyles}>
          {t(
            'summary.noHighlights',
            'No highlights yet. Generate to detect punchlines.'
          )}
        </div>
      ) : (
        <div className={highlightsGridStyles}>
          {highlights.map((highlight, index) => {
            const statusKey = getHighlightKey(highlight);
            const downloadState = downloadStatus[statusKey] || 'idle';
            const cutState = highlightCutState[statusKey];
            const cutStatus =
              cutState?.status || (highlight.videoPath ? 'ready' : 'idle');
            const cutPercent =
              typeof cutState?.percent === 'number'
                ? cutState.percent
                : highlight.videoPath
                  ? 100
                  : 0;
            const cutError = cutState?.error;
            const cutDisabled =
              cutStatus === 'cutting' ||
              !videoAvailableForHighlights ||
              isGenerating ||
              Boolean(activeOperationId);

            return (
              <div key={statusKey} className={highlightCard}>
                <div className={highlightHeader}>
                  {combineMode ? (
                    <input
                      type="checkbox"
                      checked={selectedHighlights.has(statusKey)}
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
