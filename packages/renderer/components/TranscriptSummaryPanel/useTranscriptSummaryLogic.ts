import {
  useCallback,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from 'react';
import type {
  HighlightAspectMode,
  SrtSegment,
  SummaryEffortLevel,
  TranscriptHighlight,
  TranscriptHighlightStatus,
  TranscriptSummarySection,
} from '@shared-types/app';
import type { TFunction } from 'i18next';
import { useSubStore, useVideoStore } from '../../state';
import type { HighlightGenerationRequest } from '../../state/highlight-generation-request-store';
import type { HighlightClipCutState } from './TranscriptSummaryPanel.helpers';
import type {
  CombineCutState,
  SummaryEstimate,
} from './TranscriptSummaryLogic.types';
import useTranscriptHighlightsFlow from './useTranscriptHighlightsFlow';
import useTranscriptSummaryFlow from './useTranscriptSummaryFlow';

export type {
  CombineCutState,
  SummaryEstimate,
} from './TranscriptSummaryLogic.types';

type UseTranscriptSummaryLogicParams = {
  segments: SrtSegment[];
  summaryEffortLevel: SummaryEffortLevel;
  summaryLanguage: string;
  t: TFunction;
};

type UseTranscriptSummaryLogicResult = {
  activeOperationId: string | null;
  combineAspectMode: HighlightAspectMode;
  combineCutState: CombineCutState;
  combineMode: boolean;
  copyStatus: 'idle' | 'copied';
  downloadStatus: Record<string, 'idle' | 'saving' | 'saved' | 'error'>;
  error: string | null;
  getHighlightAspectMode: (
    highlight: TranscriptHighlight
  ) => HighlightAspectMode;
  getHighlightStateKey: (highlight: TranscriptHighlight) => string;
  handleCancel: () => Promise<void>;
  handleCopy: () => Promise<void>;
  handleCutCombined: () => Promise<void>;
  handleCutHighlightClip: (highlight: TranscriptHighlight) => Promise<void>;
  handleDownloadCombined: (outputPath: string) => Promise<void>;
  handleDownloadHighlight: (
    highlight: TranscriptHighlight,
    index: number
  ) => Promise<void>;
  handleDragStart: (event: DragEvent, index: number) => void;
  handleDrop: (event: DragEvent, targetIndex: number) => void;
  handleGenerate: (
    claimedRequest?: HighlightGenerationRequest | null
  ) => Promise<void>;
  handleToggleHighlightSelect: (
    highlight: TranscriptHighlight,
    checked: boolean
  ) => void;
  hasSummaryResult: boolean;
  hasTranscript: boolean;
  highlightWarningMessage: string | null;
  highlightStatus: TranscriptHighlightStatus;
  highlights: TranscriptHighlight[];
  highlightCutState: Record<string, HighlightClipCutState>;
  isRestoreSettledForCurrentSignature: boolean;
  isCancelling: boolean;
  isGenerating: boolean;
  isHighlightCutting: (highlight: TranscriptHighlight) => boolean;
  orderedSelection: TranscriptHighlight[];
  progressLabel: string;
  progressPercent: number;
  sections: TranscriptSummarySection[];
  selectedHighlights: Set<string>;
  setCombineAspectMode: (mode: HighlightAspectMode) => void;
  setCombineMode: Dispatch<SetStateAction<boolean>>;
  setError: (error: string | null) => void;
  setHighlightAspectModeForHighlight: (
    highlight: TranscriptHighlight,
    mode: HighlightAspectMode
  ) => void;
  showProgressBar: boolean;
  summary: string;
  summaryEstimate: SummaryEstimate | null;
  videoAvailableForHighlights: boolean;
};

export default function useTranscriptSummaryLogic({
  segments,
  summaryEffortLevel,
  summaryLanguage,
  t,
}: UseTranscriptSummaryLogicParams): UseTranscriptSummaryLogicResult {
  const [error, setError] = useState<string | null>(null);

  const originalVideoPath = useVideoStore(state => state.originalPath);
  const sourceAssetIdentity = useVideoStore(state => state.sourceAssetIdentity);
  const sourceUrl = useVideoStore(state => state.sourceUrl);
  const fallbackVideoPath = useSubStore(state => state.sourceVideoPath);
  const fallbackVideoAssetIdentity = useSubStore(
    state => state.sourceVideoAssetIdentity
  );
  const libraryEntryId = useSubStore(state => state.libraryEntryId);

  const highlightsFlow = useTranscriptHighlightsFlow({
    fallbackVideoAssetIdentity,
    fallbackVideoPath,
    libraryEntryId,
    originalVideoPath,
    sourceAssetIdentity,
    sourceUrl,
    setError,
    t,
  });

  const summaryFlow = useTranscriptSummaryFlow({
    fallbackVideoAssetIdentity,
    fallbackVideoPath,
    libraryEntryId,
    originalVideoPath,
    onMergeHighlightUpdates: highlightsFlow.mergeHighlightUpdates,
    onReplaceHighlights: highlightsFlow.replaceHighlights,
    onResetHighlightsState: highlightsFlow.resetHighlightsState,
    segments,
    setError,
    sourceAssetIdentity,
    sourceUrl,
    summaryEffortLevel,
    summaryLanguage,
    t,
  });

  const handleCutHighlightClip = useCallback(
    async (highlight: TranscriptHighlight) => {
      if (!summaryFlow.hasSummaryResult) {
        setError(
          t(
            'summary.summaryRequiredForHighlights',
            'Generate a transcript summary before cutting highlight clips.'
          )
        );
        return;
      }
      await highlightsFlow.handleCutHighlightClip(highlight);
    },
    [highlightsFlow, summaryFlow.hasSummaryResult, t]
  );

  return {
    activeOperationId: summaryFlow.activeOperationId,
    combineAspectMode: highlightsFlow.combineAspectMode,
    combineCutState: highlightsFlow.combineCutState,
    combineMode: highlightsFlow.combineMode,
    copyStatus: summaryFlow.copyStatus,
    downloadStatus: highlightsFlow.downloadStatus,
    error,
    getHighlightAspectMode: highlightsFlow.getHighlightAspectMode,
    getHighlightStateKey: highlightsFlow.getHighlightStateKey,
    handleCancel: summaryFlow.handleCancel,
    handleCopy: summaryFlow.handleCopy,
    handleCutCombined: highlightsFlow.handleCutCombined,
    handleCutHighlightClip,
    handleDownloadCombined: highlightsFlow.handleDownloadCombined,
    handleDownloadHighlight: highlightsFlow.handleDownloadHighlight,
    handleDragStart: highlightsFlow.handleDragStart,
    handleDrop: highlightsFlow.handleDrop,
    handleGenerate: summaryFlow.handleGenerate,
    handleToggleHighlightSelect: highlightsFlow.handleToggleHighlightSelect,
    hasSummaryResult: summaryFlow.hasSummaryResult,
    hasTranscript: summaryFlow.hasTranscript,
    highlightWarningMessage: summaryFlow.highlightWarningMessage,
    highlightStatus: summaryFlow.highlightStatus,
    highlights: highlightsFlow.highlights,
    highlightCutState: highlightsFlow.highlightCutState,
    isRestoreSettledForCurrentSignature:
      summaryFlow.isRestoreSettledForCurrentSignature,
    isCancelling: summaryFlow.isCancelling,
    isGenerating: summaryFlow.isGenerating,
    isHighlightCutting: highlightsFlow.isHighlightCutting,
    orderedSelection: highlightsFlow.orderedSelection,
    progressLabel: summaryFlow.progressLabel,
    progressPercent: summaryFlow.progressPercent,
    sections: summaryFlow.sections,
    selectedHighlights: highlightsFlow.selectedHighlights,
    setCombineAspectMode: highlightsFlow.setCombineAspectMode,
    setCombineMode: highlightsFlow.setCombineMode,
    setError,
    setHighlightAspectModeForHighlight:
      highlightsFlow.setHighlightAspectModeForHighlight,
    showProgressBar: summaryFlow.showProgressBar,
    summary: summaryFlow.summary,
    summaryEstimate: summaryFlow.summaryEstimate,
    videoAvailableForHighlights: highlightsFlow.videoAvailableForHighlights,
  };
}
