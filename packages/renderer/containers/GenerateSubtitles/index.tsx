import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';

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
import MediaInputSection from './components/MediaInputSection.js';

// Custom hooks
import { useVideoMetadata } from './hooks/useVideoMetadata';
import { useCreditSystem } from './hooks/useCreditSystem';

// Components
import CreditWarningBanner from './components/CreditWarningBanner';

// Utilities
import { checkSufficientCredits } from './utils/creditCheck';
import {
  executeSubtitleGeneration,
  validateGenerationInputs,
} from './utils/subtitleGeneration';

export default function GenerateSubtitles() {
  const { t } = useTranslation();

  // UI State
  const {
    targetLanguage,
    showOriginalText,
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
        didDownloadFromUrl={!!download.id}
      />

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

    // Generate subtitles - backend will handle credit deduction on success
    const operationId = `generate-${Date.now()}`;
    await executeSubtitleGeneration({
      videoFile,
      videoFilePath,
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
