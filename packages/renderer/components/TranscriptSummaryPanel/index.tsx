import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import type { SrtSegment } from '@shared-types/app';
import ErrorBanner from '../ErrorBanner';
import {
  useHighlightGenerationRequestStore,
  useSubStore,
  useTaskStore,
  useUIStore,
  useVideoStore,
} from '../../state';
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
import {
  buildSemanticSummarySourceIdentity,
  buildSummaryRequestOwnerKey,
} from './transcript-usable-segments';
import useTranscriptSummaryLogic from './useTranscriptSummaryLogic';

interface TranscriptSummaryPanelProps {
  generationLocked?: boolean;
  segments: SrtSegment[];
}

export function TranscriptSummaryPanel({
  generationLocked = false,
  segments,
}: TranscriptSummaryPanelProps): JSX.Element | null {
  const { t } = useTranslation();
  const summaryLanguage = useUIStore(state => state.summaryLanguage);
  const setSummaryLanguage = useUIStore(state => state.setSummaryLanguage);
  const summaryEffortLevel = useUIStore(state => state.summaryEffortLevel);
  const originalVideoPath = useVideoStore(state => state.originalPath);
  const sourceAssetIdentity = useVideoStore(state => state.sourceAssetIdentity);
  const sourceUrl = useVideoStore(state => state.sourceUrl);
  const fallbackVideoPath = useSubStore(state => state.sourceVideoPath);
  const fallbackVideoAssetIdentity = useSubStore(
    state => state.sourceVideoAssetIdentity
  );
  const isMergeInProgress = useTaskStore(state => !!state.merge.inProgress);
  const isTranslationInProgress = useTaskStore(
    state => !!state.translation.inProgress
  );
  const [activeTab, setActiveTab] = useState<
    'summary' | 'sections' | 'highlights'
  >('highlights');
  const pendingHighlightRequests = useHighlightGenerationRequestStore(
    state => state.pendingRequests
  );
  const claimedHighlightRequests = useHighlightGenerationRequestStore(
    state => state.claimedRequests
  );
  const requestHighlights = useHighlightGenerationRequestStore(
    state => state.requestHighlights
  );
  const clearPendingHighlightRequest = useHighlightGenerationRequestStore(
    state => state.clearPendingRequest
  );
  const previousTranscriptRequestOwnerKeyRef = useRef<string | null>(null);

  const {
    activeOperationId,
    combineAspectMode,
    combineCutState,
    combineMode,
    copyStatus,
    downloadStatus,
    error,
    getHighlightAspectMode,
    getHighlightStateKey,
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
    highlightWarningMessage,
    highlightStatus,
    highlights,
    highlightCutState,
    isRestoreSettledForCurrentSignature,
    isCancelling,
    isGenerating,
    isHighlightCutting,
    orderedSelection,
    progressLabel,
    progressPercent,
    sections,
    selectedHighlights,
    setCombineAspectMode,
    setCombineMode,
    setError,
    setHighlightAspectModeForHighlight,
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

  const transcriptRequestOwnerKey = useMemo(() => {
    const semanticSourceIdentity = buildSemanticSummarySourceIdentity({
      fallbackVideoAssetIdentity,
      fallbackVideoPath,
      originalVideoPath,
      sourceAssetIdentity,
      sourceUrl,
    });
    return buildSummaryRequestOwnerKey({
      semanticSourceIdentity,
      segments,
      summaryLanguage,
      effortLevel: summaryEffortLevel,
    });
  }, [
    fallbackVideoAssetIdentity,
    fallbackVideoPath,
    originalVideoPath,
    segments,
    sourceAssetIdentity,
    sourceUrl,
    summaryEffortLevel,
    summaryLanguage,
  ]);

  const pendingRequestForThisTranscript = useMemo(() => {
    for (const [requestId, request] of Object.entries(
      pendingHighlightRequests
    )) {
      if (request.ownerKey !== transcriptRequestOwnerKey) continue;
      return {
        id: Number(requestId),
        source: request.source,
        ownerKey: request.ownerKey,
      };
    }

    return null;
  }, [pendingHighlightRequests, transcriptRequestOwnerKey]);

  const activeRequestForThisTranscriptId = useMemo(() => {
    if (pendingRequestForThisTranscript) {
      return pendingRequestForThisTranscript.id;
    }

    for (const [requestId, request] of Object.entries(
      claimedHighlightRequests
    )) {
      if (request.cancelled) continue;
      if (request.ownerKey !== transcriptRequestOwnerKey) continue;
      return Number(requestId);
    }

    return null;
  }, [
    claimedHighlightRequests,
    pendingRequestForThisTranscript,
    transcriptRequestOwnerKey,
  ]);

  const isGenerateBusy =
    isGenerating || activeRequestForThisTranscriptId != null;
  const canSatisfyGenerateSubtitlesHighlightRequest =
    hasSummaryResult &&
    (highlightStatus === 'complete' ||
      (highlightStatus === 'degraded' && highlights.length > 0));

  useEffect(() => {
    if (generationLocked) return;
    if (!pendingRequestForThisTranscript) return;
    if (!hasTranscript || isGenerating) return;
    if (!isRestoreSettledForCurrentSignature) return;
    if (
      pendingRequestForThisTranscript.source === 'generate-subtitles' &&
      canSatisfyGenerateSubtitlesHighlightRequest
    ) {
      clearPendingHighlightRequest(pendingRequestForThisTranscript.id);
      return;
    }

    const claimedRequest = useHighlightGenerationRequestStore
      .getState()
      .claimPendingRequest({
        expectedRequestId: pendingRequestForThisTranscript.id,
        expectedOwnerKey: transcriptRequestOwnerKey,
      });
    if (!claimedRequest) return;

    void handleGenerate(claimedRequest);
  }, [
    generationLocked,
    canSatisfyGenerateSubtitlesHighlightRequest,
    clearPendingHighlightRequest,
    hasTranscript,
    handleGenerate,
    isGenerating,
    isRestoreSettledForCurrentSignature,
    pendingRequestForThisTranscript,
    transcriptRequestOwnerKey,
  ]);

  useEffect(() => {
    const previousOwnerKey = previousTranscriptRequestOwnerKeyRef.current;
    previousTranscriptRequestOwnerKeyRef.current = transcriptRequestOwnerKey;
    if (
      previousOwnerKey == null ||
      previousOwnerKey === transcriptRequestOwnerKey
    ) {
      return;
    }

    const state = useHighlightGenerationRequestStore.getState();
    for (const [requestId, request] of Object.entries(state.pendingRequests)) {
      if (
        request.source !== 'summary-panel' &&
        request.source !== 'generate-subtitles'
      ) {
        continue;
      }
      if (request.ownerKey !== previousOwnerKey) continue;
      state.clearPendingRequest(Number(requestId));
    }
  }, [transcriptRequestOwnerKey]);

  useEffect(() => {
    return () => {
      const state = useHighlightGenerationRequestStore.getState();
      for (const [requestId, request] of Object.entries(
        state.pendingRequests
      )) {
        if (
          request.source !== 'summary-panel' &&
          request.source !== 'generate-subtitles'
        ) {
          continue;
        }
        if (request.ownerKey !== transcriptRequestOwnerKey) continue;
        state.clearPendingRequest(Number(requestId));
      }
    };
  }, [transcriptRequestOwnerKey]);

  if (!hasTranscript) {
    return null;
  }

  return (
    <div className={panelStyles}>
      <TranscriptSummaryHeader
        generationLocked={generationLocked}
        isGenerating={isGenerateBusy}
        isMergeInProgress={isMergeInProgress}
        isTranslationInProgress={isTranslationInProgress}
        onGenerate={() => {
          if (generationLocked) return;
          requestHighlights('summary-panel', {
            ownerKey: transcriptRequestOwnerKey,
          });
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
          combineAspectMode={combineAspectMode}
          combineCutState={combineCutState}
          combineMode={combineMode}
          downloadStatus={downloadStatus}
          getHighlightAspectMode={getHighlightAspectMode}
          getHighlightStateKey={getHighlightStateKey}
          hasSummaryResult={hasSummaryResult}
          isHighlightCutting={isHighlightCutting}
          highlightWarningMessage={highlightWarningMessage}
          highlightStatus={highlightStatus}
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
          onSetCombineAspectMode={setCombineAspectMode}
          onSetHighlightAspectMode={setHighlightAspectModeForHighlight}
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
