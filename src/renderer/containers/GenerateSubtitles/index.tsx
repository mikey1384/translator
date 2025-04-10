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

type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

export default function GenerateSubtitles({
  videoFile,
  videoFilePath,
  onSetVideoFile,
  showOriginalText,
  onShowOriginalTextChange,
  apiKeyStatus,
  isLoadingKeyStatus,
  onNavigateToSettings,
  onSelectVideoClick,
  error,
  setError,
  isProcessingUrl,
  progressPercent,
  progressStage,
  downloadComplete,
  downloadedVideoPath,
  handleSaveOriginalVideo,
  didDownloadFromUrl,
  isGenerating,
  urlInput,
  setUrlInput,
  downloadQuality,
  setDownloadQuality,
  onProcessUrl,
  onGenerateSubtitles,
  inputMode,
  setInputMode,
  targetLanguage,
  setTargetLanguage,
}: {
  videoFile: File | null;
  videoFilePath?: string | null;
  onSetVideoFile: (file: File | { name: string; path: string } | null) => void;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
  onSelectVideoClick: () => void;
  error: string | null;
  setError: (error: string | null) => void;
  isProcessingUrl: boolean;
  progressPercent: number;
  progressStage: string;
  downloadComplete: boolean;
  downloadedVideoPath: string | null;
  handleSaveOriginalVideo: () => void;
  didDownloadFromUrl: boolean;
  isGenerating: boolean;
  urlInput: string;
  setUrlInput: (url: string) => void;
  downloadQuality: VideoQuality;
  setDownloadQuality: (quality: VideoQuality) => void;
  onProcessUrl: () => void;
  onGenerateSubtitles: () => void;
  inputMode: 'file' | 'url';
  setInputMode: (mode: 'file' | 'url') => void;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
}) {
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
    <Section title="Generate Subtitles">
      <ApiKeyLock
        apiKeyStatus={apiKeyStatus}
        isLoadingKeyStatus={isLoadingKeyStatus}
        onNavigateToSettings={onNavigateToSettings}
      />

      {!isLoadingKeyStatus &&
        apiKeyStatus?.openai &&
        apiKeyStatus?.anthropic && (
          <>
            {error && <div className={errorMessageStyles}>{error}</div>}

            <ProgressDisplay
              isProcessingUrl={isProcessingUrl}
              progressPercent={progressPercent}
              progressStage={progressStage}
              downloadComplete={downloadComplete}
              downloadedVideoPath={downloadedVideoPath}
              onSaveOriginalVideo={handleSaveOriginalVideo}
              inputMode={inputMode}
              didDownloadFromUrl={didDownloadFromUrl}
            />

            <InputModeToggle
              inputMode={inputMode}
              setInputMode={setInputMode}
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
                  1. Select Video File:{' '}
                </label>
                <FileInputButton onClick={onSelectVideoClick}>
                  {videoFile
                    ? `Selected: ${videoFile.name}`
                    : 'Select Video File'}
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
                  setUrlInput={setUrlInput}
                  onSetVideoFile={onSetVideoFile}
                  setError={setError}
                  downloadQuality={downloadQuality}
                  setDownloadQuality={setDownloadQuality}
                  handleProcessUrl={onProcessUrl}
                  isProcessingUrl={isProcessingUrl}
                  isGenerating={isGenerating}
                />
              </div>
            )}

            {videoFile && (
              <LanguageSelection
                targetLanguage={targetLanguage}
                setTargetLanguage={setTargetLanguage}
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
