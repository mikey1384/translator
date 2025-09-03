import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import ProgressDisplay from './ProgressDisplay.js';
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
  executeSrtTranslation,
  startTranscriptionFlow,
} from './utils/subtitleGeneration';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const { targetLanguage, setTargetLanguage } = useUIStore();

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
  } = useVideoStore();

  // Task state
  const { translation, transcription } = useTaskStore();

  // Subtitle state
  const subStore = useSubStore();
  const isTranscriptionDone = Boolean(transcription.isCompleted);
  const isTranscribing =
    !!transcription.inProgress &&
    (transcription.id?.startsWith('transcribe-') ?? false);
  const isTranslating =
    !!translation.inProgress &&
    (translation.id?.startsWith('translate-') ?? false);

  // Custom hooks for business logic (after videoFilePath is declared)
  const { durationSecs, hoursNeeded } = useVideoMetadata(videoFilePath);
  const { isButtonDisabled } = useCreditSystem();

  // Local UI state for confirm dialog when an SRT is already mounted
  // Replaced local dialog with global modal; see GlobalModals

  return (
    <Section title={t('subtitles.generate')}>
      {/* Global confirmations are rendered via <GlobalModals /> */}

      <UrlCookieBanner />

      {error && <ErrorBanner message={error} onClose={() => clearError()} />}

      <ProgressDisplay
        downloadComplete={!download.inProgress && download.percent === 100}
        downloadedVideoPath={videoFilePath}
        onSaveOriginalVideo={handleSaveOriginalVideo}
        didDownloadFromUrl={!!download.id}
        inputMode={'file'}
      />

      {/* Show appropriate panel: only show transcribe panel until transcription completes */}
      {(videoFile || download.inProgress) && (
        <>
          {!isTranscriptionDone && !isTranslating ? (
            <TranscribeOnlyPanel
              onTranscribe={handleTranscribeOnly}
              isTranscribing={isTranscribing}
              disabled={isButtonDisabled || hoursNeeded == null}
            />
          ) : (
            <SrtMountedPanel
              srtPath={subStore.originalPath}
              onTranslate={handleTranslate}
              isTranslating={isTranslating}
              disabled={isButtonDisabled || hoursNeeded == null}
              targetLanguage={targetLanguage}
              onTargetLanguageChange={setTargetLanguage}
            />
          )}
        </>
      )}

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
    });
  }

  async function handleTranslate() {
    const currentSegments = subStore.order.map(id => subStore.segments[id]);
    if (currentSegments.length === 0) {
      useUrlStore.getState().setError('No SRT file available for translation');
      return;
    }

    const operationId = `translate-${Date.now()}`;
    await executeSrtTranslation({
      segments: currentSegments,
      targetLanguage,
      operationId,
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
}
