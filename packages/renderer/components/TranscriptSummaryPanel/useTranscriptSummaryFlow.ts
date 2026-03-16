import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
  TranscriptHighlightStatus,
  TranscriptSummarySection,
} from '@shared-types/app';
import { ERROR_CODES } from '../../../shared/constants';
import { useAiStore, useCreditStore, useTaskStore } from '../../state';
import { isSummaryByo } from '../../state/byo-runtime';
import {
  generateTranscriptSummary,
  onTranscriptSummaryProgress,
} from '../../ipc/subtitles';
import {
  findStoredTranscriptAnalysis,
  saveStoredTranscriptAnalysis,
} from '../../ipc/transcript-analysis';
import * as OperationIPC from '../../ipc/operation';
import { getByoErrorMessage, isByoError } from '../../utils/byoErrors';
import {
  estimateSummaryCredits,
  translateStageLabel,
} from './TranscriptSummaryPanel.helpers';
import type { SummaryEstimate } from './TranscriptSummaryLogic.types';

type UseTranscriptSummaryFlowParams = {
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  libraryEntryId: string | null;
  originalVideoPath: string | null;
  onMergeHighlightUpdates: (incoming?: TranscriptHighlight[] | null) => void;
  onReplaceHighlights: (incoming?: TranscriptHighlight[] | null) => void;
  onResetHighlightsState: () => void;
  segments: SrtSegment[];
  setError: Dispatch<SetStateAction<string | null>>;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
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
  highlightWarningMessage: string | null;
  highlightStatus: TranscriptHighlightStatus;
  isCancelling: boolean;
  isGenerating: boolean;
  progressLabel: string;
  progressPercent: number;
  sections: TranscriptSummarySection[];
  showProgressBar: boolean;
  summary: string;
  summaryEstimate: SummaryEstimate | null;
};

type SummaryInputSegment = {
  start: number;
  end: number;
  text: string;
};

type ActiveSummaryRun = {
  operationId: string;
  settled: Promise<void>;
};

function normalizeSegmentTimestamp(value: number): string {
  if (!Number.isFinite(value)) return '0.000';
  return value.toFixed(3);
}

async function buildTranscriptHash(
  segments: SummaryInputSegment[]
): Promise<string> {
  const canonical = segments
    .map(
      segment =>
        `${normalizeSegmentTimestamp(segment.start)}\t${normalizeSegmentTimestamp(segment.end)}\t${segment.text}`
    )
    .join('\n');
  if (!window.crypto?.subtle) {
    throw new Error('Secure transcript hashing unavailable');
  }
  const encoded = new TextEncoder().encode(canonical);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function buildRestoreLookupKey({
  transcriptHash,
  summaryLanguage,
  effortLevel,
}: {
  transcriptHash: string;
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
}): string {
  return `${transcriptHash}|${summaryLanguage.toLowerCase()}|${effortLevel}`;
}

function buildInputSignature({
  segments,
  summaryLanguage,
  effortLevel,
}: {
  segments: SummaryInputSegment[];
  summaryLanguage: string;
  effortLevel: SummaryEffortLevel;
}): string {
  const canonicalTranscript = segments
    .map(
      segment =>
        `${normalizeSegmentTimestamp(segment.start)}\t${normalizeSegmentTimestamp(segment.end)}\t${segment.text}`
    )
    .join('\n');
  return `${summaryLanguage.toLowerCase()}|${effortLevel}|${canonicalTranscript}`;
}

function normalizeSourcePathSignature(
  value: string | null | undefined
): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function normalizeSourceValueSignature(
  value: string | null | undefined
): string {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function buildSemanticSummarySourceIdentity({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  originalVideoPath,
  sourceAssetIdentity,
  sourceUrl,
}: {
  fallbackVideoAssetIdentity: string | null;
  fallbackVideoPath: string | null;
  originalVideoPath: string | null;
  sourceAssetIdentity: string | null;
  sourceUrl: string | null;
}): string {
  const sourceAsset = normalizeSourceValueSignature(sourceAssetIdentity);
  if (sourceAsset) return `asset:${sourceAsset}`;
  const original = normalizeSourcePathSignature(originalVideoPath);
  if (original) return `original:${original}`;
  const normalizedUrl = normalizeSourceValueSignature(sourceUrl);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const fallbackAsset = normalizeSourceValueSignature(
    fallbackVideoAssetIdentity
  );
  if (fallbackAsset) return `fallback-asset:${fallbackAsset}`;
  const fallback = normalizeSourcePathSignature(fallbackVideoPath);
  if (fallback) return `fallback:${fallback}`;
  return 'none';
}

function buildSummaryRequestSignature({
  inputSignature,
  semanticSourceIdentity,
}: {
  inputSignature: string;
  semanticSourceIdentity: string;
}): string {
  return `${inputSignature}|${semanticSourceIdentity}`;
}

function buildRestorePreferenceSignature({
  inputSignature,
  originalVideoPath,
  fallbackVideoPath,
  sourceUrl,
  libraryEntryId,
}: {
  inputSignature: string;
  originalVideoPath: string | null;
  fallbackVideoPath: string | null;
  sourceUrl: string | null;
  libraryEntryId: string | null;
}): string {
  const original = normalizeSourcePathSignature(originalVideoPath);
  const fallback = normalizeSourcePathSignature(fallbackVideoPath);
  const normalizedUrl = normalizeSourceValueSignature(sourceUrl);
  const normalizedLibraryId = normalizeSourceValueSignature(libraryEntryId);
  return `${inputSignature}|${original}|${fallback}|${normalizedUrl}|${normalizedLibraryId}`;
}

function sanitizeHighlightsForStorage(
  highlights: TranscriptHighlight[] | null | undefined
): TranscriptHighlight[] {
  if (!Array.isArray(highlights)) return [];
  return highlights
    .map(highlight => {
      const { videoPath: _videoPath, ...rest } = highlight;
      return rest;
    })
    .filter(
      highlight =>
        Number.isFinite(highlight.start) &&
        Number.isFinite(highlight.end) &&
        highlight.end > highlight.start
    );
}

function normalizeHighlightStatus(status: unknown): TranscriptHighlightStatus {
  if (status === 'degraded') return 'degraded';
  if (status === 'not_requested') return 'not_requested';
  return 'complete';
}

export default function useTranscriptSummaryFlow({
  fallbackVideoAssetIdentity,
  fallbackVideoPath,
  libraryEntryId,
  originalVideoPath,
  onMergeHighlightUpdates,
  onReplaceHighlights,
  onResetHighlightsState,
  segments,
  setError,
  sourceAssetIdentity,
  sourceUrl,
  summaryEffortLevel,
  summaryLanguage,
  t,
}: UseTranscriptSummaryFlowParams): UseTranscriptSummaryFlowResult {
  const [summary, setSummary] = useState<string>('');
  const [sections, setSections] = useState<TranscriptSummarySection[]>([]);
  const [highlightStatus, setHighlightStatus] =
    useState<TranscriptHighlightStatus>('not_requested');
  const [highlightWarningMessage, setHighlightWarningMessage] = useState<
    string | null
  >(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(
    null
  );
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
  const [persistCompletionTick, setPersistCompletionTick] = useState(0);

  const restoreKeyRef = useRef<string | null>(null);
  const runEpochRef = useRef(0);
  const activeOperationIdRef = useRef<string | null>(null);
  const activeRunRef = useRef<ActiveSummaryRun | null>(null);
  const activeRunRequestSignatureRef = useRef<string | null>(null);
  const latestGenerateRequestSignatureRef = useRef<string>('');
  const pendingRestoreRetryRef = useRef(false);
  const preserveErrorOnRestoreRef = useRef(false);
  const previousGenerateRequestSignatureRef = useRef<string | null>(null);
  const pendingTeardownRef = useRef<Promise<void> | null>(null);
  const pendingPersistByLookupKeyRef = useRef<Map<string, number>>(new Map());

  const beginRunEpoch = useCallback(() => {
    runEpochRef.current += 1;
    return runEpochRef.current;
  }, []);

  const isRunEpochActive = useCallback((epoch: number) => {
    return runEpochRef.current === epoch;
  }, []);

  const invalidateSummaryRun = useCallback(
    ({ cancelActiveOperation }: { cancelActiveOperation: boolean }): number => {
      const activeRun = activeRunRef.current;
      const currentOperationId =
        activeRun?.operationId ?? activeOperationIdRef.current;

      const nextEpoch = beginRunEpoch();
      const operationIdToCancel = currentOperationId;

      setIsGenerating(false);
      setIsCancelling(false);
      activeOperationIdRef.current = null;
      activeRunRequestSignatureRef.current = null;
      setActiveOperationId(null);
      setSummary('');
      setSections([]);
      setHighlightStatus('not_requested');
      setHighlightWarningMessage(null);
      setCopyStatus('idle');
      setProgressLabel('');
      setProgressPercent(0);
      setError(null);
      onResetHighlightsState();
      useTaskStore.getState().setSummary({
        id: null,
        stage: '',
        percent: 0,
        inProgress: false,
      });

      if (
        cancelActiveOperation &&
        operationIdToCancel &&
        !pendingTeardownRef.current
      ) {
        const settledPromise =
          activeRun?.operationId === operationIdToCancel
            ? activeRun.settled
            : Promise.resolve();

        const teardownPromise = (async () => {
          try {
            await OperationIPC.cancel(operationIdToCancel);
          } catch (cancelError) {
            console.warn(
              '[TranscriptSummaryPanel] failed to cancel stale summary operation',
              cancelError
            );
          }
          try {
            await settledPromise;
          } catch {
            // Ignore errors while waiting for stale run teardown.
          }
        })().finally(() => {
          pendingTeardownRef.current = null;
        });
        pendingTeardownRef.current = teardownPromise;
      }

      return nextEpoch;
    },
    [beginRunEpoch, onResetHighlightsState, setError]
  );

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

  const hasTranscript = usableSegments.length > 0;
  const hasSummaryResult = useMemo(
    () => summary.trim().length > 0 || sections.length > 0,
    [summary, sections]
  );
  const inputSignature = useMemo(
    () =>
      buildInputSignature({
        segments: usableSegments,
        summaryLanguage,
        effortLevel: summaryEffortLevel,
      }),
    [summaryEffortLevel, summaryLanguage, usableSegments]
  );
  const semanticSourceIdentity = useMemo(
    () =>
      buildSemanticSummarySourceIdentity({
        fallbackVideoAssetIdentity,
        originalVideoPath,
        fallbackVideoPath,
        sourceAssetIdentity,
        sourceUrl,
      }),
    [
      fallbackVideoAssetIdentity,
      fallbackVideoPath,
      originalVideoPath,
      sourceAssetIdentity,
      sourceUrl,
    ]
  );
  const summaryRequestSignature = useMemo(
    () =>
      buildSummaryRequestSignature({
        inputSignature,
        semanticSourceIdentity,
      }),
    [inputSignature, semanticSourceIdentity]
  );
  const restorePreferenceSignature = useMemo(
    () =>
      buildRestorePreferenceSignature({
        inputSignature,
        originalVideoPath,
        fallbackVideoPath,
        sourceUrl,
        libraryEntryId,
      }),
    [
      fallbackVideoPath,
      inputSignature,
      libraryEntryId,
      originalVideoPath,
      sourceUrl,
    ]
  );
  latestGenerateRequestSignatureRef.current = summaryRequestSignature;

  const credits = useCreditStore(state => state.credits);
  const useApiKeysMode = useAiStore(state => state.useApiKeysMode);
  const byoUnlocked = useAiStore(state => state.byoUnlocked);
  const byoAnthropicUnlocked = useAiStore(state => state.byoAnthropicUnlocked);
  const useByo = useAiStore(state => state.useByo);
  const useByoAnthropic = useAiStore(state => state.useByoAnthropic);
  const keyPresent = useAiStore(state => state.keyPresent);
  const anthropicKeyPresent = useAiStore(state => state.anthropicKeyPresent);
  const preferClaudeSummary = useAiStore(state => state.preferClaudeSummary);
  const summaryByoState = useMemo(
    () => ({
      useApiKeysMode,
      byoUnlocked,
      byoAnthropicUnlocked,
      useByo,
      useByoAnthropic,
      keyPresent,
      anthropicKeyPresent,
      preferClaudeSummary,
    }),
    [
      useApiKeysMode,
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
      const currentOperationId = activeOperationIdRef.current;
      if (!currentOperationId || progress.operationId !== currentOperationId) {
        return;
      }
      const activeRunRequestSignature = activeRunRequestSignatureRef.current;
      if (
        !activeRunRequestSignature ||
        latestGenerateRequestSignatureRef.current !== activeRunRequestSignature
      ) {
        return;
      }

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
        id: currentOperationId,
        stage: nextLabel,
        percent: pct,
        inProgress: pct < 100,
      });

      if (progress.error) {
        const message = String(progress.error);
        const stageText = String(progress.stage || '').toLowerCase();
        const highlightStage =
          stageText.includes('highlight') || stageText.includes('punchline');

        if (highlightStage) {
          if (message === ERROR_CODES.INSUFFICIENT_CREDITS) {
            useCreditStore
              .getState()
              .refresh()
              .catch(() => void 0);
            setHighlightWarningMessage(
              t(
                'summary.highlightsInsufficientCredits',
                'Summary generated, but highlight extraction stopped because credits ran out.'
              )
            );
          } else if (isByoError(message)) {
            setHighlightWarningMessage(getByoErrorMessage(message));
          } else {
            setHighlightWarningMessage(
              t('summary.highlightsPartialWithReason', {
                defaultValue:
                  'Summary generated, but highlight extraction was partial: {{message}}',
                message,
              })
            );
          }
        } else if (message === ERROR_CODES.INSUFFICIENT_CREDITS) {
          setError(t('summary.insufficientCredits'));
          useCreditStore
            .getState()
            .refresh()
            .catch(() => void 0);
        } else if (isByoError(message)) {
          setError(getByoErrorMessage(message));
        } else {
          setError(t('summary.error', { message }));
        }
      }

      if (pct >= 100) {
        useTaskStore.getState().setSummary({
          stage: t('summary.status.ready'),
          percent: 100,
          inProgress: false,
          id: currentOperationId,
        });
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [activeOperationId, onMergeHighlightUpdates, setError, t]);

  const handleGenerate = useCallback(async () => {
    const requestedGenerateRequestSignature = summaryRequestSignature;
    const pendingTeardown = pendingTeardownRef.current;
    if (pendingTeardown) {
      try {
        await pendingTeardown;
      } catch {
        // Ignore stale teardown errors and continue with fresh generation.
      }
    }
    if (
      latestGenerateRequestSignatureRef.current !==
      requestedGenerateRequestSignature
    ) {
      return;
    }

    if (!hasTranscript) return;

    const requestedSegments = usableSegments.map(segment => ({ ...segment }));
    const requestedSummaryLanguage = summaryLanguage;
    const requestedEffortLevel = summaryEffortLevel;
    const requestedVideoPath = originalVideoPath || fallbackVideoPath || null;
    const requestedSourceUrl = sourceUrl;
    const requestedLibraryEntryId = libraryEntryId;

    const operationId = `summary-${Date.now()}`;

    const started = useTaskStore
      .getState()
      .tryStartSummary(operationId, t('summary.status.preparing'));
    if (!started) return;

    const runEpoch = beginRunEpoch();
    setIsGenerating(true);
    activeOperationIdRef.current = operationId;
    activeRunRequestSignatureRef.current = requestedGenerateRequestSignature;
    setActiveOperationId(operationId);
    setError(null);
    setHighlightWarningMessage(null);
    preserveErrorOnRestoreRef.current = false;
    pendingRestoreRetryRef.current = true;
    restoreKeyRef.current = null;
    onResetHighlightsState();
    setSummary('');
    setSections([]);
    setHighlightStatus('not_requested');
    setCopyStatus('idle');
    setProgressLabel(t('summary.status.preparing'));
    setProgressPercent(0);

    try {
      if (!isRunEpochActive(runEpoch)) return;

      const summaryPromise = generateTranscriptSummary({
        segments: requestedSegments,
        targetLanguage: requestedSummaryLanguage,
        operationId,
        videoPath: requestedVideoPath,
        includeHighlights: true,
        effortLevel: requestedEffortLevel,
      });
      activeRunRef.current = {
        operationId,
        settled: summaryPromise.then(
          () => undefined,
          () => undefined
        ),
      };
      const transcriptHashPromise = buildTranscriptHash(
        requestedSegments
      ).catch(hashError => {
        console.error(
          '[TranscriptSummaryPanel] failed to build transcript hash for persistence',
          hashError
        );
        return '';
      });

      const result = await summaryPromise;

      if (!isRunEpochActive(runEpoch)) return;
      if (
        latestGenerateRequestSignatureRef.current !==
        requestedGenerateRequestSignature
      ) {
        return;
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result?.cancelled || result?.success === false) {
        preserveErrorOnRestoreRef.current = false;
        pendingRestoreRetryRef.current = true;
        restoreKeyRef.current = null;
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

      const persistedSections = Array.isArray(result?.sections)
        ? (result.sections as TranscriptSummarySection[])
        : [];
      const generatedHighlights = sanitizeHighlightsForStorage(
        result?.highlights
      );

      const transcriptHash = await transcriptHashPromise;
      if (!isRunEpochActive(runEpoch)) return;
      if (
        latestGenerateRequestSignatureRef.current !==
        requestedGenerateRequestSignature
      ) {
        return;
      }

      const rawHighlightStatus = normalizeHighlightStatus(
        result?.highlightStatus
      );
      let displayHighlights = generatedHighlights;
      let persistedHighlights = generatedHighlights;
      let persistedHighlightStatus: TranscriptHighlightStatus =
        rawHighlightStatus;
      let displayHighlightStatus: TranscriptHighlightStatus =
        rawHighlightStatus;
      if (rawHighlightStatus === 'degraded') {
        try {
          if (transcriptHash) {
            const existingStored = await findStoredTranscriptAnalysis({
              transcriptHash,
              summaryLanguage: requestedSummaryLanguage,
              effortLevel: requestedEffortLevel,
              sourceVideoPath: requestedVideoPath,
              sourceUrl: requestedSourceUrl,
              libraryEntryId: requestedLibraryEntryId,
            });
            if (!isRunEpochActive(runEpoch)) return;
            if (
              latestGenerateRequestSignatureRef.current !==
              requestedGenerateRequestSignature
            ) {
              return;
            }
            const existingAnalysis = existingStored?.analysis;
            const existingHighlightStatus = existingAnalysis
              ? normalizeHighlightStatus(existingAnalysis.highlightStatus)
              : null;
            const existingHighlights =
              existingHighlightStatus === 'complete'
                ? sanitizeHighlightsForStorage(existingAnalysis.highlights)
                : [];
            if (existingHighlightStatus === 'complete') {
              displayHighlights = existingHighlights;
              persistedHighlights = existingHighlights;
              displayHighlightStatus = 'complete';
              persistedHighlightStatus = 'complete';
            }
          }
        } catch (existingLookupError) {
          console.error(
            '[TranscriptSummaryPanel] failed to load existing highlights for degraded summary',
            existingLookupError
          );
        }
      }

      setHighlightStatus(displayHighlightStatus);
      onReplaceHighlights(displayHighlights);
      setError(null);
      if (displayHighlightStatus === 'complete') {
        setHighlightWarningMessage(null);
      }
      preserveErrorOnRestoreRef.current = false;
      pendingRestoreRetryRef.current = false;

      if (transcriptHash) {
        const restoreLookupKey = buildRestoreLookupKey({
          transcriptHash,
          summaryLanguage: requestedSummaryLanguage,
          effortLevel: requestedEffortLevel,
        });
        restoreKeyRef.current = restoreLookupKey;
        const pendingPersistCounts = pendingPersistByLookupKeyRef.current;
        pendingPersistCounts.set(
          restoreLookupKey,
          (pendingPersistCounts.get(restoreLookupKey) || 0) + 1
        );
        void saveStoredTranscriptAnalysis({
          transcriptHash,
          summaryLanguage: requestedSummaryLanguage,
          effortLevel: requestedEffortLevel,
          summary: result?.summary ?? '',
          sections: persistedSections,
          highlights: persistedHighlights,
          highlightStatus: persistedHighlightStatus,
          sourceVideoPath: requestedVideoPath,
          sourceUrl: requestedSourceUrl,
          libraryEntryId: requestedLibraryEntryId,
        })
          .catch(storeError => {
            console.error(
              '[TranscriptSummaryPanel] failed to persist transcript analysis',
              storeError
            );
          })
          .finally(() => {
            const currentCount =
              pendingPersistCounts.get(restoreLookupKey) || 0;
            if (currentCount <= 1) {
              pendingPersistCounts.delete(restoreLookupKey);
            } else {
              pendingPersistCounts.set(restoreLookupKey, currentCount - 1);
            }
            setPersistCompletionTick(previous => previous + 1);
          });
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
      if (!isRunEpochActive(runEpoch)) return;
      preserveErrorOnRestoreRef.current = true;
      pendingRestoreRetryRef.current = true;
      restoreKeyRef.current = null;
      const message = String(err?.message || err);
      const friendlyMessage = isByoError(message)
        ? getByoErrorMessage(message)
        : message === ERROR_CODES.INSUFFICIENT_CREDITS
          ? t('summary.insufficientCredits')
          : t('summary.error', { message });
      setError(friendlyMessage);
      setHighlightWarningMessage(null);
      setProgressLabel(friendlyMessage);
      useTaskStore.getState().setSummary({
        stage: friendlyMessage,
        percent: progressPercent,
        inProgress: false,
        id: null,
      });
    } finally {
      if (activeRunRef.current?.operationId === operationId) {
        activeRunRef.current = null;
      }
      if (isRunEpochActive(runEpoch)) {
        setIsGenerating(false);
        setIsCancelling(false);
        activeOperationIdRef.current = null;
        activeRunRequestSignatureRef.current = null;
        setActiveOperationId(null);
        setCopyStatus('idle');
      }
    }
  }, [
    beginRunEpoch,
    fallbackVideoPath,
    hasTranscript,
    isRunEpochActive,
    libraryEntryId,
    onReplaceHighlights,
    onResetHighlightsState,
    originalVideoPath,
    progressPercent,
    setError,
    sourceUrl,
    summaryEffortLevel,
    summaryLanguage,
    t,
    summaryRequestSignature,
    usableSegments,
  ]);

  const handleCancel = useCallback(async () => {
    const operationIdToCancel =
      activeOperationId ?? activeOperationIdRef.current;
    if (!operationIdToCancel) {
      console.warn(
        '[TranscriptSummaryPanel] no operation id – nothing to cancel'
      );
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
      await OperationIPC.cancel(operationIdToCancel);
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

  useLayoutEffect(() => {
    const previousGenerateRequestSignature =
      previousGenerateRequestSignatureRef.current;
    previousGenerateRequestSignatureRef.current = summaryRequestSignature;

    if (
      previousGenerateRequestSignature == null ||
      previousGenerateRequestSignature === summaryRequestSignature
    ) {
      return;
    }

    preserveErrorOnRestoreRef.current = false;
    pendingRestoreRetryRef.current = false;
    restoreKeyRef.current = null;
    invalidateSummaryRun({ cancelActiveOperation: true });
  }, [summaryRequestSignature, invalidateSummaryRun]);

  useEffect(() => {
    if (!hasTranscript) {
      preserveErrorOnRestoreRef.current = false;
      pendingRestoreRetryRef.current = false;
      return;
    }

    if (activeOperationId) {
      pendingRestoreRetryRef.current = true;
      return;
    }

    if (!pendingRestoreRetryRef.current && hasSummaryResult) {
      return;
    }

    let disposed = false;
    const restoreRequestSignature = summaryRequestSignature;

    const restore = async () => {
      try {
        const transcriptHash = await buildTranscriptHash(usableSegments);
        if (disposed) return;
        if (
          latestGenerateRequestSignatureRef.current !== restoreRequestSignature
        ) {
          return;
        }
        if (activeOperationIdRef.current) {
          pendingRestoreRetryRef.current = true;
          return;
        }

        if (!transcriptHash) {
          preserveErrorOnRestoreRef.current = false;
          pendingRestoreRetryRef.current = false;
          restoreKeyRef.current = null;
          return;
        }

        const restoreLookupKey = buildRestoreLookupKey({
          transcriptHash,
          summaryLanguage,
          effortLevel: summaryEffortLevel,
        });
        if (restoreKeyRef.current === restoreLookupKey && hasSummaryResult) {
          preserveErrorOnRestoreRef.current = false;
          pendingRestoreRetryRef.current = false;
          return;
        }

        restoreKeyRef.current = restoreLookupKey;

        const result = await findStoredTranscriptAnalysis({
          transcriptHash,
          summaryLanguage,
          effortLevel: summaryEffortLevel,
          sourceVideoPath: originalVideoPath || fallbackVideoPath || null,
          sourceUrl,
          libraryEntryId,
        });

        if (disposed) return;
        if (
          latestGenerateRequestSignatureRef.current !== restoreRequestSignature
        ) {
          return;
        }
        if (activeOperationIdRef.current) {
          pendingRestoreRetryRef.current = true;
          restoreKeyRef.current = null;
          return;
        }
        if (!result?.success || !result.analysis) {
          const pendingPersistCount =
            pendingPersistByLookupKeyRef.current.get(restoreLookupKey) || 0;
          preserveErrorOnRestoreRef.current = false;
          pendingRestoreRetryRef.current = pendingPersistCount > 0;
          restoreKeyRef.current = null;
          return;
        }

        const restoredSummary = String(result.analysis.summary || '').trim();
        const restoredSections = Array.isArray(result.analysis.sections)
          ? (result.analysis.sections as TranscriptSummarySection[])
          : [];
        const restoredHighlightStatus = normalizeHighlightStatus(
          result.analysis.highlightStatus
        );
        const restoredHighlights =
          restoredHighlightStatus === 'not_requested'
            ? []
            : sanitizeHighlightsForStorage(result.analysis.highlights);

        setSummary(restoredSummary);
        setSections(restoredSections);
        setHighlightStatus(restoredHighlightStatus);
        onReplaceHighlights(restoredHighlights);
        if (!preserveErrorOnRestoreRef.current) {
          setError(null);
        }
        setHighlightWarningMessage(null);
        preserveErrorOnRestoreRef.current = false;
        pendingRestoreRetryRef.current = false;
      } catch (restoreError) {
        if (disposed) return;
        if (
          latestGenerateRequestSignatureRef.current !== restoreRequestSignature
        ) {
          return;
        }
        preserveErrorOnRestoreRef.current = false;
        pendingRestoreRetryRef.current = false;
        restoreKeyRef.current = null;
        console.error(
          '[TranscriptSummaryPanel] failed to restore transcript analysis',
          restoreError
        );
      }
    };

    void restore();
    return () => {
      disposed = true;
    };
  }, [
    activeOperationId,
    fallbackVideoPath,
    hasTranscript,
    hasSummaryResult,
    libraryEntryId,
    onReplaceHighlights,
    originalVideoPath,
    sourceUrl,
    summaryEffortLevel,
    summaryLanguage,
    setError,
    persistCompletionTick,
    restorePreferenceSignature,
    summaryRequestSignature,
    usableSegments,
  ]);

  const showProgressBar = isGenerating || activeOperationId !== null;

  return {
    activeOperationId,
    copyStatus,
    handleCancel,
    handleCopy,
    handleGenerate,
    hasSummaryResult,
    hasTranscript,
    highlightWarningMessage,
    highlightStatus,
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
