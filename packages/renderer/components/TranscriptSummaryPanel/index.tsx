import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { SrtSegment } from '@shared-types/app';
import ErrorBanner from '../ErrorBanner';
import { useTaskStore, useUIStore } from '../../state';
import {
  errorWrapperStyles,
  panelStyles,
} from './TranscriptSummaryPanel.styles';
import TranscriptSummaryHeader from './TranscriptSummaryHeader';
import TranscriptSummaryHighlightsTab from './TranscriptSummaryHighlightsTab';
import TranscriptSummaryProgress from './TranscriptSummaryProgress';
import TranscriptSummarySectionsTab from './TranscriptSummarySectionsTab';
import TranscriptSummarySummaryTab from './TranscriptSummarySummaryTab';
import TranscriptSummaryTabs from './TranscriptSummaryTabs';
import useTranscriptSummaryLogic from './useTranscriptSummaryLogic';

interface TranscriptSummaryPanelProps {
  segments: SrtSegment[];
}

export function TranscriptSummaryPanel({
  segments,
}: TranscriptSummaryPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const summaryLanguage = useUIStore(state => state.summaryLanguage);
  const setSummaryLanguage = useUIStore(state => state.setSummaryLanguage);
  const summaryEffortLevel = useUIStore(state => state.summaryEffortLevel);
  const isMergeInProgress = useTaskStore(state => !!state.merge.inProgress);
  const isTranslationInProgress = useTaskStore(
    state => !!state.translation.inProgress
  );
  const [activeTab, setActiveTab] = useState<
    'summary' | 'sections' | 'highlights'
  >('summary');

  const {
    activeOperationId,
    combineCutState,
    combineMode,
    copyStatus,
    downloadStatus,
    error,
    handleCancel,
    handleCopy,
    handleCutCombined,
    handleCutHighlightClip,
    handleDownloadCombined,
    handleDownloadHighlight,
    handleDragStart,
    handleDrop,
    handleGenerate,
    handleToggleHighlightSelect,
    hasSummaryResult,
    hasTranscript,
    highlightAspectMode,
    highlights,
    highlightCutState,
    isCancelling,
    isGenerating,
    orderedSelection,
    progressLabel,
    progressPercent,
    sections,
    selectedHighlights,
    setCombineMode,
    setError,
    setHighlightAspectMode,
    showProgressBar,
    summary,
    summaryEstimate,
    videoAvailableForHighlights,
  } = useTranscriptSummaryLogic({
    segments,
    summaryEffortLevel,
    summaryLanguage,
    t,
  });

  if (!hasTranscript) {
    return null;
  }

  return (
    <div className={panelStyles}>
      <TranscriptSummaryHeader
        isGenerating={isGenerating}
        isMergeInProgress={isMergeInProgress}
        isTranslationInProgress={isTranslationInProgress}
        onGenerate={() => {
          void handleGenerate();
        }}
        onSummaryLanguageChange={setSummaryLanguage}
        summary={summary}
        summaryEffortLevel={summaryEffortLevel}
        summaryEstimate={summaryEstimate}
        summaryLanguage={summaryLanguage}
        tabs={
          <TranscriptSummaryTabs
            activeTab={activeTab}
            onChangeTab={setActiveTab}
            t={t}
          />
        }
        t={t}
      />

      <TranscriptSummaryProgress
        isCancelling={isCancelling}
        onCancel={() => {
          void handleCancel();
        }}
        progressLabel={progressLabel}
        progressPercent={progressPercent}
        show={showProgressBar}
        t={t}
      />

      {error ? (
        <div className={errorWrapperStyles}>
          <ErrorBanner message={error} onClose={() => setError(null)} />
        </div>
      ) : null}

      {activeTab === 'summary' ? (
        <TranscriptSummarySummaryTab
          copyStatus={copyStatus}
          onCopy={() => {
            void handleCopy();
          }}
          summary={summary}
          t={t}
        />
      ) : null}

      {activeTab === 'sections' ? (
        <TranscriptSummarySectionsTab sections={sections} t={t} />
      ) : null}

      {activeTab === 'highlights' ? (
        <TranscriptSummaryHighlightsTab
          activeOperationId={activeOperationId}
          combineCutState={combineCutState}
          combineMode={combineMode}
          downloadStatus={downloadStatus}
          hasSummaryResult={hasSummaryResult}
          highlightAspectMode={highlightAspectMode}
          highlightCutState={highlightCutState}
          highlights={highlights}
          isGenerating={isGenerating}
          onCutCombined={() => {
            void handleCutCombined();
          }}
          onCutHighlightClip={highlight => {
            void handleCutHighlightClip(highlight);
          }}
          onDownloadCombined={outputPath => {
            void handleDownloadCombined(outputPath);
          }}
          onDownloadHighlight={(highlight, index) => {
            void handleDownloadHighlight(highlight, index);
          }}
          onDragStart={handleDragStart}
          onDrop={handleDrop}
          onSetHighlightAspectMode={setHighlightAspectMode}
          onToggleCombineMode={() => setCombineMode(prev => !prev)}
          onToggleHighlightSelect={handleToggleHighlightSelect}
          orderedSelection={orderedSelection}
          selectedHighlights={selectedHighlights}
          t={t}
          videoAvailableForHighlights={videoAvailableForHighlights}
        />
      ) : null}
    </div>
  );
}

export default TranscriptSummaryPanel;
