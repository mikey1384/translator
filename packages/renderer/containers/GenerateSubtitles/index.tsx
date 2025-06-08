import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import Section from '../../components/Section.js';
import { useTranslation } from 'react-i18next';
import GenerateSubtitlesPanel from './GenerateSubtitlesPanel.js';
import ProgressDisplay from './ProgressDisplay.js';
import ErrorBanner from '../../components/ErrorBanner.js';
import { useUIStore, useVideoStore, useTaskStore } from '../../state';
import { useUrlStore } from '../../state/url-store';
import * as FileIPC from '../../ipc/file';
import * as SystemIPC from '../../ipc/system';
import UrlCookieBanner from './UrlCookieBanner';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';

// Components
import CreditWarningBanner from './components/CreditWarningBanner';
import FileInputSection from './components/FileInputSection';

// Utilities
import {
  validateAndReserveCredits,
  refundCreditsIfNeeded,
  checkSufficientCredits,
} from './utils/creditOperations';
import {
  executeSubtitleGeneration,
  validateGenerationInputs,
} from './utils/subtitleGeneration';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const {
    inputMode,
    targetLanguage,
    showOriginalText,
    setInputMode,
    setTargetLanguage,
    setShowOriginalText,
    toggleSettings,
  } = useUIStore();

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
  const { translation, merge } = useTaskStore();

  // Custom hooks for business logic (after videoFilePath is declared)
  const { durationSecs, hoursNeeded, costStr } =
    useVideoMetadata(videoFilePath);
  const { showCreditWarning, isButtonDisabled, refreshCreditState } =
    useCreditSystem();

  // Auto-set input mode when file is selected
  useEffect(() => {
    if (videoFile) {
      const isLocalFileSelection =
        !(videoFile instanceof File) || !(videoFile as any)._originalPath;

      if (isLocalFileSelection) {
        setInputMode('file');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFile]);

  return (
    <Section title={t('subtitles.generate')}>
      {showCreditWarning && (
        <CreditWarningBanner onSettingsClick={() => toggleSettings(true)} />
      )}

      <UrlCookieBanner />

      {error && <ErrorBanner message={error} onClose={() => clearError()} />}

      <ProgressDisplay
        downloadComplete={!download.inProgress && download.percent === 100}
        downloadedVideoPath={videoFilePath}
        onSaveOriginalVideo={handleSaveOriginalVideo}
        inputMode={inputMode}
        didDownloadFromUrl={!!download.id}
      />

      <InputModeToggle
        inputMode={inputMode}
        onSetInputMode={setInputMode}
        isTranslationInProgress={translation.inProgress}
        isProcessingUrl={download.inProgress}
      />

      {inputMode === 'file' && (
        <FileInputSection
          videoFile={videoFile}
          onOpenFileDialog={openFileDialog}
          isDownloadInProgress={download.inProgress}
          isTranslationInProgress={translation.inProgress}
        />
      )}

      {inputMode === 'url' && (
        <div
          className={css`
            padding: 20px;
            border: 1px solid ${colors.border};
            border-radius: 6px;
            background-color: ${colors.light};
          `}
        >
          <UrlInputSection
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            downloadQuality={downloadQuality}
            setDownloadQuality={setDownloadQuality}
            handleProcessUrl={downloadMedia}
            isProcessingUrl={download.inProgress}
            isTranslationInProgress={translation.inProgress}
          />
        </div>
      )}

      {videoFile && (
        <GenerateSubtitlesPanel
          targetLanguage={targetLanguage}
          setTargetLanguage={setTargetLanguage}
          isTranslationInProgress={translation.inProgress}
          showOriginalText={showOriginalText}
          onShowOriginalTextChange={setShowOriginalText}
          videoFile={videoFile}
          videoFilePath={videoFilePath}
          isProcessingUrl={download.inProgress}
          handleGenerateSubtitles={handleGenerateSubtitles}
          isMergingInProgress={merge.inProgress}
          disabledKey={isButtonDisabled || hoursNeeded == null}
        />
      )}
    </Section>
  );

  async function handleGenerateSubtitles() {
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

    // Reserve credits if needed
    const creditResult = await validateAndReserveCredits(
      hoursNeeded!,
      refreshCreditState
    );

    if (!creditResult.success) {
      await SystemIPC.showMessage(
        t('generateSubtitles.notEnoughCredits') ||
          creditResult.error ||
          t('common.error.creditReservationFailed')
      );
      return;
    }

    // Generate subtitles
    const operationId = `generate-${Date.now()}`;
    const result = await executeSubtitleGeneration({
      videoFile,
      videoFilePath,
      targetLanguage,
      operationId,
    });

    // Handle refunds if generation failed
    if (!result.success) {
      await refundCreditsIfNeeded(hoursNeeded!);
    }
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
