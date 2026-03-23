import { css } from '@emotion/css';
import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner.js';
import {
  useHighlightGenerationRequestStore,
  useHighlightWorkflowStore,
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';
import { useUrlStore } from '../../state/url-store';
import UrlCookieBanner from './UrlCookieBanner';
import MediaInputSection from './components/MediaInputSection.js';
import HighlightWorkflowProgress from './components/HighlightWorkflowProgress.js';
import TranscribeOnlyPanel from './components/TranscribeOnlyPanel.js';
import SrtMountedPanel from './components/SrtMountedPanel.js';
import TranscriptSummaryPanel from '../../components/TranscriptSummaryPanel/index.js';
import VideoSuggestionPanel from './components/VideoSuggestionPanel/index.js';
import VideoSuggestionChannelsTab from './components/VideoSuggestionPanel/VideoSuggestionChannelsTab.js';
import VideoSuggestionHistoryTab from './components/VideoSuggestionPanel/VideoSuggestionHistoryTab.js';
import { type GenerateSubtitlesWorkspaceTab } from './components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import type {
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
import { runFullSrtTranslation } from '../../utils/runFullTranslation';
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

type PreTranscriptTranslateWorkflow = {
  transcriptionOperationId: string;
  translationOperationId: string | null;
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
  const stepTwoActionLaunchLockRef = useRef(false);
  const [preTranscriptTranslateWorkflow, setPreTranscriptTranslateWorkflow] =
    useState<PreTranscriptTranslateWorkflow | null>(null);
  const [preTranscriptProcessingLanguage, setPreTranscriptProcessingLanguage] =
    useState(targetLanguage);
  const currentHighlightSourceKey = useMemo(() => {
    if (sourceAssetIdentity) return `asset:${sourceAssetIdentity}`;
    if (sourceUrl) return `url:${sourceUrl}`;
    if (videoFilePath) return `path:${videoFilePath}`;
    if (videoFile) {
      return `file:${videoFile.name}:${videoFile.size}:${videoFile.lastModified}`;
    }
    return '';
  }, [sourceAssetIdentity, sourceUrl, videoFilePath, videoFile]);
  const isSourceChangeBlocked =
    isSourceChangeBlockedBase ||
    highlightWorkflowRunning ||
    summaryTask.inProgress ||
    hasSummaryPanelRequest;
  const isStepTwoMutationLocked =
    highlightWorkflowRunning || isCancellingHighlightWorkflow;

  useEffect(() => {
    setPreTranscriptProcessingLanguage(targetLanguage);
  }, [targetLanguage]);

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
  const isPreTranscriptTranslateRunning =
    preTranscriptTranslateWorkflow !== null;
  const preTranscriptTranslateProgress = useMemo(() => {
    if (!preTranscriptTranslateWorkflow) {
      return null;
    }

    const transcribeOperationId =
      preTranscriptTranslateWorkflow.transcriptionOperationId;
    const translateOperationId =
      preTranscriptTranslateWorkflow.translationOperationId;

    const transcribeActive =
      transcriptionTask.inProgress &&
      transcriptionTask.id === transcribeOperationId;

    if (transcribeActive) {
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

    if (!translateOperationId) {
      return {
        title: t('subtitles.translate', 'Translate'),
        stage: t('generateSubtitles.status.starting'),
        percent: 50,
      };
    }

    const translateActive =
      translationTask.inProgress && translationTask.id === translateOperationId;

    if (translateActive) {
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
  }, [preTranscriptTranslateWorkflow, t, transcriptionTask, translationTask]);
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

  async function handleProcessUrlDownload() {
    if (isSourceChangeBlocked) return;
    await downloadMedia();
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
                  {isHighlightWorkflowTranscribing ? (
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

    try {
      const hasTranscriptNow = hasUsableMountedTranscriptSegments();
      const needsTranscription = !hasTranscriptNow;
      const subtitleRollbackSnapshot = needsTranscription
        ? captureSubtitleDocumentSnapshot(currentHighlightSourceKey || null)
        : null;
      let finalRequestSegments: SrtSegment[] | null = needsTranscription
        ? null
        : getMountedTranscriptSegments();
      const transcriptionOperationId = needsTranscription
        ? `transcribe-${Date.now()}`
        : null;
      const runToken = startHighlightWorkflow({
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

        if (useHighlightWorkflowStore.getState().runToken !== runToken) {
          releaseStepTwoActionLaunchLock();
          return;
        }

        if (!transcriptionResult.success) {
          resetHighlightWorkflowState();
          return;
        }

        if (transcriptionResult.subtitles) {
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
          resetHighlightWorkflowState();
          return;
        }
      }

      if (useHighlightWorkflowStore.getState().runToken !== runToken) {
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
        resetHighlightWorkflowState();
        return;
      }

      const currentUiState = useUIStore.getState();
      const currentVideoState = useVideoStore.getState();
      const currentSubtitleState = useSubStore.getState();
      const highlightOutputLanguage = needsTranscription
        ? preTranscriptProcessingLanguage
        : currentUiState.summaryLanguage;
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

      if (useHighlightWorkflowStore.getState().runToken !== runToken) {
        releaseStepTwoActionLaunchLock();
        return;
      }

      setHighlightWorkflowAwaitingSummaryStart(requestId);
    } catch (error) {
      console.error(
        '[GenerateSubtitles] Failed to start highlight workflow:',
        error
      );
      resetHighlightWorkflowState();
    }
  }

  async function handleCancelHighlightWorkflow() {
    await requestHighlightWorkflowCancellation();
  }

  async function handleTranscribeOnly() {
    if (highlightWorkflowRunning) return;
    if (!tryAcquireStepTwoActionLaunchLock()) return;

    // If an SRT is already mounted, prompt user before proceeding
    try {
      await proceedTranscribe();
    } finally {
      releaseStepTwoActionLaunchLock();
    }
  }

  async function handleTranslateFromScratch() {
    if (
      highlightWorkflowRunning ||
      isPreTranscriptTranslateRunning ||
      transcriptionInProgress
    ) {
      return;
    }
    if (!tryAcquireStepTwoActionLaunchLock()) return;

    const transcriptionOperationId = `transcribe-${Date.now()}`;
    setPreTranscriptTranslateWorkflow({
      transcriptionOperationId,
      translationOperationId: null,
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
        return;
      }

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
        return;
      }

      const translationOperationId = `translate-${Date.now()}`;
      setPreTranscriptTranslateWorkflow({
        transcriptionOperationId,
        translationOperationId,
      });
      setTargetLanguage(preTranscriptProcessingLanguage);

      await executeSrtTranslation({
        segments: finalSegments,
        targetLanguage: preTranscriptProcessingLanguage,
        operationId: translationOperationId,
      });
    } finally {
      setPreTranscriptTranslateWorkflow(null);
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

  async function proceedTranscribe() {
    const operationId = `transcribe-${Date.now()}`;
    await startTranscriptionFlow({
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
    const subtitleState = useSubStore.getState();
    const currentSegments = subtitleState.order.map(
      id => subtitleState.segments[id]
    );
    if (currentSegments.length === 0) {
      useUrlStore
        .getState()
        .setValidationError('No subtitles available for dubbing');
      return;
    }

    const operationId = `dub-${Date.now()}`;
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
    await useUrlStore.getState().downloadMedia({ url });
  }
}
