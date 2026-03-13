import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { TFunction } from 'i18next';
import type {
  SrtSegment,
  SummaryEffortLevel,
  TranscriptHighlight,
  TranscriptSummarySection,
} from '@shared-types/app';
import { ERROR_CODES } from '../../../shared/constants';
import { useAiStore, useCreditStore, useTaskStore } from '../../state';
import { isSummaryByo } from '../../state/byo-runtime';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
} from '../../ipc/subtitles';
import * as OperationIPC from '../../ipc/operation';
import { getByoErrorMessage, isByoError } from '../../utils/byoErrors';
import {
  estimateSummaryCredits,
  translateStageLabel,
} from './TranscriptSummaryPanel.helpers';
import type { SummaryEstimate } from './TranscriptSummaryLogic.types';

type UseTranscriptSummaryFlowParams = {
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  onMergeHighlightUpdates: (incoming?: TranscriptHighlight[] | null) => void;
  onResetHighlightsState: () => void;
  segments: SrtSegment[];
  setError: Dispatch<SetStateAction<string | null>>;
  summaryEffortLevel: SummaryEffortLevel;
  summaryLanguage: string;
  t: TFunction;
};

type UseTranscriptSummaryFlowResult = {
  activeOperationId: string | null;
  copyStatus: 'idle' | 'copied';
  handleCancel: () => Promise<void>;
  handleCopy: () => Promise<void>;
  handleGenerate: () => Promise<void>;
  hasSummaryResult: boolean;
  hasTranscript: boolean;
  isCancelling: boolean;
  isGenerating: boolean;
  progressLabel: string;
  progressPercent: number;
  sections: TranscriptSummarySection[];
  showProgressBar: boolean;
  summary: string;
  summaryEstimate: SummaryEstimate | null;
};

export default function useTranscriptSummaryFlow({
  fallbackVideoPath,
  originalVideoPath,
  onMergeHighlightUpdates,
  onResetHighlightsState,
  segments,
  setError,
  summaryEffortLevel,
  summaryLanguage,
  t,
}: UseTranscriptSummaryFlowParams): UseTranscriptSummaryFlowResult {
  const [summary, setSummary] = useState<string>('');
  const [sections, setSections] = useState<TranscriptSummarySection[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(
    null
  );
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');

  const transcriptFingerprintRef = useRef<string | null>(null);

  const usableSegments = useMemo(
    () =>
      segments
        .map(segment => ({
          start: segment.start,
          end: segment.end,
          text: (segment.original ?? '').trim(),
        }))
        .filter(segment => segment.text.length > 0),
    [segments]
  );

  const transcriptFingerprint = useMemo(() => {
    if (!segments.length) return 'empty';
    let hash = 0;
    const sampleStep = Math.max(1, Math.floor(segments.length / 25));
    for (let index = 0; index < segments.length; index += sampleStep) {
      const segment = segments[index];
      const start = Number.isFinite(segment.start)
        ? Math.round(segment.start * 1000)
        : 0;
      const end = Number.isFinite(segment.end)
        ? Math.round(segment.end * 1000)
        : start;
      const textLength = (segment.original ?? '').length;
      hash = (hash * 31 + start) | 0;
      hash = (hash * 31 + end) | 0;
      hash = (hash * 31 + textLength) | 0;
    }
    return `${segments.length}:${hash}`;
  }, [segments]);

  const hasTranscript = usableSegments.length > 0;
  const hasSummaryResult = useMemo(
    () => summary.trim().length > 0 || sections.length > 0,
    [summary, sections]
  );

  const credits = useCreditStore(state => state.credits);
  const useStrictByoMode = useAiStore(state => state.useStrictByoMode);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const useByo = useAiStore(state => state.useByo);
  const useByoAnthropic = useAiStore(state => state.useByoAnthropic);
  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const preferClaudeSummary = useAiStore(state => state.preferClaudeSummary);
  const summaryByoState = useMemo(
    () => ({
      useStrictByoMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      useByo,
      useByoAnthropic,
      keyPresent,
      anthropicKeyPresent,
      preferClaudeSummary,
    }),
    [
      useStrictByoMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      useByo,
      useByoAnthropic,
      keyPresent,
      anthropicKeyPresent,
      preferClaudeSummary,
    ]
  );

  const summaryEstimate = useMemo<SummaryEstimate | null>(() => {
    if (!hasTranscript) return null;
    const charCount = usableSegments.reduce(
      (accumulator, segment) => accumulator + segment.text.length,
      0
    );
    if (charCount === 0) return null;

    const isByo = isSummaryByo(summaryByoState);
    const estimatedCredits = estimateSummaryCredits(
      charCount,
      summaryEffortLevel
    );

    return {
      charCount,
      estimatedCredits,
      isByo,
      hasEnoughCredits: isByo || credits == null || credits >= estimatedCredits,
    };
  }, [
    credits,
    hasTranscript,
    summaryEffortLevel,
    summaryByoState,
    usableSegments,
  ]);

  useEffect(() => {
    if (!activeOperationId) return;

    const unsubscribe = onTranscriptSummaryProgress(progress => {
      if (progress.operationId !== activeOperationId) return;

      const nextLabel = translateStageLabel(progress.stage ?? '', t);
      const pct = typeof progress.percent === 'number' ? progress.percent : 0;
      const clampedPercent = Math.min(100, Math.max(0, pct));
      setProgressLabel(nextLabel);
      setProgressPercent(clampedPercent);

      if (typeof progress.partialSummary === 'string') {
        setSummary(progress.partialSummary.trim());
      }

      if (Array.isArray(progress.partialSections)) {
        setSections(progress.partialSections as TranscriptSummarySection[]);
      }

      if (Array.isArray(progress.partialHighlights)) {
        onMergeHighlightUpdates(
          progress.partialHighlights as TranscriptHighlight[]
        );
      }

      if (progress.partialSummary) {
        setCopyStatus('idle');
      }

      useTaskStore.getState().setSummary({
        id: activeOperationId,
        stage: nextLabel,
        percent: pct,
        inProgress: pct < 100,
      });

      if (progress.error) {
        const message = String(progress.error);
        const stageText = String(progress.stage || '').toLowerCase();
        const highlightStage =
          stageText.includes('highlight') || stageText.includes('punchline');

        if (message === ERROR_CODES.INSUFFICIENT_CREDITS) {
          setError(t('summary.insufficientCredits'));
          useCreditStore
            .getState()
            .refresh()
            .catch(() => void 0);
        } else if (isByoError(message)) {
          setError(getByoErrorMessage(message));
        } else if (highlightStage) {
          setError(
            t('summary.highlightsSelectionFailed', {
              message,
              defaultValue: 'Failed to select highlight moments: {{message}}',
            })
          );
        } else {
          setError(t('summary.error', { message }));
        }
      }

      if (pct >= 100) {
        useTaskStore.getState().setSummary({
          stage: t('summary.status.ready'),
          percent: 100,
          inProgress: false,
          id: activeOperationId,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeOperationId, onMergeHighlightUpdates, setError, t]);

  const handleGenerate = useCallback(async () => {
    if (!hasTranscript) return;

    const operationId = `summary-${Date.now()}`;

    const started = useTaskStore
      .getState()
      .tryStartSummary(operationId, t('summary.status.preparing'));
    if (!started) return;

    setIsGenerating(true);
    setActiveOperationId(operationId);
    setError(null);
    onResetHighlightsState();
    setSummary('');
    setSections([]);
    setCopyStatus('idle');
    setProgressLabel(t('summary.status.preparing'));
    setProgressPercent(0);

    try {
      const result = await generateTranscriptSummary({
        segments: usableSegments,
        targetLanguage: summaryLanguage,
        operationId,
        videoPath: originalVideoPath || fallbackVideoPath || null,
        includeHighlights: true,
        effortLevel: summaryEffortLevel,
      });

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.cancelled || result?.success === false) {
        setProgressLabel(t('summary.status.cancelled'));
        setProgressPercent(prev => Math.max(0, prev));
        useTaskStore.getState().setSummary({
          stage: t('summary.status.cancelled'),
          percent: 0,
          inProgress: false,
          id: null,
        });
        return;
      }

      if (result?.summary) {
        setSummary(result.summary.trim());
      }
      if (Array.isArray(result?.sections)) {
        setSections(result.sections as TranscriptSummarySection[]);
      }
      if (Array.isArray(result?.highlights)) {
        onMergeHighlightUpdates(result.highlights as TranscriptHighlight[]);
      }

      setProgressLabel(t('summary.status.ready'));
      setProgressPercent(100);
      useTaskStore.getState().setSummary({
        stage: t('summary.status.ready'),
        percent: 100,
        inProgress: false,
        id: null,
      });
    } catch (err: any) {
      const message = String(err?.message || err);
      const friendlyMessage = isByoError(message)
        ? getByoErrorMessage(message)
        : message === ERROR_CODES.INSUFFICIENT_CREDITS
          ? t('summary.insufficientCredits')
          : t('summary.error', { message });
      setError(friendlyMessage);
      setProgressLabel(friendlyMessage);
      useTaskStore.getState().setSummary({
        stage: friendlyMessage,
        percent: progressPercent,
        inProgress: false,
        id: null,
      });
    } finally {
      setIsGenerating(false);
      setIsCancelling(false);
      setActiveOperationId(null);
      setCopyStatus('idle');
    }
  }, [
    fallbackVideoPath,
    hasTranscript,
    onMergeHighlightUpdates,
    onResetHighlightsState,
    originalVideoPath,
    progressPercent,
    setError,
    summaryEffortLevel,
    summaryLanguage,
    t,
    usableSegments,
  ]);

  const handleCancel = useCallback(async () => {
    if (!activeOperationId) {
      console.warn(
        '[TranscriptSummaryPanel] no operation id – nothing to cancel'
      );
      setIsGenerating(false);
      return;
    }

    if (
      !window.confirm(
        t('dialogs.cancelSummaryConfirm', 'Cancel summary generation?')
      )
    ) {
      return;
    }

    setIsCancelling(true);

    try {
      await OperationIPC.cancel(activeOperationId);
    } catch (err: any) {
      console.error('[TranscriptSummaryPanel] cancel failed', err);
      alert(
        t('errors.cancelSummaryFailed', {
          defaultValue: 'Failed to cancel summary generation: {{message}}',
          message: err?.message || String(err),
        })
      );
    } finally {
      setIsCancelling(false);
      setIsGenerating(false);
    }
  }, [activeOperationId, t]);

  const handleCopy = useCallback(async () => {
    if (!summary) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(summary);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = summary;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyStatus('copied');
    } catch (err) {
      console.error('[TranscriptSummaryPanel] copy failed', err);
      setCopyStatus('idle');
      setError(t('summary.copyError'));
    }
  }, [setError, summary, t]);

  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = window.setTimeout(() => setCopyStatus('idle'), 2000);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (!summary) {
      setCopyStatus('idle');
    }
  }, [summary]);

  useEffect(() => {
    if (!hasTranscript) {
      transcriptFingerprintRef.current = null;
      setSummary('');
      setSections([]);
      setCopyStatus('idle');
      setProgressLabel('');
      setProgressPercent(0);
      setError(null);
      onResetHighlightsState();
      return;
    }

    if (transcriptFingerprintRef.current === transcriptFingerprint) {
      return;
    }

    transcriptFingerprintRef.current = transcriptFingerprint;
    setSummary('');
    setSections([]);
    setCopyStatus('idle');
    setProgressLabel('');
    setProgressPercent(0);
    setError(null);
    onResetHighlightsState();
  }, [hasTranscript, onResetHighlightsState, setError, transcriptFingerprint]);

  const showProgressBar = isGenerating || activeOperationId !== null;

  return {
    activeOperationId,
    copyStatus,
    handleCancel,
    handleCopy,
    handleGenerate,
    hasSummaryResult,
    hasTranscript,
    isCancelling,
    isGenerating,
    progressLabel,
    progressPercent,
    sections,
    showProgressBar,
    summary,
    summaryEstimate,
  };
}
