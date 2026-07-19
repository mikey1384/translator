import { css } from '@emotion/css';
import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner.js';
import {
  useHighlightGenerationRequestStore,
  useHighlightWorkflowStore,
  useStepTwoWorkflowStore,
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';
import { useUrlStore } from '../../state/url-store';
import UrlCookieBanner from './UrlCookieBanner';
import MediaInputSection, {
  type AutoRunTarget,
} from './components/MediaInputSection.js';
import AutoRunProgress, {
  type AutoRunPhase,
  type AutoRunFailedStep,
} from './components/AutoRunProgress.js';
import HighlightWorkflowProgress from './components/HighlightWorkflowProgress.js';
import TranscribeOnlyPanel from './components/TranscribeOnlyPanel.js';
import SrtMountedPanel from './components/SrtMountedPanel.js';
import TranscriptSummaryPanel from '../../components/TranscriptSummaryPanel/index.js';
import VideoSuggestionPanel from './components/VideoSuggestionPanel/index.js';
import VideoSuggestionChannelsTab from './components/VideoSuggestionPanel/VideoSuggestionChannelsTab.js';
import VideoSuggestionHistoryTab from './components/VideoSuggestionPanel/VideoSuggestionHistoryTab.js';
import { type GenerateSubtitlesWorkspaceTab } from './components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import type {
  ProcessUrlResult,
  SrtSegment,
  StoredSubtitleKind,
  SubtitleDocumentMeta,
  VideoSuggestionResultItem,
} from '@shared-types/app';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';
import useDownloadedVideoLibrary from './hooks/useDownloadedVideoLibrary.js';

// Components

// Utilities
import {
  startTranscriptionFlow,
  executeSrtTranslation,
  executeDubGeneration,
} from './utils/subtitleGeneration';
import {
  ensureSubtitlesTranslatedForDubbing,
  runFullSrtTranslation,
} from '../../utils/runFullTranslation';
import {
  buildSemanticSummarySourceIdentity,
  buildSummaryRequestOwnerKey,
  hasUsableTranscriptSegments,
} from '../../components/TranscriptSummaryPanel/transcript-usable-segments.js';
import { parseSrt } from '../../../shared/helpers';
import { deriveHighlightWorkflowState } from './highlight-workflow-progress.js';
import { translateTranscriptionStageLabel } from '../../components/ProgressAreas/transcription-stage-label.js';
import { translateTranslationStageLabel } from '../../components/ProgressAreas/translation-stage-label.js';
import {
  workflowPanelFlushStyles,
  workflowStageBodyStyles,
  workflowStageEyebrowStyles,
  workflowStageHeaderRowStyles,
  workflowStageHeaderStyles,
  workflowStageShellStyles,
  workflowStageStackStyles,
  workflowStageTitleStyles,
} from '../../components/workflow-surface-styles';
import { colors } from '../../styles.js';
import {
  borderRadius,
  fontWeight,
  spacing,
} from '../../components/design-system/tokens.js';

// Auto-run preferences (how far to chain after download).
const AUTO_RUN_TARGET_KEY = 'autoRunTarget';
const AUTO_RUN_LANGUAGE_KEY = 'autoRunLanguage';
// Legacy phase-1 boolean key, migrated into AUTO_RUN_TARGET_KEY on first load.
const LEGACY_AUTO_RUN_BOOL_KEY = 'autoRunAfterDownload';

function getInitialAutoRunTarget(): AutoRunTarget {
  const stored = localStorage.getItem(AUTO_RUN_TARGET_KEY);
  if (
    stored === 'download' ||
    stored === 'transcribe' ||
    stored === 'translate'
  ) {
    return stored;
  }
  // Migrate the phase-1 on/off toggle: "on" meant download → transcribe → translate.
  if (localStorage.getItem(LEGACY_AUTO_RUN_BOOL_KEY) === '1')
    return 'translate';
  return 'download';
}

const workspaceTabsRowStyles = css`
  display: flex;
  flex-wrap: wrap;
  gap: ${spacing.sm};
`;

const workspaceTabButtonStyles = (active: boolean, disabled = false) => css`
  padding: 0.72rem 1rem;
  border-radius: ${borderRadius.full};
  border: 1px solid ${active ? 'rgba(125, 167, 255, 0.26)' : colors.border};
  background: ${active
    ? 'rgba(125, 167, 255, 0.14)'
    : 'rgba(255, 255, 255, 0.03)'};
  color: ${active ? colors.text : colors.textDim};
  font-weight: ${active ? fontWeight.semibold : fontWeight.medium};
  cursor: ${disabled ? 'not-allowed' : 'pointer'};
  opacity: ${disabled ? 0.52 : 1};
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: ${disabled
      ? active
        ? 'rgba(125, 167, 255, 0.26)'
        : colors.border
      : colors.borderStrong};
    color: ${disabled ? (active ? colors.text : colors.textDim) : colors.text};
  }
`;

type SubtitleDocumentSnapshot = {
  sourceKey: string | null;
  segments: SrtSegment[];
  documentMeta: SubtitleDocumentMeta | null;
  originalPath: string | null;
  activeFilePath: string | null;
  activeFileMode: import('@shared-types/app').SubtitleDisplayMode | null;
  activeFileRole:
    | import('@shared-types/app').SubtitleDocumentLinkedFileRole
    | null;
  origin: 'fresh' | 'disk' | null;
  sourceVideoPath: string | null;
  sourceVideoAssetIdentity: string | null;
  transcriptionEngine: 'elevenlabs' | 'whisper' | null;
  libraryMeta: {
    entryId?: string | null;
    kind?: StoredSubtitleKind | null;
    targetLanguage?: string | null;
  } | null;
};

export default function GenerateSubtitles() {
  const { t, i18n } = useTranslation();
  const activeWorkspaceTab = useUIStore(s => s.generateSubtitlesWorkspaceTab);
  const setActiveWorkspaceTab = useUIStore(
    s => s.setGenerateSubtitlesWorkspaceTab
  );

  // UI State
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);
  const setSummaryLanguage = useUIStore(s => s.setSummaryLanguage);

  // URL processing state
  const urlInput = useUrlStore(s => s.urlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const download = useUrlStore(s => s.download);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const downloadMedia = useUrlStore(s => s.downloadMedia);

  // Video file state
  const videoFile = useVideoStore(s => s.file);
  const videoFilePath = useVideoStore(s => s.path);
  const sourceUrl = useVideoStore(s => s.sourceUrl);
  const sourceAssetIdentity = useVideoStore(s => s.sourceAssetIdentity);
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  const openLocalMedia = useVideoStore(s => s.openLocalMedia);
  const openRecentLocalMedia = useVideoStore(s => s.openRecentLocalMedia);
  const removeRecentLocalMedia = useVideoStore(s => s.removeRecentLocalMedia);
  const refreshRecentLocalMedia = useVideoStore(s => s.refreshRecentLocalMedia);

  // Task state
  const translationInProgress = useTaskStore(s => s.translation.inProgress);
  const translationTask = useTaskStore(s => s.translation);
  const transcriptionTask = useTaskStore(s => s.transcription);
  const summaryTask = useTaskStore(s => s.summary);
  const transcriptionInProgress = transcriptionTask.inProgress;
  const mergeInProgress = useTaskStore(s => s.merge.inProgress);
  const transcriptionId = transcriptionTask.id;
  const transcriptionCompleted = Boolean(transcriptionTask.isCompleted);
  const dubbingInProgress = useTaskStore(s => s.dubbing.inProgress);
  const dubbingId = useTaskStore(s => s.dubbing.id);
  const requestHighlights = useHighlightGenerationRequestStore(
    s => s.requestHighlights
  );
  const pendingHighlightRequests = useHighlightGenerationRequestStore(
    s => s.pendingRequests
  );
  const claimedHighlightRequests = useHighlightGenerationRequestStore(
    s => s.claimedRequests
  );

  // Subtitle state
  const mountedSubtitleOrder = useSubStore(s => s.order);
  const mountedSubtitleSegments = useSubStore(s => s.segments);
  const mountedSubtitleCount = useSubStore(s => s.order.length);
  const mountedSrtPath = useSubStore(s => s.activeFilePath ?? s.originalPath);
  const hasMountedSubtitles = mountedSubtitleCount > 0;
  const summarySegments = useMemo(
    () =>
      mountedSubtitleOrder
        .map(id => mountedSubtitleSegments[id])
        .filter((segment): segment is SrtSegment => Boolean(segment)),
    [mountedSubtitleOrder, mountedSubtitleSegments]
  );
  const hasTranscriptSummaryPanel = summarySegments.length > 0;
  // Decouple transcription completion from subtitle presence
  const isTranscriptionDone = transcriptionCompleted || hasMountedSubtitles;
  const isTranscribing =
    !!transcriptionInProgress &&
    (transcriptionId?.startsWith('transcribe-') ?? false);
  const isTranslating = !!translationInProgress;
  const isDubbing =
    !!dubbingInProgress && (dubbingId?.startsWith('dub-') ?? false);
  const isSourceChangeBlockedBase =
    !!translationInProgress ||
    !!transcriptionInProgress ||
    !!dubbingInProgress ||
    !!mergeInProgress;
  const hasSummaryPanelRequest = useMemo(() => {
    for (const request of Object.values(pendingHighlightRequests)) {
      if (request.source === 'summary-panel') return true;
    }

    for (const request of Object.values(claimedHighlightRequests)) {
      if (request.source === 'summary-panel' && !request.cancelled) return true;
    }

    return false;
  }, [claimedHighlightRequests, pendingHighlightRequests]);
  const hasSourceSelection = Boolean(
    videoFile || videoFilePath || download.inProgress
  );
  // Custom hooks for business logic (after videoFilePath is declared)
  const {
    durationSecs,
    hoursNeeded,
    metadataStatus,
    metadataErrorCode,
    metadataErrorMessage,
    isMetadataPending,
  } = useVideoMetadata(videoFilePath);
  const { isButtonDisabled } = useCreditSystem();

  const metadataStatusMessage =
    metadataErrorCode === 'icloud-placeholder'
      ? t(
          'generateSubtitles.validation.icloudPlaceholder',
          'This file is stored in iCloud. In Finder, click “Download” and wait for the cloud icon to finish, then try again.'
        )
      : metadataStatus === 'fetching' || metadataStatus === 'waiting'
        ? t(
            'generateSubtitles.validation.processingDuration',
            'Video duration is being processed. Please try again shortly.'
          )
        : metadataStatus === 'failed' && metadataErrorMessage
          ? metadataErrorMessage
          : null;
  const downloadedVideoLibrary = useDownloadedVideoLibrary(
    i18n.resolvedLanguage || i18n.language || 'en'
  );
  const startHighlightWorkflow = useHighlightWorkflowStore(
    s => s.startWorkflow
  );
  const setHighlightWorkflowAwaitingSummaryStart = useHighlightWorkflowStore(
    s => s.setAwaitingSummaryStart
  );
  const resetHighlightWorkflowRuntime = useHighlightWorkflowStore(
    s => s.resetRuntime
  );
  const cancelActiveHighlightWorkflow = useHighlightWorkflowStore(
    s => s.cancelActiveWorkflow
  );
  const highlightWorkflowRunning = useHighlightWorkflowStore(s => s.running);
  const highlightWorkflowRequiresTranscription = useHighlightWorkflowStore(
    s => s.requiresTranscription
  );
  const highlightWorkflowTranscriptionOpId = useHighlightWorkflowStore(
    s => s.transcriptionOperationId
  );
  const highlightWorkflowAwaitingSummaryStart = useHighlightWorkflowStore(
    s => s.awaitingSummaryStart
  );
  const isCancellingHighlightWorkflow = useHighlightWorkflowStore(
    s => s.isCancelling
  );
  const highlightWorkflowRequestId = useHighlightWorkflowStore(
    s => s.requestId
  );
  const highlightWorkflowSourceKey = useHighlightWorkflowStore(
    s => s.sourceKey
  );
  const startStepTwoWorkflow = useStepTwoWorkflowStore(s => s.startWorkflow);
  const transitionStepTwoWorkflowToHandoff = useStepTwoWorkflowStore(
    s => s.transitionToHandoff
  );
  const transitionStepTwoWorkflowToRunning = useStepTwoWorkflowStore(
    s => s.transitionToRunning
  );
  const clearStepTwoWorkflow = useStepTwoWorkflowStore(s => s.clearWorkflow);
  const stepTwoWorkflowKind = useStepTwoWorkflowStore(s => s.kind);
  const stepTwoWorkflowPhase = useStepTwoWorkflowStore(s => s.phase);
  const stepTwoWorkflowRunToken = useStepTwoWorkflowStore(s => s.runToken);
  const stepTwoWorkflowTranscriptionOperationId = useStepTwoWorkflowStore(
    s => s.transcriptionOperationId
  );
  const stepTwoWorkflowFollowUpId = useStepTwoWorkflowStore(s => s.followUpId);
  const stepTwoWorkflowSourceKey = useStepTwoWorkflowStore(s => s.sourceKey);
  const stepTwoActionLaunchLockRef = useRef(false);
  const [preTranscriptProcessingLanguage, setPreTranscriptProcessingLanguage] =
    useState(targetLanguage);

  // Auto-run: how far to chain after download, plus the live pipeline session.
  const [autoRunTarget, setAutoRunTargetState] = useState(
    getInitialAutoRunTarget
  );
  const setAutoRunTarget = useCallback((value: AutoRunTarget) => {
    localStorage.setItem(AUTO_RUN_TARGET_KEY, value);
    setAutoRunTargetState(value);
  }, []);
  const [autoRunLanguage, setAutoRunLanguageState] = useState(
    () => localStorage.getItem(AUTO_RUN_LANGUAGE_KEY) || targetLanguage
  );
  const setAutoRunLanguage = useCallback((value: string) => {
    localStorage.setItem(AUTO_RUN_LANGUAGE_KEY, value);
    setAutoRunLanguageState(value);
  }, []);
  // The active pipeline session that drives the AutoRunProgress strip. null when
  // no multi-step auto-run is running (plain download or nothing in flight).
  const [autoRunSession, setAutoRunSession] = useState<{
    target: Exclude<AutoRunTarget, 'download'>;
    phase: AutoRunPhase;
    failedStep?: AutoRunFailedStep;
  } | null>(null);
  // The continuation still owed once the download mounts ('download' = none).
  const pendingAutoRunTargetRef = useRef<AutoRunTarget>('download');
  // The source path the pending auto-run is bound to. Bound (as state, not a ref)
  // only once the download has actually mounted, so (a) the continuation can
  // never fire against the old/unrelated source while the download is in flight
  // and (b) binding it schedules a render, guaranteeing the firing effect re-runs
  // even if the new file's metadata already settled during the download await.
  const [autoRunBoundSource, setAutoRunBoundSource] = useState<string | null>(
    null
  );
  const currentHighlightSourceKey = useMemo(() => {
    if (sourceAssetIdentity) return `asset:${sourceAssetIdentity}`;
    if (sourceUrl) return `url:${sourceUrl}`;
    if (videoFilePath) return `path:${videoFilePath}`;
    if (videoFile) {
      return `file:${videoFile.name}:${videoFile.size}:${videoFile.lastModified}`;
    }
    return '';
  }, [sourceAssetIdentity, sourceUrl, videoFilePath, videoFile]);
  const stepTwoWorkflowActive = stepTwoWorkflowKind !== null;
  const isSourceChangeBlocked =
    isSourceChangeBlockedBase ||
    stepTwoWorkflowActive ||
    highlightWorkflowRunning ||
    summaryTask.inProgress ||
    hasSummaryPanelRequest;
  const isStepTwoMutationLocked =
    stepTwoWorkflowActive ||
    highlightWorkflowRunning ||
    isCancellingHighlightWorkflow;

  useEffect(() => {
    setPreTranscriptProcessingLanguage(targetLanguage);
  }, [targetLanguage]);

  // Once an auto-run download has mounted and its metadata is ready, continue
  // into the chosen stop: transcribe-only, or transcribe → translate. This
  // mirrors clicking the matching button in TranscribeOnlyPanel, unattended.
  useEffect(() => {
    const target = pendingAutoRunTargetRef.current;
    if (target === 'download') return;

    // Only fire against the exact source this download mounted. While the
    // download is still in flight the continuation is unbound (null), so a
    // mid-download metadata/source change on the previously mounted video can
    // never trigger transcription/translation against the wrong file. Binding is
    // state, so it schedules this effect to re-run once the mount completes.
    const boundSource = autoRunBoundSource;
    if (!boundSource) return;
    if ((videoFilePath ?? null) !== boundSource) return;

    // Can't proceed (e.g. iCloud placeholder); disarm so it can't fire later
    // against an unrelated source the user mounts afterwards.
    if (metadataStatus === 'failed') {
      pendingAutoRunTargetRef.current = 'download';
      setAutoRunBoundSource(null);
      // Download mounted but the file's metadata is unreadable (e.g. iCloud
      // placeholder): transcription can't start, so the failure is on transcribe.
      setAutoRunSession(s =>
        s ? { ...s, phase: 'error', failedStep: 'transcribe' } : null
      );
      return;
    }

    const metadataReady = !isMetadataPending && hoursNeeded != null;
    const idle =
      !transcriptionInProgress &&
      !isTranslating &&
      !stepTwoWorkflowActive &&
      !isStepTwoMutationLocked;

    if (metadataReady && idle && !isButtonDisabled) {
      pendingAutoRunTargetRef.current = 'download';
      setAutoRunBoundSource(null);
      setAutoRunSession(s => (s ? { ...s, phase: 'transcribing' } : s));
      // Drive the terminal phase from the operation's actual result rather than
      // from task-completion flags (which mark error stages as "complete" and
      // leave cancellations stuck). The intermediate transcribing → translating
      // animation is handled by the phase-advance effect below.
      const runChain =
        target === 'transcribe'
          ? handleTranscribeOnly
          : handleTranslateFromScratch;
      // On failure, mark the step that was active when it failed (transcribe, or
      // translate once the chain advanced) — never the already-finished download.
      const markError = () =>
        setAutoRunSession(s =>
          s
            ? {
                ...s,
                phase: 'error',
                failedStep:
                  s.phase === 'translating' ? 'translate' : 'transcribe',
              }
            : s
        );
      void runChain().then(
        ok =>
          ok
            ? setAutoRunSession(s => (s ? { ...s, phase: 'done' } : s))
            : markError(),
        () => markError()
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoRunBoundSource,
    videoFile,
    videoFilePath,
    metadataStatus,
    isMetadataPending,
    hoursNeeded,
    transcriptionInProgress,
    isTranslating,
    stepTwoWorkflowActive,
    isStepTwoMutationLocked,
    isButtonDisabled,
  ]);

  // Animate the live pipeline strip forward from transcribing → translating once
  // translation actually begins. Terminal phases (done/error) are set from the
  // operation result by the firing effect above, not inferred from task flags.
  useEffect(() => {
    if (!autoRunSession) return;
    const { target, phase } = autoRunSession;
    if (phase === 'transcribing' && target === 'translate' && isTranslating) {
      setAutoRunSession(s => (s ? { ...s, phase: 'translating' } : null));
    }
  }, [autoRunSession, isTranslating]);

  const workspaceTabs = useMemo(
    () =>
      [
        {
          key: 'main',
          label: t('subtitles.generate', 'Generate Subtitles'),
        },
        {
          key: 'history',
          label: t('input.videoSuggestion.tabHistory', 'Download history'),
        },
        {
          key: 'channels',
          label: t('input.videoSuggestion.tabChannels', 'Channels'),
        },
      ] satisfies Array<{
        key: GenerateSubtitlesWorkspaceTab;
        label: string;
      }>,
    [t]
  );

  const highlightWorkflowSummaryOperationId = useMemo(() => {
    if (highlightWorkflowRequestId == null) return null;
    return (
      claimedHighlightRequests[highlightWorkflowRequestId]
        ?.summaryOperationId ?? null
    );
  }, [claimedHighlightRequests, highlightWorkflowRequestId]);
  const { highlightTranscriptionActive, progress: highlightProgress } = useMemo(
    () =>
      deriveHighlightWorkflowState({
        runtime: {
          running: highlightWorkflowRunning,
          requiresTranscription: highlightWorkflowRequiresTranscription,
          transcriptionOperationId: highlightWorkflowTranscriptionOpId,
          awaitingSummaryStart: highlightWorkflowAwaitingSummaryStart,
        },
        summaryOperationId: highlightWorkflowSummaryOperationId,
        transcriptionTask,
        summaryTask,
        t,
      }),
    [
      highlightWorkflowAwaitingSummaryStart,
      highlightWorkflowRequiresTranscription,
      highlightWorkflowRunning,
      highlightWorkflowSummaryOperationId,
      highlightWorkflowTranscriptionOpId,
      summaryTask,
      t,
      transcriptionTask,
    ]
  );
  const canCreateHighlight =
    !isSourceChangeBlocked &&
    !summaryTask.inProgress &&
    (isTranscriptionDone ||
      (!isMetadataPending &&
        !isButtonDisabled &&
        hoursNeeded != null &&
        hasSourceSelection));
  const isHighlightWorkflowTranscribing =
    highlightWorkflowRunning &&
    highlightWorkflowRequiresTranscription &&
    highlightTranscriptionActive;
  const showMountedTranscriptStep =
    isTranscriptionDone && !isHighlightWorkflowTranscribing;
  const isPreTranscriptTranslateRunning = stepTwoWorkflowKind === 'translate';
  const preTranscriptTranslateProgress = useMemo(() => {
    if (stepTwoWorkflowKind !== 'translate' || !stepTwoWorkflowPhase) {
      return null;
    }

    const transcribeOperationId = stepTwoWorkflowTranscriptionOperationId;
    const translateOperationId =
      typeof stepTwoWorkflowFollowUpId === 'string'
        ? stepTwoWorkflowFollowUpId
        : null;

    const transcribeActive =
      transcriptionTask.inProgress &&
      transcriptionTask.id === transcribeOperationId;

    if (stepTwoWorkflowPhase === 'transcribing' && transcribeActive) {
      const transcribePercent = Math.max(
        0,
        Math.min(100, Number(transcriptionTask.percent) || 0)
      );
      return {
        title: t('subtitles.translate', 'Translate'),
        stage: translateTranscriptionStageLabel(transcriptionTask.stage, t),
        percent: Math.round(transcribePercent * 0.5),
      };
    }

    if (
      stepTwoWorkflowPhase === 'transcribing' ||
      stepTwoWorkflowPhase === 'handoff' ||
      !translateOperationId
    ) {
      return {
        title: t('subtitles.translate', 'Translate'),
        stage: t('generateSubtitles.status.starting'),
        percent: 50,
      };
    }

    const translateActive =
      translationTask.inProgress && translationTask.id === translateOperationId;

    if (stepTwoWorkflowPhase === 'running' && translateActive) {
      const translatePercent = Math.max(
        0,
        Math.min(100, Number(translationTask.percent) || 0)
      );
      return {
        title: t('subtitles.translate', 'Translate'),
        stage: translationTask.stage
          ? translateTranslationStageLabel(translationTask.stage, t)
          : t('generateSubtitles.status.starting'),
        percent: 50 + Math.round(translatePercent * 0.5),
      };
    }

    return {
      title: t('subtitles.translate', 'Translate'),
      stage: t('generateSubtitles.status.completed'),
      percent: 100,
    };
  }, [
    stepTwoWorkflowFollowUpId,
    stepTwoWorkflowKind,
    stepTwoWorkflowPhase,
    stepTwoWorkflowTranscriptionOperationId,
    t,
    transcriptionTask,
    translationTask,
  ]);
  // Recovered highlight runs come from highlightWorkflowStore.reconcileRuntime(),
  // so visibility cannot depend on the newer step-two intent store.
  const shouldShowHighlightWorkflowProgress =
    highlightTranscriptionActive ||
    (highlightWorkflowRunning && highlightWorkflowAwaitingSummaryStart);
  const isWorkspaceTabNavigationLocked =
    highlightWorkflowRunning ||
    summaryTask.inProgress ||
    hasSummaryPanelRequest;

  const requestHighlightWorkflowCancellation = useCallback(async () => {
    try {
      await cancelActiveHighlightWorkflow();
    } catch (error) {
      console.error(
        '[GenerateSubtitles] Failed to cancel highlight workflow:',
        error
      );
    }
  }, [cancelActiveHighlightWorkflow]);

  // Local UI state for confirm dialog when an SRT is already mounted
  // Replaced local dialog with global modal; see GlobalModals

  useEffect(() => {
    void refreshRecentLocalMedia();
  }, [refreshRecentLocalMedia]);

  useEffect(() => {
    if (!isWorkspaceTabNavigationLocked) return;
    if (activeWorkspaceTab === 'main') return;
    setActiveWorkspaceTab('main');
  }, [
    activeWorkspaceTab,
    isWorkspaceTabNavigationLocked,
    setActiveWorkspaceTab,
  ]);

  useEffect(() => {
    if (!highlightWorkflowRunning) return;
    if (!highlightWorkflowSourceKey) return;
    if (highlightWorkflowSourceKey === currentHighlightSourceKey) return;
    void requestHighlightWorkflowCancellation();
  }, [
    currentHighlightSourceKey,
    highlightWorkflowRunning,
    highlightWorkflowSourceKey,
    requestHighlightWorkflowCancellation,
  ]);

  useEffect(() => {
    if (!stepTwoWorkflowActive) return;
    if (!stepTwoWorkflowSourceKey) return;
    if (stepTwoWorkflowSourceKey === currentHighlightSourceKey) return;
    clearStepTwoWorkflow({ expectedRunToken: stepTwoWorkflowRunToken });
  }, [
    clearStepTwoWorkflow,
    currentHighlightSourceKey,
    stepTwoWorkflowActive,
    stepTwoWorkflowRunToken,
    stepTwoWorkflowSourceKey,
  ]);

  useEffect(() => {
    if (stepTwoWorkflowKind !== 'highlight') return;

    if (highlightWorkflowSummaryOperationId) {
      transitionStepTwoWorkflowToRunning({
        expectedRunToken: stepTwoWorkflowRunToken,
        followUpId: highlightWorkflowSummaryOperationId,
      });
      return;
    }

    if (!highlightWorkflowRunning) {
      clearStepTwoWorkflow({ expectedRunToken: stepTwoWorkflowRunToken });
    }
  }, [
    clearStepTwoWorkflow,
    highlightWorkflowRunning,
    highlightWorkflowSummaryOperationId,
    stepTwoWorkflowKind,
    stepTwoWorkflowRunToken,
    transitionStepTwoWorkflowToRunning,
  ]);

  useEffect(() => {
    if (highlightWorkflowRunning) return;
    releaseStepTwoActionLaunchLock();
  }, [highlightWorkflowRunning]);

  async function handleOpenRecentMedia(path: string) {
    if (isSourceChangeBlocked) return;
    await openRecentLocalMedia(path, { preserveSubtitles: false });
  }

  async function handleOpenLocalMedia() {
    if (isSourceChangeBlocked) {
      return { canceled: true } as { canceled: boolean; selectedPath?: string };
    }
    return openLocalMedia({ preserveSubtitles: false });
  }

  // Arm the auto-run chain for the chosen stop and run a download. If the
  // download doesn't produce a mounted video, disarm + mark the session errored
  // so the effect never fires stale and the strip stops spinning.
  async function runDownloadWithAutoRun(
    downloadFn: () => Promise<ProcessUrlResult | void>
  ) {
    const target = autoRunTarget;
    // Bind to a source only after the download mounts (below). Until then the
    // continuation is unbound and cannot fire against whatever is currently
    // mounted, even if that source's metadata becomes ready mid-download.
    setAutoRunBoundSource(null);
    if (target === 'download') {
      pendingAutoRunTargetRef.current = 'download';
      setAutoRunSession(null);
    } else {
      if (target === 'translate') {
        setPreTranscriptProcessingLanguage(autoRunLanguage);
      }
      pendingAutoRunTargetRef.current = target;
      setAutoRunSession({ target, phase: 'downloading' });
    }
    const result = await downloadFn();
    const typedResult =
      result && typeof result === 'object'
        ? (result as ProcessUrlResult)
        : null;
    // A successful ProcessUrlResult only means the URL was processed — not that
    // the downloaded file became the current source. If the user changed the
    // mounted source during the download and then declined the "switch to
    // downloaded video" prompt, the path changes without the download mounting.
    // Require the current source to be the downloaded file itself (its stored
    // path equals res.videoPath/filePath verbatim — see video-store setFile),
    // so the continuation can never bind to the old or an unrelated file.
    const downloadedPath =
      typedResult?.videoPath ?? typedResult?.filePath ?? null;
    const mountedSourcePath = useVideoStore.getState().path;
    const mountedDownloadedVideo = Boolean(
      typedResult?.success &&
      downloadedPath &&
      mountedSourcePath === downloadedPath
    );
    if (pendingAutoRunTargetRef.current !== 'download') {
      if (mountedDownloadedVideo) {
        // Binding via state schedules a render, so the firing effect re-runs and
        // starts transcription/translation even if the new file's metadata
        // already settled while the download was awaited.
        setAutoRunBoundSource(mountedSourcePath);
      } else {
        pendingAutoRunTargetRef.current = 'download';
        setAutoRunBoundSource(null);
        setAutoRunSession(null);
      }
    }
    return result;
  }

  async function handleProcessUrlDownload() {
    if (isSourceChangeBlocked) return;
    await runDownloadWithAutoRun(() => downloadMedia());
  }

  function handleRemoveRecentMedia(path: string) {
    removeRecentLocalMedia(path);
  }

  const stepTwoStageTitle = showMountedTranscriptStep
    ? t('generateSubtitles.workflow.translateDubTitle', 'Translate Or Dub')
    : t('generateSubtitles.workflow.processVideoTitle', 'Process Video');

  return (
    <Section
      title={t('subtitles.generate')}
      contentClassName={workflowStageStackStyles}
    >
      {/* Global confirmations are rendered via <GlobalModals /> */}

      <div className={workspaceTabsRowStyles}>
        {workspaceTabs.map(tab => {
          const isDisabled =
            isWorkspaceTabNavigationLocked && tab.key !== 'main';

          return (
            <button
              key={tab.key}
              type="button"
              className={workspaceTabButtonStyles(
                activeWorkspaceTab === tab.key,
                isDisabled
              )}
              onClick={() => {
                if (isDisabled) return;
                setActiveWorkspaceTab(tab.key);
              }}
              disabled={isDisabled}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: activeWorkspaceTab === 'main' ? 'block' : 'none',
        }}
      >
        {autoRunSession ? (
          <AutoRunProgress
            target={autoRunSession.target}
            phase={autoRunSession.phase}
            language={autoRunLanguage}
            failedStep={autoRunSession.failedStep}
            onDismiss={() => setAutoRunSession(null)}
          />
        ) : null}

        <div className={workflowStageShellStyles}>
          <div className={workflowStageHeaderStyles}>
            <div className={workflowStageHeaderRowStyles}>
              <span className={workflowStageEyebrowStyles}>
                {t('generateSubtitles.workflow.stepOne', 'Step 1')}
              </span>
              <h3 className={workflowStageTitleStyles}>
                {t(
                  'generateSubtitles.workflow.chooseSourceTitle',
                  'Choose Source'
                )}
              </h3>
            </div>
          </div>

          <div className={workflowStageBodyStyles}>
            {!(videoFile || videoFilePath) ? (
              <>
                <UrlCookieBanner />
                <MediaInputSection
                  videoFile={videoFile}
                  recentMedia={recentLocalMedia}
                  onOpenFileDialog={handleOpenLocalMedia}
                  onOpenRecentFile={handleOpenRecentMedia}
                  onRemoveRecentFile={handleRemoveRecentMedia}
                  isDownloadInProgress={download.inProgress}
                  isTranslationInProgress={isSourceChangeBlocked}
                  urlInput={urlInput}
                  setUrlInput={setUrlInput}
                  downloadQuality={downloadQuality}
                  setDownloadQuality={setDownloadQuality}
                  handleProcessUrl={handleProcessUrlDownload}
                  autoRunTarget={autoRunTarget}
                  setAutoRunTarget={setAutoRunTarget}
                  autoRunLanguage={autoRunLanguage}
                  setAutoRunLanguage={setAutoRunLanguage}
                />
              </>
            ) : null}

            <VideoSuggestionPanel
              disabled={false}
              disablePrimaryActions={isSourceChangeBlocked}
              isDownloadInProgress={download.inProgress}
              onDownload={handleSuggestedVideoDownload}
              recentDownloadTitles={downloadedVideoLibrary.downloadHistory
                .map(item => String(item.title || '').trim())
                .filter(Boolean)
                .slice(0, 8)}
              recentChannelNames={downloadedVideoLibrary.recentDownloadedChannels
                .map(item => String(item.name || '').trim())
                .filter(Boolean)
                .slice(0, 8)}
            />
          </div>
        </div>

        {hasSourceSelection || hasTranscriptSummaryPanel ? (
          <div
            className={workflowStageShellStyles}
            style={{ marginTop: spacing.lg }}
          >
            <div className={workflowStageHeaderStyles}>
              <div className={workflowStageHeaderRowStyles}>
                <span className={workflowStageEyebrowStyles}>
                  {t('generateSubtitles.workflow.stepTwo', 'Step 2')}
                </span>
                <h3 className={workflowStageTitleStyles}>
                  {stepTwoStageTitle}
                </h3>
              </div>
            </div>

            <div className={workflowStageBodyStyles}>
              {!showMountedTranscriptStep && !isTranslating ? (
                <>
                  <TranscribeOnlyPanel
                    className={workflowPanelFlushStyles}
                    onTranscribe={handleTranscribeOnly}
                    onTranslate={handleTranslateFromScratch}
                    onCreateHighlight={handleCreateHighlight}
                    processingLanguage={preTranscriptProcessingLanguage}
                    onProcessingLanguageChange={
                      setPreTranscriptProcessingLanguage
                    }
                    isTranscribing={
                      isTranscribing && !isPreTranscriptTranslateRunning
                    }
                    isTranslating={isPreTranscriptTranslateRunning}
                    isCreatingHighlight={isStepTwoMutationLocked}
                    disabled={
                      isButtonDisabled ||
                      hoursNeeded == null ||
                      isMetadataPending ||
                      isStepTwoMutationLocked ||
                      isPreTranscriptTranslateRunning
                    }
                    createHighlightDisabled={
                      !canCreateHighlight || isPreTranscriptTranslateRunning
                    }
                    statusMessage={metadataStatusMessage}
                  />
                  {preTranscriptTranslateProgress ? (
                    <HighlightWorkflowProgress
                      className={workflowPanelFlushStyles}
                      title={preTranscriptTranslateProgress.title}
                      stage={preTranscriptTranslateProgress.stage}
                      progress={preTranscriptTranslateProgress.percent}
                    />
                  ) : null}
                  {shouldShowHighlightWorkflowProgress ? (
                    <HighlightWorkflowProgress
                      className={workflowPanelFlushStyles}
                      title={t('summary.generate', 'Generate highlights')}
                      stage={
                        highlightProgress.stage ||
                        t('summary.status.inProgress')
                      }
                      progress={highlightProgress.percent}
                      onCancel={() => {
                        void handleCancelHighlightWorkflow();
                      }}
                      isCancelling={isCancellingHighlightWorkflow}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  <SrtMountedPanel
                    className={workflowPanelFlushStyles}
                    srtPath={mountedSrtPath}
                    onTranslate={handleTranslate}
                    isTranslating={isTranslating}
                    disabled={
                      isButtonDisabled ||
                      hoursNeeded == null ||
                      isStepTwoMutationLocked
                    }
                    targetLanguage={targetLanguage}
                    onTargetLanguageChange={setTargetLanguage}
                    onDub={handleDub}
                    isDubbing={isDubbing}
                    disableDub={
                      isButtonDisabled ||
                      hoursNeeded == null ||
                      isStepTwoMutationLocked
                    }
                  />
                  {preTranscriptTranslateProgress ? (
                    <HighlightWorkflowProgress
                      className={workflowPanelFlushStyles}
                      title={preTranscriptTranslateProgress.title}
                      stage={preTranscriptTranslateProgress.stage}
                      progress={preTranscriptTranslateProgress.percent}
                    />
                  ) : null}
                  {shouldShowHighlightWorkflowProgress ? (
                    <HighlightWorkflowProgress
                      className={workflowPanelFlushStyles}
                      title={t('summary.generate', 'Generate highlights')}
                      stage={
                        highlightProgress.stage ||
                        t('summary.status.inProgress')
                      }
                      progress={highlightProgress.percent}
                      onCancel={() => {
                        void handleCancelHighlightWorkflow();
                      }}
                      isCancelling={isCancellingHighlightWorkflow}
                    />
                  ) : null}
                  {summarySegments.length > 0 ? (
                    <TranscriptSummaryPanel
                      generationLocked={isHighlightWorkflowTranscribing}
                      segments={summarySegments}
                    />
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {activeWorkspaceTab === 'history' ? (
        <div className={workflowStageShellStyles}>
          <div className={workflowStageHeaderStyles}>
            <div className={workflowStageHeaderRowStyles}>
              <h3 className={workflowStageTitleStyles}>
                {t(
                  'input.videoSuggestion.downloadHistoryTitle',
                  'Download history'
                )}
              </h3>
            </div>
          </div>
          <div className={workflowStageBodyStyles}>
            {downloadedVideoLibrary.error ? (
              <ErrorBanner
                message={downloadedVideoLibrary.error}
                onClose={() => downloadedVideoLibrary.setError(null)}
              />
            ) : null}
            <VideoSuggestionHistoryTab
              disabled={isSourceChangeBlocked}
              downloadHistory={downloadedVideoLibrary.downloadHistory}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={isSourceChangeBlocked}
              localPrimaryActionLabel={
                downloadedVideoLibrary.localPrimaryActionLabel
              }
              playablePathMap={downloadedVideoLibrary.playablePathMap}
              t={t}
              buildVideoMetaDetails={
                downloadedVideoLibrary.buildHistoryMetaDetails
              }
              formatHistoryTimestamp={
                downloadedVideoLibrary.formatHistoryTimestamp
              }
              onOpenChannelExternally={(channelUrl, channelName) => {
                void downloadedVideoLibrary.openChannelExternally(
                  channelUrl,
                  channelName
                );
              }}
              onOpenDownloadedVideo={item => {
                void downloadedVideoLibrary.openDownloadedVideo(item);
              }}
              onOpenVideoExternally={url => {
                void downloadedVideoLibrary.openVideoExternally(url);
              }}
              onRedownloadHistoryItem={item => {
                void downloadedVideoLibrary.redownloadHistoryItem(item);
              }}
              onRemoveHistoryItem={id => {
                downloadedVideoLibrary.removeHistoryItem(id);
              }}
            />
          </div>
        </div>
      ) : null}

      {activeWorkspaceTab === 'channels' ? (
        <div className={workflowStageShellStyles}>
          <div className={workflowStageHeaderStyles}>
            <div className={workflowStageHeaderRowStyles}>
              <h3 className={workflowStageTitleStyles}>
                {t('input.videoSuggestion.tabChannels', 'Channels')}
              </h3>
            </div>
          </div>
          <div className={workflowStageBodyStyles}>
            {downloadedVideoLibrary.error ? (
              <ErrorBanner
                message={downloadedVideoLibrary.error}
                onClose={() => downloadedVideoLibrary.setError(null)}
              />
            ) : null}
            <VideoSuggestionChannelsTab
              recentDownloadedChannels={
                downloadedVideoLibrary.recentDownloadedChannels
              }
              t={t}
              onOpenChannelExternally={(channelUrl, channelName) => {
                void downloadedVideoLibrary.openChannelExternally(
                  channelUrl,
                  channelName
                );
              }}
              onRemoveChannelItem={key => {
                downloadedVideoLibrary.removeChannelHistoryItem(key);
              }}
            />
          </div>
        </div>
      ) : null}
    </Section>
  );

  function resetHighlightWorkflowState() {
    resetHighlightWorkflowRuntime();
    releaseStepTwoActionLaunchLock();
  }

  function getMountedTranscriptSegments() {
    const subtitleState = useSubStore.getState();
    return subtitleState.order
      .map(id => subtitleState.segments[id])
      .filter((segment): segment is SrtSegment => Boolean(segment));
  }

  function getLiveHighlightSourceKey() {
    const videoState = useVideoStore.getState();
    if (videoState.sourceAssetIdentity) {
      return `asset:${videoState.sourceAssetIdentity}`;
    }
    if (videoState.sourceUrl) {
      return `url:${videoState.sourceUrl}`;
    }
    if (videoState.path) {
      return `path:${videoState.path}`;
    }
    if (videoState.file) {
      return `file:${videoState.file.name}:${videoState.file.size}:${videoState.file.lastModified}`;
    }
    return null;
  }

  function captureSubtitleDocumentSnapshot(
    sourceKey: string | null
  ): SubtitleDocumentSnapshot {
    const subtitleState = useSubStore.getState();

    return {
      sourceKey,
      segments: subtitleState.order
        .map(id => subtitleState.segments[id])
        .filter((segment): segment is SrtSegment => Boolean(segment))
        .map(segment => ({ ...segment })),
      documentMeta: subtitleState.documentId
        ? {
            id: subtitleState.documentId,
            title: subtitleState.documentTitle ?? null,
            subtitleKind: subtitleState.subtitleKind ?? null,
            targetLanguage: subtitleState.targetLanguage ?? null,
            sourceVideoPath: subtitleState.sourceVideoPath ?? null,
            sourceVideoAssetIdentity:
              subtitleState.sourceVideoAssetIdentity ?? null,
            sourceUrl: subtitleState.sourceUrl ?? null,
            importFilePath: subtitleState.originalPath ?? null,
            lastExportPath: subtitleState.exportPath ?? null,
            activeLinkedFilePath: subtitleState.activeFilePath ?? null,
            activeLinkedFileMode: subtitleState.activeFileMode ?? null,
            activeLinkedFileRole: subtitleState.activeFileRole ?? null,
            transcriptionEngine: subtitleState.transcriptionEngine ?? null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
          }
        : null,
      originalPath: subtitleState.originalPath ?? null,
      activeFilePath: subtitleState.activeFilePath ?? null,
      activeFileMode: subtitleState.activeFileMode ?? null,
      activeFileRole: subtitleState.activeFileRole ?? null,
      origin: subtitleState.origin ?? null,
      sourceVideoPath: subtitleState.sourceVideoPath ?? null,
      sourceVideoAssetIdentity: subtitleState.sourceVideoAssetIdentity ?? null,
      transcriptionEngine: subtitleState.transcriptionEngine ?? null,
      libraryMeta: {
        entryId: subtitleState.libraryEntryId ?? null,
        kind: subtitleState.libraryKind ?? null,
        targetLanguage: subtitleState.targetLanguage ?? null,
      },
    };
  }

  function restoreSubtitleDocumentSnapshot(
    snapshot: SubtitleDocumentSnapshot | null
  ) {
    if (!snapshot) return;
    if (snapshot.sourceKey !== getLiveHighlightSourceKey()) return;

    useSubStore
      .getState()
      .load(
        snapshot.segments,
        snapshot.originalPath,
        snapshot.origin,
        snapshot.sourceVideoPath,
        snapshot.transcriptionEngine,
        snapshot.libraryMeta,
        snapshot.sourceVideoAssetIdentity,
        snapshot.documentMeta
      );
    useSubStore.getState().setActiveFileTarget({
      filePath: snapshot.activeFilePath ?? null,
      mode: snapshot.activeFileMode ?? null,
      role: snapshot.activeFileRole ?? null,
    });
  }

  function hasUsableMountedTranscriptSegments() {
    return hasUsableTranscriptSegments(getMountedTranscriptSegments());
  }

  async function handleCreateHighlight() {
    if (highlightWorkflowRunning || !canCreateHighlight) return;
    if (!tryAcquireStepTwoActionLaunchLock()) return;

    let stepTwoRunToken: number | null = null;

    try {
      const hasTranscriptNow = hasUsableMountedTranscriptSegments();
      const needsTranscription = !hasTranscriptNow;
      const requestedSummaryLanguage = needsTranscription
        ? preTranscriptProcessingLanguage
        : useUIStore.getState().summaryLanguage;
      const subtitleRollbackSnapshot = needsTranscription
        ? captureSubtitleDocumentSnapshot(currentHighlightSourceKey || null)
        : null;
      let finalRequestSegments: SrtSegment[] | null = needsTranscription
        ? null
        : getMountedTranscriptSegments();
      const transcriptionOperationId = needsTranscription
        ? `transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        : null;
      stepTwoRunToken = startStepTwoWorkflow({
        kind: 'highlight',
        language: requestedSummaryLanguage,
        sourceKey: currentHighlightSourceKey || null,
        transcriptionOperationId,
      });
      const highlightRunToken = startHighlightWorkflow({
        requiresTranscription: needsTranscription,
        transcriptionOperationId,
        sourceKey: currentHighlightSourceKey || null,
      });

      if (needsTranscription && transcriptionOperationId) {
        const transcriptionResult = await startTranscriptionFlow({
          videoFile,
          videoFilePath,
          durationSecs,
          hoursNeeded,
          operationId: transcriptionOperationId,
          workflowOwner: 'highlight',
          // Defer the initial open so highlight starts in Generate, then let
          // mounted subtitles surface Edit through the shared MainPanels rule.
          openEditPanelOnStart: false,
          metadataStatus: {
            status: metadataStatus,
            code: metadataErrorCode,
            message: metadataErrorMessage,
          },
        });

        if (!transcriptionResult.success) {
          restoreSubtitleDocumentSnapshot(subtitleRollbackSnapshot);
        }

        if (
          useHighlightWorkflowStore.getState().runToken !== highlightRunToken
        ) {
          clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
          releaseStepTwoActionLaunchLock();
          return;
        }

        if (!transcriptionResult.success) {
          clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
          resetHighlightWorkflowState();
          return;
        }

        transitionStepTwoWorkflowToHandoff({
          expectedRunToken: stepTwoRunToken,
        });

        const mountedTranscriptSegments = getMountedTranscriptSegments();
        if (hasUsableTranscriptSegments(mountedTranscriptSegments)) {
          finalRequestSegments = mountedTranscriptSegments;
        } else if (transcriptionResult.subtitles) {
          finalRequestSegments = parseSrt(transcriptionResult.subtitles);
        }

        if (
          !finalRequestSegments ||
          !hasUsableTranscriptSegments(finalRequestSegments)
        ) {
          finalRequestSegments = getMountedTranscriptSegments();
        }

        if (
          !finalRequestSegments ||
          !hasUsableTranscriptSegments(finalRequestSegments)
        ) {
          restoreSubtitleDocumentSnapshot(subtitleRollbackSnapshot);
          clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
          resetHighlightWorkflowState();
          return;
        }
      }

      if (useHighlightWorkflowStore.getState().runToken !== highlightRunToken) {
        clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
        releaseStepTwoActionLaunchLock();
        return;
      }

      if (
        !finalRequestSegments ||
        !hasUsableTranscriptSegments(finalRequestSegments)
      ) {
        finalRequestSegments = getMountedTranscriptSegments();
      }

      if (
        !finalRequestSegments ||
        !hasUsableTranscriptSegments(finalRequestSegments)
      ) {
        if (needsTranscription) {
          restoreSubtitleDocumentSnapshot(subtitleRollbackSnapshot);
        }
        clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
        resetHighlightWorkflowState();
        return;
      }

      const currentUiState = useUIStore.getState();
      const currentVideoState = useVideoStore.getState();
      const currentSubtitleState = useSubStore.getState();
      const highlightOutputLanguage = requestedSummaryLanguage;
      if (
        needsTranscription &&
        highlightOutputLanguage !== currentUiState.summaryLanguage
      ) {
        setSummaryLanguage(highlightOutputLanguage);
      }
      const requestId = requestHighlights('generate-subtitles', {
        ownerKey: buildSummaryRequestOwnerKey({
          semanticSourceIdentity: buildSemanticSummarySourceIdentity({
            fallbackVideoAssetIdentity:
              currentSubtitleState.sourceVideoAssetIdentity ?? null,
            fallbackVideoPath: currentSubtitleState.sourceVideoPath ?? null,
            originalVideoPath: currentVideoState.originalPath ?? null,
            sourceAssetIdentity: currentVideoState.sourceAssetIdentity ?? null,
            sourceUrl: currentVideoState.sourceUrl ?? null,
          }),
          segments: finalRequestSegments,
          summaryLanguage: highlightOutputLanguage,
          effortLevel: currentUiState.summaryEffortLevel,
        }),
      });

      if (useHighlightWorkflowStore.getState().runToken !== highlightRunToken) {
        clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
        releaseStepTwoActionLaunchLock();
        return;
      }

      transitionStepTwoWorkflowToHandoff({
        expectedRunToken: stepTwoRunToken,
        followUpId: requestId,
      });
      setHighlightWorkflowAwaitingSummaryStart(requestId);
    } catch (error) {
      console.error(
        '[GenerateSubtitles] Failed to start highlight workflow:',
        error
      );
      if (stepTwoRunToken != null) {
        clearStepTwoWorkflow({
          expectedRunToken: stepTwoRunToken,
        });
      }
      resetHighlightWorkflowState();
    }
  }

  async function handleCancelHighlightWorkflow() {
    await requestHighlightWorkflowCancellation();
  }

  async function handleTranscribeOnly(): Promise<boolean> {
    if (highlightWorkflowRunning) return false;
    if (!tryAcquireStepTwoActionLaunchLock()) return false;

    // If an SRT is already mounted, prompt user before proceeding
    try {
      return await proceedTranscribe();
    } finally {
      releaseStepTwoActionLaunchLock();
    }
  }

  async function handleTranslateFromScratch(): Promise<boolean> {
    if (
      highlightWorkflowRunning ||
      stepTwoWorkflowActive ||
      transcriptionInProgress
    ) {
      return false;
    }
    if (!tryAcquireStepTwoActionLaunchLock()) return false;

    const requestedLanguage = preTranscriptProcessingLanguage;
    const transcriptionOperationId = `transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const stepTwoRunToken = startStepTwoWorkflow({
      kind: 'translate',
      language: requestedLanguage,
      sourceKey: currentHighlightSourceKey || null,
      transcriptionOperationId,
    });

    try {
      const transcriptionResult = await startTranscriptionFlow({
        videoFile,
        videoFilePath,
        durationSecs,
        hoursNeeded,
        operationId: transcriptionOperationId,
        metadataStatus: {
          status: metadataStatus,
          code: metadataErrorCode,
          message: metadataErrorMessage,
        },
      });

      if (!transcriptionResult.success) {
        return false;
      }

      if (useStepTwoWorkflowStore.getState().runToken !== stepTwoRunToken) {
        return false;
      }

      transitionStepTwoWorkflowToHandoff({
        expectedRunToken: stepTwoRunToken,
      });

      let finalSegments = getMountedTranscriptSegments();

      if (
        !hasUsableTranscriptSegments(finalSegments) &&
        transcriptionResult.subtitles
      ) {
        finalSegments = parseSrt(transcriptionResult.subtitles);
      }

      if (!finalSegments || !hasUsableTranscriptSegments(finalSegments)) {
        useUrlStore
          .getState()
          .setValidationError('No SRT file available for translation');
        return false;
      }

      if (useStepTwoWorkflowStore.getState().runToken !== stepTwoRunToken) {
        return false;
      }

      const translationOperationId = `translate-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      transitionStepTwoWorkflowToRunning({
        expectedRunToken: stepTwoRunToken,
        followUpId: translationOperationId,
      });
      setTargetLanguage(requestedLanguage);

      const translationResult = await executeSrtTranslation({
        segments: finalSegments,
        targetLanguage: requestedLanguage,
        operationId: translationOperationId,
      });
      return Boolean(translationResult?.success);
    } finally {
      clearStepTwoWorkflow({ expectedRunToken: stepTwoRunToken });
      releaseStepTwoActionLaunchLock();
    }
  }

  function tryAcquireStepTwoActionLaunchLock(): boolean {
    if (stepTwoActionLaunchLockRef.current) return false;
    stepTwoActionLaunchLockRef.current = true;
    return true;
  }

  function releaseStepTwoActionLaunchLock() {
    stepTwoActionLaunchLockRef.current = false;
  }

  async function proceedTranscribe(): Promise<boolean> {
    const operationId = `transcribe-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const result = await startTranscriptionFlow({
      videoFile,
      videoFilePath,
      durationSecs,
      hoursNeeded,
      operationId,
      metadataStatus: {
        status: metadataStatus,
        code: metadataErrorCode,
        message: metadataErrorMessage,
      },
    });
    return Boolean(result?.success);
  }

  async function handleTranslate() {
    if (isStepTwoMutationLocked) return;
    await runFullSrtTranslation({
      onNoSubtitles: () =>
        useUrlStore
          .getState()
          .setValidationError('No SRT file available for translation'),
    });
  }

  async function handleDub() {
    if (isStepTwoMutationLocked) return;
    let subtitleState = useSubStore.getState();
    let currentSegments = subtitleState.order.map(
      id => subtitleState.segments[id]
    );
    if (currentSegments.length === 0) {
      useUrlStore
        .getState()
        .setValidationError('No subtitles available for dubbing');
      return;
    }

    // Dub the selected output language, not whatever text happens to be
    // mounted: translate first when translations are missing or were made
    // for a different language.
    const ready = await ensureSubtitlesTranslatedForDubbing();
    if (!ready.ok) {
      return;
    }
    subtitleState = useSubStore.getState();
    currentSegments = subtitleState.order.map(id => subtitleState.segments[id]);

    const operationId = `dub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const videoStoreState = useVideoStore.getState();
    const sourceVideoPath =
      videoStoreState.originalPath ??
      subtitleState.sourceVideoPath ??
      videoFilePath ??
      videoStoreState.path;

    const dubVoice = useUIStore.getState().dubVoice;

    await executeDubGeneration({
      segments: currentSegments,
      operationId,
      videoPath: sourceVideoPath,
      voice: dubVoice,
      targetLanguage,
      videoDurationSeconds: durationSecs ?? undefined,
    });
  }

  async function handleSuggestedVideoDownload(
    item: VideoSuggestionResultItem
  ): Promise<void> {
    if (isSourceChangeBlocked) return;
    const url = String(item?.url || '').trim();
    if (!url) return;
    useUrlStore.getState().setUrlInput(url);
    await runDownloadWithAutoRun(() =>
      useUrlStore.getState().downloadMedia({ url })
    );
  }
}
