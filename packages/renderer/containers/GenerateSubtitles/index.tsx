import { css } from '@emotion/css';
import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import { useEffect, useMemo, useState } from 'react';
import ErrorBanner from '../../components/ErrorBanner.js';
import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';
import { useUrlStore } from '../../state/url-store';
import UrlCookieBanner from './UrlCookieBanner';
import MediaInputSection from './components/MediaInputSection.js';
import TranscribeOnlyPanel from './components/TranscribeOnlyPanel.js';
import SrtMountedPanel from './components/SrtMountedPanel.js';
import VideoSuggestionPanel from './components/VideoSuggestionPanel/index.js';
import VideoSuggestionChannelsTab from './components/VideoSuggestionPanel/VideoSuggestionChannelsTab.js';
import VideoSuggestionHistoryTab from './components/VideoSuggestionPanel/VideoSuggestionHistoryTab.js';
import {
  readGenerateSubtitlesWorkspaceTab,
  writeGenerateSubtitlesWorkspaceTab,
} from './components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import type { GenerateSubtitlesWorkspaceTab } from './components/VideoSuggestionPanel/VideoSuggestionPanel.types.js';
import type { VideoSuggestionResultItem } from '@shared-types/app';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';
import useDownloadedVideoLibrary from './hooks/useDownloadedVideoLibrary.js';

// Components

// Utilities
import {
  startTranscriptionFlow,
  executeDubGeneration,
} from './utils/subtitleGeneration';
import { runFullSrtTranslation } from '../../utils/runFullTranslation';
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

const workspaceTabButtonStyles = (active: boolean) => css`
  padding: 0.72rem 1rem;
  border-radius: ${borderRadius.full};
  border: 1px solid ${active
    ? 'rgba(125, 167, 255, 0.26)'
    : colors.border};
  background: ${active ? 'rgba(125, 167, 255, 0.14)' : 'rgba(255, 255, 255, 0.03)'};
  color: ${active ? colors.text : colors.textDim};
  font-weight: ${active ? fontWeight.semibold : fontWeight.medium};
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;

  &:hover {
    border-color: ${colors.borderStrong};
    color: ${colors.text};
  }
`;

export default function GenerateSubtitles() {
  const { t, i18n } = useTranslation();
  const [activeWorkspaceTab, setActiveWorkspaceTab] =
    useState<GenerateSubtitlesWorkspaceTab>(() =>
      readGenerateSubtitlesWorkspaceTab()
    );

  // UI State
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);

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
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  const openLocalMedia = useVideoStore(s => s.openLocalMedia);
  const openRecentLocalMedia = useVideoStore(s => s.openRecentLocalMedia);
  const removeRecentLocalMedia = useVideoStore(s => s.removeRecentLocalMedia);
  const refreshRecentLocalMedia = useVideoStore(s => s.refreshRecentLocalMedia);

  // Task state
  const translationInProgress = useTaskStore(s => s.translation.inProgress);
  const transcriptionInProgress = useTaskStore(s => s.transcription.inProgress);
  const transcriptionId = useTaskStore(s => s.transcription.id);
  const transcriptionCompleted = useTaskStore(s =>
    Boolean(s.transcription.isCompleted)
  );
  const dubbingInProgress = useTaskStore(s => s.dubbing.inProgress);
  const dubbingId = useTaskStore(s => s.dubbing.id);

  // Subtitle state
  const mountedSubtitleCount = useSubStore(s => s.order.length);
  const originalSrtPath = useSubStore(s => s.originalPath);
  const hasMountedSubtitles = mountedSubtitleCount > 0;
  // Decouple transcription completion from subtitle presence
  const isTranscriptionDone = transcriptionCompleted || hasMountedSubtitles;
  const isTranscribing =
    !!transcriptionInProgress &&
    (transcriptionId?.startsWith('transcribe-') ?? false);
  const isTranslating = !!translationInProgress;
  const isDubbing =
    !!dubbingInProgress && (dubbingId?.startsWith('dub-') ?? false);
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
  const processingStageTitle = isTranscriptionDone
    ? t('generateSubtitles.workflow.translateDubTitle', 'Translate Or Dub')
    : t('generateSubtitles.workflow.transcribeTitle', 'Create Transcript');
  const downloadedVideoLibrary = useDownloadedVideoLibrary(
    i18n.resolvedLanguage || i18n.language || 'en'
  );
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
    [processingStageTitle, t]
  );

  // Local UI state for confirm dialog when an SRT is already mounted
  // Replaced local dialog with global modal; see GlobalModals

  useEffect(() => {
    void refreshRecentLocalMedia();
  }, [refreshRecentLocalMedia]);

  useEffect(() => {
    writeGenerateSubtitlesWorkspaceTab(activeWorkspaceTab);
  }, [activeWorkspaceTab]);

  async function handleOpenRecentMedia(path: string) {
    await openRecentLocalMedia(path, { preserveSubtitles: false });
  }

  function handleRemoveRecentMedia(path: string) {
    removeRecentLocalMedia(path);
  }

  return (
    <Section
      title={t('subtitles.generate')}
      contentClassName={workflowStageStackStyles}
    >
      {/* Global confirmations are rendered via <GlobalModals /> */}

      <div className={workspaceTabsRowStyles}>
        {workspaceTabs.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={workspaceTabButtonStyles(activeWorkspaceTab === tab.key)}
            onClick={() => setActiveWorkspaceTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeWorkspaceTab === 'main' ? (
        <>
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
              {!Boolean(videoFile || videoFilePath) ? (
                <>
                  <UrlCookieBanner />
                  <MediaInputSection
                    videoFile={videoFile}
                    recentMedia={recentLocalMedia}
                    onOpenFileDialog={() =>
                      openLocalMedia({ preserveSubtitles: false })
                    }
                    onOpenRecentFile={handleOpenRecentMedia}
                    onRemoveRecentFile={handleRemoveRecentMedia}
                    isDownloadInProgress={download.inProgress}
                    isTranslationInProgress={translationInProgress}
                    urlInput={urlInput}
                    setUrlInput={setUrlInput}
                    downloadQuality={downloadQuality}
                    setDownloadQuality={setDownloadQuality}
                    handleProcessUrl={downloadMedia}
                  />
                </>
              ) : null}

              <VideoSuggestionPanel
                disabled={translationInProgress || download.inProgress}
                isDownloadInProgress={download.inProgress}
                onDownload={handleSuggestedVideoDownload}
              />
            </div>
          </div>

          {hasSourceSelection ? (
            <div className={workflowStageShellStyles}>
              <div className={workflowStageHeaderStyles}>
                <div className={workflowStageHeaderRowStyles}>
                  <span className={workflowStageEyebrowStyles}>
                    {t('generateSubtitles.workflow.stepTwo', 'Step 2')}
                  </span>
                  <h3 className={workflowStageTitleStyles}>
                    {processingStageTitle}
                  </h3>
                </div>
              </div>

              <div className={workflowStageBodyStyles}>
                {!isTranscriptionDone && !isTranslating ? (
                  <TranscribeOnlyPanel
                    className={workflowPanelFlushStyles}
                    onTranscribe={handleTranscribeOnly}
                    isTranscribing={isTranscribing}
                    disabled={
                      isButtonDisabled ||
                      hoursNeeded == null ||
                      isMetadataPending
                    }
                    statusMessage={metadataStatusMessage}
                  />
                ) : (
                  <SrtMountedPanel
                    className={workflowPanelFlushStyles}
                    srtPath={originalSrtPath}
                    onTranslate={handleTranslate}
                    isTranslating={isTranslating}
                    disabled={isButtonDisabled || hoursNeeded == null}
                    targetLanguage={targetLanguage}
                    onTargetLanguageChange={setTargetLanguage}
                    onDub={handleDub}
                    isDubbing={isDubbing}
                    disableDub={isButtonDisabled || hoursNeeded == null}
                  />
                )}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {activeWorkspaceTab === 'history' ? (
        <div className={workflowStageShellStyles}>
          <div className={workflowStageHeaderStyles}>
            <div className={workflowStageHeaderRowStyles}>
              <h3 className={workflowStageTitleStyles}>
                {t('input.videoSuggestion.downloadHistoryTitle', 'Download history')}
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
              disabled={translationInProgress}
              downloadHistory={downloadedVideoLibrary.downloadHistory}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={translationInProgress}
              localPrimaryActionLabel={
                downloadedVideoLibrary.localPrimaryActionLabel
              }
              playablePathMap={downloadedVideoLibrary.playablePathMap}
              t={t}
              buildVideoMetaDetails={downloadedVideoLibrary.buildHistoryMetaDetails}
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

  async function handleTranscribeOnly() {
    // If an SRT is already mounted, prompt user before proceeding
    await proceedTranscribe();
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
    await runFullSrtTranslation({
      onNoSubtitles: () =>
        useUrlStore
          .getState()
          .setValidationError('No SRT file available for translation'),
    });
  }

  async function handleDub() {
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
    const url = String(item?.url || '').trim();
    if (!url) return;
    useUrlStore.getState().setUrlInput(url);
    await useUrlStore.getState().downloadMedia({ url });
  }
}
