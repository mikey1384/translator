import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import SaveOriginalVideoButton from './SaveOriginalVideoButton.js';
import SaveDubbedVideoButton from './SaveDubbedVideoButton.js';
import ErrorBanner from '../../components/ErrorBanner.js';
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

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const { targetLanguage, setTargetLanguage, dubVoice } = useUIStore();

  // URL processing state
  const {
    urlInput,
    downloadQuality,
    error,
    download,
    setUrlInput,
    setDownloadQuality,
    clearError,
    downloadMedia,
  } = useUrlStore();

  // Video file state
  const {
    file: videoFile,
    path: videoFilePath,
    openFileDialog,
    dubbedVideoPath,
  } = useVideoStore();

  // Task state
  const { translation, transcription, dubbing } = useTaskStore();

  // Subtitle state
  const subStore = useSubStore();
  const hasMountedSubtitles = subStore.order.length > 0;
  // Decouple transcription completion from subtitle presence
  const isTranscriptionDone =
    Boolean(transcription.isCompleted) || hasMountedSubtitles;
  const isTranscribing =
    !!transcription.inProgress &&
    (transcription.id?.startsWith('transcribe-') ?? false);
  const isTranslating =
    !!translation.inProgress &&
    (translation.id?.startsWith('translate-') ?? false);
  const isDubbing =
    !!dubbing.inProgress && (dubbing.id?.startsWith('dub-') ?? false);

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

  // Local UI state for confirm dialog when an SRT is already mounted
  // Replaced local dialog with global modal; see GlobalModals

  return (
    <Section title={t('subtitles.generate')}>
      {/* Global confirmations are rendered via <GlobalModals /> */}

      <UrlCookieBanner />

      {error && <ErrorBanner message={error} onClose={() => clearError()} />}

      <SaveOriginalVideoButton
        downloadComplete={!download.inProgress && download.percent === 100}
        downloadedVideoPath={videoFilePath}
        onSaveOriginalVideo={handleSaveOriginalVideo}
        didDownloadFromUrl={!!download.id}
        inputMode={'file'}
      />
      <SaveDubbedVideoButton
        dubbedVideoPath={dubbedVideoPath}
        onSaveDubbedVideo={handleSaveDubbedVideo}
        disabled={isDubbing}
      />

      {/* Show appropriate panel: only show transcribe panel until transcription completes */}
      {(videoFile || videoFilePath || download.inProgress) && (
        <>
          {!isTranscriptionDone && !isTranslating ? (
            <TranscribeOnlyPanel
              onTranscribe={handleTranscribeOnly}
              isTranscribing={isTranscribing}
              disabled={
                isButtonDisabled || hoursNeeded == null || isMetadataPending
              }
              statusMessage={metadataStatusMessage}
            />
          ) : (
            <SrtMountedPanel
              srtPath={subStore.originalPath}
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
        </>
      )}

      {!videoFilePath && !videoFile && (
        <MediaInputSection
          videoFile={videoFile}
          onOpenFileDialog={openFileDialog}
          isDownloadInProgress={download.inProgress}
          isTranslationInProgress={translation.inProgress}
          urlInput={urlInput}
          setUrlInput={setUrlInput}
          downloadQuality={downloadQuality}
          setDownloadQuality={setDownloadQuality}
          handleProcessUrl={downloadMedia}
        />
      )}
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
          .setError('No SRT file available for translation'),
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
    const currentSegments = subStore.order.map(id => subStore.segments[id]);
    if (currentSegments.length === 0) {
      useUrlStore.getState().setError('No subtitles available for dubbing');
      return;
    }

    const operationId = `dub-${Date.now()}`;
    const videoStoreState = useVideoStore.getState();
    const sourceVideoPath =
      videoStoreState.originalPath ??
      subStore.sourceVideoPath ??
      videoFilePath ??
      videoStoreState.path;

    const dubVoice = useUIStore.getState().dubVoice;

    await executeDubGeneration({
      segments: currentSegments,
      operationId,
      videoPath: sourceVideoPath,
      voice: dubVoice,
      targetLanguage,
    });
  }

  async function handleSaveDubbedVideo() {
    if (!dubbedVideoPath) {
      return;
    }

    const sourceName =
      subStore.sourceVideoPath ?? videoFilePath ?? dubbedVideoPath;
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
}
