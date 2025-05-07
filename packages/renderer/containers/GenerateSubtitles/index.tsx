import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import ApiKeyLock from './ApiKeyLock.js';
import FileInputButton from '../../components/FileInputButton.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import Section from '../../components/Section.js';
import { VideoQuality } from '@shared-types/app';
import { useTranslation } from 'react-i18next';
import GenerateSubtitlesPanel from './GenerateSubtitlesPanel.js';
import ProgressDisplay from './ProgressDisplay.js';
import ErrorBanner from '../../components/ErrorBanner.js';

type ApiKeyStatus = {
  openai: boolean;
} | null;

export default function GenerateSubtitles({
  apiKeyStatus,
  didDownloadFromUrl,
  downloadComplete,
  downloadedVideoPath,
  downloadQuality,
  error,
  inputMode,
  isTranslationInProgress,
  isLoadingKeyStatus,
  isProcessingUrl,
  onGenerateSubtitles,
  onNavigateToSettings,
  onProcessUrl,
  onSaveOriginalVideo,
  onSelectVideoClick,
  onSetDownloadQuality,
  onSetError,
  onSetInputMode,
  onSetTargetLanguage,
  onSetUrlInput,
  onShowOriginalTextChange,
  showOriginalText,
  targetLanguage,
  urlInput,
  videoFile,
  videoFilePath,
  isMergingInProgress,
}: {
  apiKeyStatus: ApiKeyStatus;
  didDownloadFromUrl: boolean;
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  downloadQuality: VideoQuality;
  error: string | null;
  inputMode: 'file' | 'url';
  isTranslationInProgress: boolean;
  isLoadingKeyStatus: boolean;
  isProcessingUrl: boolean;
  onGenerateSubtitles: () => void;
  onNavigateToSettings: (show: boolean) => void;
  onProcessUrl: () => void;
  onSaveOriginalVideo: () => void;
  onSelectVideoClick: () => void;
  onSetDownloadQuality: (quality: VideoQuality) => void;
  onSetError: (error: string | null) => void;
  onSetInputMode: (mode: 'file' | 'url') => void;
  onSetTargetLanguage: (lang: string) => void;
  onSetUrlInput: (url: string) => void;
  onShowOriginalTextChange: (show: boolean) => void;
  showOriginalText: boolean;
  targetLanguage: string;
  urlInput: string;
  videoFile: File | null;
  videoFilePath?: string | null;
  isMergingInProgress: boolean;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (videoFile) {
      const isLocalFileSelection =
        !(videoFile instanceof File) || !(videoFile as any)._originalPath;

      if (isLocalFileSelection) {
        onSetInputMode('file');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoFile]);

  return (
    <Section title={t('subtitles.generate')}>
      <ApiKeyLock
        apiKeyStatus={apiKeyStatus}
        isLoadingKeyStatus={isLoadingKeyStatus}
        onNavigateToSettings={onNavigateToSettings}
      />

      {!isLoadingKeyStatus && apiKeyStatus?.openai && (
        <>
          {error && (
            <ErrorBanner message={error} onClose={() => onSetError('')} />
          )}

          <ProgressDisplay
            downloadComplete={downloadComplete}
            downloadedVideoPath={downloadedVideoPath}
            onSaveOriginalVideo={onSaveOriginalVideo}
            inputMode={inputMode}
            didDownloadFromUrl={didDownloadFromUrl}
          />

          <InputModeToggle
            inputMode={inputMode}
            onSetInputMode={onSetInputMode}
            isTranslationInProgress={isTranslationInProgress}
            isProcessingUrl={isProcessingUrl}
          />

          {inputMode === 'file' && (
            <div
              className={css`
                padding: 13px 20px;
                border: 1px solid ${colors.border};
                border-radius: 6px;
                background-color: ${colors.light};
              `}
            >
              <label
                style={{
                  marginRight: '12px',
                  display: 'inline-block',
                  minWidth: '220px',
                }}
              >
                {t('input.selectVideoAudioFile')}:
              </label>
              <FileInputButton onClick={onSelectVideoClick}>
                {videoFile
                  ? `${t('common.selected')}: ${videoFile.name}`
                  : t('input.selectFile')}
              </FileInputButton>
            </div>
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
                setUrlInput={onSetUrlInput}
                setError={onSetError}
                downloadQuality={downloadQuality}
                setDownloadQuality={onSetDownloadQuality}
                handleProcessUrl={onProcessUrl}
                isProcessingUrl={isProcessingUrl}
                isTranslationInProgress={isTranslationInProgress}
              />
            </div>
          )}

          {videoFile && (
            <GenerateSubtitlesPanel
              targetLanguage={targetLanguage}
              setTargetLanguage={onSetTargetLanguage}
              isTranslationInProgress={isTranslationInProgress}
              showOriginalText={showOriginalText}
              onShowOriginalTextChange={onShowOriginalTextChange}
              videoFile={videoFile}
              videoFilePath={videoFilePath}
              isProcessingUrl={isProcessingUrl}
              handleGenerateSubtitles={onGenerateSubtitles}
              isMergingInProgress={isMergingInProgress}
            />
          )}
        </>
      )}
    </Section>
  );
}
