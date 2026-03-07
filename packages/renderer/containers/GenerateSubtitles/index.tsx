import Section from '../../components/Section.js';
import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';
import { cx } from '@emotion/css';
import { useEffect } from 'react';
import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';
import { useUrlStore } from '../../state/url-store';
import * as FileIPC from '../../ipc/file';
import * as SystemIPC from '../../ipc/system';
import UrlCookieBanner from './UrlCookieBanner';
import MediaInputSection from './components/MediaInputSection.js';
import TranscribeOnlyPanel from './components/TranscribeOnlyPanel.js';
import SrtMountedPanel from './components/SrtMountedPanel.js';
import VideoSuggestionPanel from './components/VideoSuggestionPanel/index.js';
import type {
  ProcessUrlResult,
  VideoSuggestionResultItem,
} from '@shared-types/app';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';

// Components

// Utilities
import {
  startTranscriptionFlow,
  executeDubGeneration,
} from './utils/subtitleGeneration';
import { runFullSrtTranslation } from '../../utils/runFullTranslation';
import {
  workflowPanelControlsStyles,
  workflowPanelFlushStyles,
  workflowPanelLeadIconStyles,
  workflowPanelLeadStyles,
  workflowPanelMetaStyles,
  workflowPanelMutedStyles,
  workflowPanelStyles,
  workflowPanelTextBlockStyles,
  workflowPanelTitleStyles,
  workflowStageBodyStyles,
  workflowStageDescriptionStyles,
  workflowStageEyebrowStyles,
  workflowStageHeaderRowStyles,
  workflowStageHeaderStyles,
  workflowStagePillStyles,
  workflowStageShellStyles,
  workflowStageStackStyles,
  workflowStageTitleStyles,
} from '../../components/workflow-surface-styles';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);
  const dubVoice = useUIStore(s => s.dubVoice);

  // URL processing state
  const urlInput = useUrlStore(s => s.urlInput);
  const downloadQuality = useUrlStore(s => s.downloadQuality);
  const download = useUrlStore(s => s.download);
  const setUrlInput = useUrlStore(s => s.setUrlInput);
  const setDownloadQuality = useUrlStore(s => s.setDownloadQuality);
  const clearError = useUrlStore(s => s.clearError);
  const downloadMedia = useUrlStore(s => s.downloadMedia);

  // Video file state
  const videoFile = useVideoStore(s => s.file);
  const videoFilePath = useVideoStore(s => s.path);
  const recentLocalMedia = useVideoStore(s => s.recentLocalMedia);
  const openLocalMedia = useVideoStore(s => s.openLocalMedia);
  const openRecentLocalMedia = useVideoStore(s => s.openRecentLocalMedia);
  const refreshRecentLocalMedia = useVideoStore(s => s.refreshRecentLocalMedia);
  const dubbedVideoPath = useVideoStore(s => s.dubbedVideoPath);

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
  const sourceVideoPath = useSubStore(s => s.sourceVideoPath);
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
  const downloadComplete = !download.inProgress && download.percent === 100;
  const didDownloadFromUrl = Boolean(download.id);
  const canSaveOriginalVideo =
    didDownloadFromUrl && downloadComplete && Boolean(videoFilePath);
  const canSaveDubbedVideo = Boolean(dubbedVideoPath);
  const showSaveStage = canSaveOriginalVideo || canSaveDubbedVideo;

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
  const sourceDisplayName =
    (videoFilePath ? getBasename(videoFilePath) : videoFile?.name) ?? null;
  const sourceStatusLabel = download.inProgress
    ? t('generateSubtitles.workflow.sourceLoading', 'Fetching source')
    : didDownloadFromUrl
      ? t('generateSubtitles.workflow.webSourceReady', 'Web source ready')
      : t('generateSubtitles.workflow.localSourceReady', 'Local file ready');
  const sourceStatusMeta = download.inProgress
    ? t(
        'generateSubtitles.workflow.sourceLoadingDescription',
        'The downloaded source is being prepared for transcription.'
      )
    : sourceDisplayName ||
      t(
        'generateSubtitles.workflow.sourceReadyDescription',
        'Your selected media is ready for the next step.'
      );
  const processingStageTitle = isTranscriptionDone
    ? t('generateSubtitles.workflow.translateDubTitle', 'Translate Or Dub')
    : t('generateSubtitles.workflow.transcribeTitle', 'Create Transcript');

  // Local UI state for confirm dialog when an SRT is already mounted
  // Replaced local dialog with global modal; see GlobalModals

  useEffect(() => {
    void refreshRecentLocalMedia();
  }, [refreshRecentLocalMedia]);

  async function handleOpenRecentMedia(path: string) {
    await openRecentLocalMedia(path, { preserveSubtitles: false });
  }

  return (
    <Section
      title={t('subtitles.generate')}
      contentClassName={workflowStageStackStyles}
    >
      {/* Global confirmations are rendered via <GlobalModals /> */}

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
            {hasSourceSelection ? (
              <span className={workflowStagePillStyles}>
                {sourceStatusLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className={workflowStageBodyStyles}>
          <UrlCookieBanner />

          {hasSourceSelection ? (
            <div
              className={cx(
                workflowPanelStyles,
                workflowPanelMutedStyles,
                workflowPanelFlushStyles
              )}
            >
              <div className={workflowPanelLeadStyles}>
                <div className={workflowPanelLeadIconStyles} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {download.inProgress ? (
                      <>
                        <path d="M12 2v5" />
                        <path d="M17.5 6.5 14 10" />
                        <path d="M22 12h-5" />
                        <path d="M17.5 17.5 14 14" />
                        <path d="M12 22v-5" />
                        <path d="M6.5 17.5 10 14" />
                        <path d="M2 12h5" />
                        <path d="M6.5 6.5 10 10" />
                      </>
                    ) : didDownloadFromUrl ? (
                      <>
                        <path d="M12 5v10" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M5 19h14" />
                      </>
                    ) : (
                      <>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                      </>
                    )}
                  </svg>
                </div>
                <div className={workflowPanelTextBlockStyles}>
                  <h3 className={workflowPanelTitleStyles}>
                    {sourceStatusLabel}
                  </h3>
                  <p className={workflowPanelMetaStyles}>{sourceStatusMeta}</p>
                </div>
              </div>
            </div>
          ) : (
            <MediaInputSection
              videoFile={videoFile}
              recentMedia={recentLocalMedia}
              onOpenFileDialog={() =>
                openLocalMedia({ preserveSubtitles: false })
              }
              onOpenRecentFile={handleOpenRecentMedia}
              isDownloadInProgress={download.inProgress}
              isTranslationInProgress={translationInProgress}
              urlInput={urlInput}
              setUrlInput={setUrlInput}
              downloadQuality={downloadQuality}
              setDownloadQuality={setDownloadQuality}
              handleProcessUrl={downloadMedia}
            />
          )}

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
                  isButtonDisabled || hoursNeeded == null || isMetadataPending
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

      {showSaveStage ? (
        <div className={workflowStageShellStyles}>
          <div className={workflowStageHeaderStyles}>
            <div className={workflowStageHeaderRowStyles}>
              <span className={workflowStageEyebrowStyles}>
                {t('generateSubtitles.workflow.stepThree', 'Step 3')}
              </span>
              <h3 className={workflowStageTitleStyles}>
                {t('generateSubtitles.workflow.saveOutputsTitle', 'Save files')}
              </h3>
            </div>
            <p className={workflowStageDescriptionStyles}>
              {t(
                'generateSubtitles.workflow.saveOutputsDescription',
                'Keep any source or dubbed media you want to preserve outside the app workspace.'
              )}
            </p>
          </div>

          <div className={workflowStageBodyStyles}>
            <div
              className={cx(
                workflowPanelStyles,
                workflowPanelMutedStyles,
                workflowPanelFlushStyles
              )}
            >
              <div className={workflowPanelLeadStyles}>
                <div className={workflowPanelLeadIconStyles} aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M19 21H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z" />
                  </svg>
                </div>
                <div className={workflowPanelTextBlockStyles}>
                  <h3 className={workflowPanelTitleStyles}>
                    {t(
                      'generateSubtitles.workflow.availableOutputs',
                      'Available files'
                    )}
                  </h3>
                  <p className={workflowPanelMetaStyles}>
                    {t(
                      'generateSubtitles.workflow.availableOutputsDescription',
                      'Downloaded and dubbed media remain available here until you save the versions you want to keep.'
                    )}
                  </p>
                </div>
              </div>

              <div className={workflowPanelControlsStyles}>
                {canSaveOriginalVideo ? (
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={handleSaveOriginalVideo}
                    title={`Save the downloaded file: ${videoFilePath}`}
                  >
                    {t('input.saveOriginalVideo')}
                  </Button>
                ) : null}
                {canSaveDubbedVideo ? (
                  <Button
                    variant="success"
                    size="sm"
                    onClick={handleSaveDubbedVideo}
                    disabled={isDubbing}
                    title={dubbedVideoPath ?? undefined}
                  >
                    {t('input.saveDubbedVideo')}
                  </Button>
                ) : null}
              </div>
            </div>
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

  async function handleSaveOriginalVideo() {
    if (!videoFilePath) {
      clearError();
      return;
    }

    const suggestName = (() => {
      const filename = videoFilePath.split(/[\\/]/).pop() || 'downloaded_video';
      return filename.startsWith('ytdl_') ? filename.slice(5) : filename;
    })();

    try {
      const { filePath, error } = await FileIPC.save({
        title: t('dialogs.saveDownloadedVideoAs'),
        defaultPath: suggestName,
        content: '',
        filters: [
          {
            name: t('common.fileFilters.videoFiles'),
            extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi'],
          },
        ],
      });

      if (error) {
        if (!error.includes('canceled')) clearError();
        return;
      }
      if (!filePath) return; // user cancelled

      const copyRes = await FileIPC.copy(videoFilePath, filePath);
      if (copyRes.error) throw new Error(copyRes.error);

      // Tell the user
      SystemIPC.showMessage(t('messages.videoSaved', { path: filePath }));
    } catch (err: any) {
      console.error('[GenerateSubtitles] save original video error:', err);
      clearError();
    }
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

  async function handleSaveDubbedVideo() {
    if (!dubbedVideoPath) {
      return;
    }

    const sourceName = sourceVideoPath ?? videoFilePath ?? dubbedVideoPath;
    const filename = sourceName.split(/[\\/]/).pop() ?? 'dubbed_video';
    const baseName = filename.replace(/\.[^/.]+$/, '');
    const voiceSuffix =
      (dubVoice || 'voice').replace(/[^a-z0-9_-]/gi, '').toLowerCase() ||
      'voice';
    const extCandidate = (dubbedVideoPath.split('.').pop() || 'mp4')
      .split('?')[0]
      .toLowerCase();
    const extension = extCandidate || 'mp4';
    const suggestName = `${baseName}_dubbed_${voiceSuffix}.${extension}`;

    try {
      const { filePath, error } = await FileIPC.save({
        title: t('dialogs.saveDubbedVideoAs'),
        defaultPath: suggestName,
        content: '',
        filters: [
          {
            name: t('common.fileFilters.videoFiles'),
            extensions: [extension],
          },
        ],
      });

      if (error) {
        if (!error.includes('canceled')) clearError();
        return;
      }
      if (!filePath) return;

      const copyRes = await FileIPC.copy(dubbedVideoPath, filePath);
      if (copyRes.error) throw new Error(copyRes.error);

      SystemIPC.showMessage(t('messages.dubbedVideoSaved', { path: filePath }));
    } catch (err: any) {
      console.error('[GenerateSubtitles] save dubbed video error:', err);
      clearError();
    }
  }

  async function handleSuggestedVideoDownload(
    item: VideoSuggestionResultItem
  ): Promise<ProcessUrlResult | void> {
    const url = String(item?.url || '').trim();
    if (!url) return;
    useUrlStore.getState().setUrlInput(url);
    return useUrlStore.getState().downloadMedia();
  }
}

function getBasename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
