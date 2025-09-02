import { useState } from 'react';
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
import { buildSrt } from '../../../shared/helpers';
import UrlCookieBanner from './UrlCookieBanner';
import MediaInputSection from './components/MediaInputSection.js';
import TranscribeOnlyPanel from './components/TranscribeOnlyPanel.js';
import ConfirmReplaceSrtDialog from './components/ConfirmReplaceSrtDialog.js';
import SrtMountedPanel from './components/SrtMountedPanel.js';
import SrtLoadedPanel from './components/SrtLoadedPanel.js';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';

// Components
import CreditWarningBanner from './components/CreditWarningBanner';

// Utilities
import { checkSufficientCredits } from './utils/creditCheck';
import {
  executeSubtitleGeneration,
  executeSrtTranslation,
  validateGenerationInputs,
} from './utils/subtitleGeneration';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const { toggleSettings, targetLanguage, setTargetLanguage } = useUIStore();

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
  const hasMountedSrt = Boolean(
    subStore.originalPath && subStore.order.length > 0
  );
  const isTranscriptionDone = Boolean(transcription.isCompleted);
  const isTranscribing =
    !!transcription.inProgress &&
    (transcription.id?.startsWith('transcribe-') ?? false);
  const isTranslating =
    !!translation.inProgress &&
    (translation.id?.startsWith('translate-') ?? false);

  // Custom hooks for business logic (after videoFilePath is declared)
  const { durationSecs, hoursNeeded } = useVideoMetadata(videoFilePath);
  const { showCreditWarning, isButtonDisabled } = useCreditSystem();

  // Local UI state for confirm dialog when an SRT is already mounted
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);

  return (
    <Section title={t('subtitles.generate')}>
      <ConfirmReplaceSrtDialog
        open={showReplaceDialog}
        onCancel={() => setShowReplaceDialog(false)}
        onDiscardAndTranscribe={async () => {
          setShowReplaceDialog(false);
          await clearMountedSrt();
          await proceedTranscribe();
        }}
        onSaveAndTranscribe={async () => {
          const saved = await saveMountedSrt();
          if (!saved) {
            // Treat cancel of save dialog as cancel transcription
            setShowReplaceDialog(false);
            return;
          }
          setShowReplaceDialog(false);
          await clearMountedSrt();
          await proceedTranscribe();
        }}
      />
      {showCreditWarning && (
        <CreditWarningBanner onSettingsClick={() => toggleSettings(true)} />
      )}

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

      {/* If an SRT was manually loaded (no video mounted), show a dedicated translate panel */}
      {!videoFile && !download.inProgress && hasMountedSrt && (
        <SrtLoadedPanel
          srtPath={subStore.originalPath}
          onTranslate={handleTranslate}
          isTranslating={isTranslating}
          disabled={isButtonDisabled}
          targetLanguage={targetLanguage}
          onTargetLanguageChange={setTargetLanguage}
        />
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
    const hasMounted = subStore.order.length > 0;
    if (hasMounted) {
      setShowReplaceDialog(true);
      return;
    }

    await proceedTranscribe();
  }

  async function proceedTranscribe() {
    // Validate inputs
    const validation = validateGenerationInputs(
      videoFile,
      videoFilePath,
      durationSecs,
      hoursNeeded
    );

    if (!validation.isValid) {
      if (validation.errorMessage === 'Please select a video') {
        useUrlStore.getState().setError(validation.errorMessage);
      } else {
        SystemIPC.showMessage(
          t('generateSubtitles.calculatingCost') ||
            validation.errorMessage ||
            t('common.error.unexpected')
        );
      }
      return;
    }

    // Guard: Check if we have sufficient credits before starting
    if (durationSecs) {
      const creditCheck = checkSufficientCredits(durationSecs);
      if (!creditCheck.hasSufficientCredits) {
        await SystemIPC.showMessage(
          `Not enough credits. This video needs ~${creditCheck.estimatedCredits.toLocaleString()} credits, but you only have ${creditCheck.currentBalance.toLocaleString()}.`
        );
        return;
      }
    }

    // Generate transcription only (no translation)
    const operationId = `transcribe-${Date.now()}`;
    await executeSubtitleGeneration({
      videoFile,
      videoFilePath,
      targetLanguage: 'original', // Use 'original' for transcription-only
      operationId,
    });
  }

  async function clearMountedSrt() {
    // Clear subtitles and reset tasks similar to previous video change behavior
    useSubStore.setState({
      segments: {},
      order: [],
      activeId: null,
      playingId: null,
      originalPath: null,
    });
    useTaskStore.getState().setTranslation({
      id: null,
      stage: '',
      percent: 0,
      inProgress: false,
      batchStartIndex: undefined,
    });
    useTaskStore.getState().setTranscription({
      id: null,
      stage: '',
      percent: 0,
      inProgress: false,
    });
  }

  async function saveMountedSrt(): Promise<boolean> {
    const segments = subStore.order.map(id => subStore.segments[id]);
    if (segments.length === 0) return true;
    const showOriginal = useUIStore.getState().showOriginalText;
    const mode = showOriginal ? 'dual' : 'translation';
    const srtContent = buildSrt({ segments, mode });
    try {
      const { filePath, error } = await FileIPC.save({
        title: t('dialogs.saveSrtFileAs'),
        defaultPath: 'subtitles.srt',
        content: srtContent,
        filters: [
          { name: t('common.fileFilters.srtFiles'), extensions: ['srt'] },
        ],
      } as any);
      if (error) {
        if (!String(error).includes('canceled')) {
          await SystemIPC.showMessage(String(error));
        }
        return false;
      }
      if (!filePath) return false;
      return true;
    } catch (err) {
      console.error('[GenerateSubtitles] Failed to save mounted SRT:', err);
      return false;
    }
  }

  async function handleTranslate() {
    const currentSegments = subStore.order.map(id => subStore.segments[id]);
    if (currentSegments.length === 0) {
      useUrlStore.getState().setError('No SRT file available for translation');
      return;
    }

    if (durationSecs) {
      const creditCheck = checkSufficientCredits(durationSecs);
      if (!creditCheck.hasSufficientCredits) {
        await SystemIPC.showMessage(
          `Not enough credits. This translation needs ~${creditCheck.estimatedCredits.toLocaleString()} credits, but you only have ${creditCheck.currentBalance.toLocaleString()}.`
        );
        return;
      }
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
