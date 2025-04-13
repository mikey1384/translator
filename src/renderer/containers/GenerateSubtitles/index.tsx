import { useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import { errorMessageStyles } from '../../styles.js';
import ApiKeyLock from './ApiKeyLock.js';
import FileInputButton from '../../components/FileInputButton.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import LanguageSelection from './LanguageSelection.js';
import ProgressDisplay from './ProgressDisplay.js';
import GenerateControls from './GenerateControls.js';
import Section from '../../components/Section.js';
import { VideoQuality } from '../../../types/interface.js';
import { useTranslation } from 'react-i18next';

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
  isGenerating,
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
  onSetVideoFile,
  onShowOriginalTextChange,
  progressPercent,
  progressStage,
  showOriginalText,
  targetLanguage,
  urlInput,
  videoFile,
  videoFilePath,
}: {
  apiKeyStatus: ApiKeyStatus;
  didDownloadFromUrl: boolean;
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  downloadQuality: VideoQuality;
  error: string | null;
  inputMode: 'file' | 'url';
  isGenerating: boolean;
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
  onSetVideoFile: (file: File | { name: string; path: string } | null) => void;
  onShowOriginalTextChange: (show: boolean) => void;
  progressPercent: number;
  progressStage: string;
  showOriginalText: boolean;
  targetLanguage: string;
  urlInput: string;
  videoFile: File | null;
  videoFilePath?: string | null;
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
          {error && <div className={errorMessageStyles}>{error}</div>}

          <ProgressDisplay
            isProcessingUrl={isProcessingUrl}
            progressPercent={progressPercent}
            progressStage={progressStage}
            downloadComplete={downloadComplete}
            downloadedVideoPath={downloadedVideoPath}
            onSaveOriginalVideo={onSaveOriginalVideo}
            inputMode={inputMode}
            didDownloadFromUrl={didDownloadFromUrl}
          />

          <InputModeToggle
            inputMode={inputMode}
            onSetInputMode={onSetInputMode}
            isGenerating={isGenerating}
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
                1. {t('input.selectVideoFile')}:
              </label>
              <FileInputButton onClick={onSelectVideoClick}>
                {videoFile
                  ? `${t('common.selected')}: ${videoFile.name}`
                  : t('input.selectVideoFile')}
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
                onSetVideoFile={onSetVideoFile}
                setError={onSetError}
                downloadQuality={downloadQuality}
                setDownloadQuality={onSetDownloadQuality}
                handleProcessUrl={onProcessUrl}
                isProcessingUrl={isProcessingUrl}
                isGenerating={isGenerating}
              />
            </div>
          )}

          {videoFile && (
            <LanguageSelection
              targetLanguage={targetLanguage}
              setTargetLanguage={onSetTargetLanguage}
              isGenerating={isGenerating}
              showOriginalText={showOriginalText}
              onShowOriginalTextChange={onShowOriginalTextChange}
            />
          )}

          {videoFile && (
            <GenerateControls
              videoFile={videoFile}
              videoFilePath={videoFilePath}
              isGenerating={isGenerating}
              isProcessingUrl={isProcessingUrl}
              handleGenerateSubtitles={onGenerateSubtitles}
            />
          )}
        </>
      )}
    </Section>
  );
}
