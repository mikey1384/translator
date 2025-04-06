import { useState, useEffect } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import { VideoQuality } from '../../../services/url-processor.js';
import { errorMessageStyles } from '../../styles.js';
import ApiKeyLock from './ApiKeyLock.js';
import FileInputButton from '../../components/FileInputButton.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import LanguageSelection from './LanguageSelection.js';
import ProgressDisplay from './ProgressDisplay.js';
import GenerateControls from './GenerateControls.js';
import Section from '../../components/Section.js';
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

const inputSectionStyles = css`
  padding: 20px;
  border: 1px solid ${colors.border};
  border-radius: 6px;
  background-color: ${colors.light};
`;

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
}) {
  const [targetLanguage, setTargetLanguage] = useState<string>('original');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [urlInput, setUrlInput] = useState<string>('');
  const [isProcessingUrl, setIsProcessingUrl] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStage, setProgressStage] = useState<string>('');
  const [downloadComplete, setDownloadComplete] = useState<boolean>(false);
  const [downloadedVideoPath, setDownloadedVideoPath] = useState<string | null>(
    null
  );
  const [downloadQuality, setDownloadQuality] = useState<VideoQuality>('mid');
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');

  useEffect(() => {
    setError('');
  }, [inputMode]);

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
              handleSaveOriginalVideo={handleSaveOriginalVideo}
            />

            <InputModeToggle
              inputMode={inputMode}
              setInputMode={setInputMode}
              isGenerating={isGenerating}
              isProcessingUrl={isProcessingUrl}
            />

            {inputMode === 'file' && (
              <div className={inputSectionStyles}>
                <label
                  style={{
                    marginRight: '12px',
                    lineHeight: '32px',
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
              <div className={inputSectionStyles}>
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

  async function onProcessUrl() {
    if (!urlInput || !window.electron) {
      setError('Please enter a valid video URL');
      return;
    }
    resetUrlStates();
    const unlisten = window.electron.onProcessUrlProgress(updateUrlProgress);

    try {
      const result = await window.electron.processUrl({
        url: urlInput,
        quality: downloadQuality,
      });
      if (result.error) throw new Error(result.error);

      const videoPath = result.videoPath || result.filePath;
      if (!videoPath || !result.filename) {
        throw new Error('Downloaded video info incomplete');
      }

      finishUrlDownload(result, videoPath);
      setUrlInput('');
    } catch (err: any) {
      handleUrlError(err);
    } finally {
      setIsProcessingUrl(false);
      unlisten?.();
    }
  }

  function resetUrlStates() {
    setError('');
    setIsProcessingUrl(true);
    setProgressPercent(0);
    setProgressStage('Initializing...');
    setDownloadComplete(false);
    setDownloadedVideoPath(null);
    onSetVideoFile(null);
  }

  function updateUrlProgress(progress: any) {
    setProgressPercent(progress.percent ?? 0);
    setProgressStage(progress.stage ?? '');
    if (progress.error) {
      setError(`Error during processing: ${progress.error}`);
      setIsProcessingUrl(false);
    }
  }

  async function finishUrlDownload(result: any, videoPath: string) {
    setProgressStage('Download complete! Reading video data...');
    setProgressPercent(100);
    setDownloadComplete(true);
    setDownloadedVideoPath(videoPath);

    try {
      const fileContentResult =
        await window.electron.readFileContent(videoPath);
      if (!fileContentResult.success || !fileContentResult.data) {
        throw new Error(fileContentResult.error || 'Failed to read video file');
      }

      const blob = new Blob([fileContentResult.data], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      const videoFileObj = new File([blob], result.filename, {
        type: 'video/mp4',
      });
      (videoFileObj as any)._blobUrl = blobUrl;
      (videoFileObj as any)._originalPath = videoPath;

      setProgressStage('Setting up video...');
      onSetVideoFile(videoFileObj);
    } catch (fileError) {
      console.error('Error reading video file:', fileError);
      if (result.fileUrl) {
        const fallback = {
          name: result.filename,
          path: videoPath,
          size: result.size || 0,
          type: 'video/mp4',
          fileUrl: result.fileUrl,
        };
        onSetVideoFile(fallback as any);
      } else {
        throw new Error('Could not read video. No fallback was provided');
      }
    }
  }

  function handleUrlError(err: any) {
    console.error('Error processing URL:', err);
    setError(`Error processing URL: ${err.message || err}`);
    setProgressStage('Error');
    setProgressPercent(0);
    setDownloadComplete(false);
    setDownloadedVideoPath(null);
  }

  async function onGenerateSubtitles() {
    if ((!videoFile && !videoFilePath) || !window.electron) {
      setError('Please select a video file first');
      return;
    }
    setError('');
    setIsGenerating(true);
    try {
      const options = buildGenerateOptions();
      const result = await window.electron.generateSubtitles(options);
      if (result.error) throw new Error(result.error);
    } catch (err: any) {
      console.error('Error generating subtitles:', err);
      setError(`Error generating subtitles: ${err.message || err}`);
    } finally {
      setIsGenerating(false);
    }

    function buildGenerateOptions() {
      const opts: any = { targetLanguage, streamResults: true };
      if (videoFilePath) {
        opts.videoPath = videoFilePath;
      } else if (videoFile) {
        opts.videoFile = videoFile;
      }
      return opts;
    }
  }

  async function handleSaveOriginalVideo() {
    if (!downloadedVideoPath) {
      setError('No downloaded video path found.');
      return;
    }

    const suggestedName = downloadedVideoPath.includes('ytdl_')
      ? downloadedVideoPath.substring(downloadedVideoPath.indexOf('ytdl_') + 5)
      : 'downloaded_video.mp4';

    try {
      const saveDialogResult = await window.electron.saveFile({
        content: '',
        defaultPath: suggestedName,
        title: 'Save Downloaded Video As',
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mkv', 'webm'] }],
      });
      if (saveDialogResult.error) {
        if (!saveDialogResult.error.includes('canceled')) {
          throw new Error(saveDialogResult.error);
        }
        setError('');
        return;
      }
      if (!saveDialogResult.filePath) {
        setError('No save path selected.');
        return;
      }

      const copyRes = await window.electron.copyFile(
        downloadedVideoPath,
        saveDialogResult.filePath
      );
      if (copyRes.error) throw new Error(copyRes.error);

      window.electron.showMessage(`Video saved: ${saveDialogResult.filePath}`);
    } catch (err: any) {
      console.error('Error saving video:', err);
      setError(`Error saving video: ${err.message || err}`);
    }
  }
}
