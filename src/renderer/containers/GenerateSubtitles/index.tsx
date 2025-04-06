import { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import Section from '../../components/Section.js';
import { colors } from '../../styles.js';
import { VideoQuality } from '../../../services/url-processor.js';
import { errorMessageStyles } from '../../styles.js';
import ApiKeyLock from './ApiKeyLock.js';
import FileInputSection from './FileInputSection.js';
import UrlInputSection from './UrlInputSection.js';
import InputModeToggle from './InputModeToggle.js';
import LanguageSelection from './LanguageSelection.js';
import ProgressDisplay from './ProgressDisplay.js';
import GenerateControls from './GenerateControls.js';

type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

interface GenerateSubtitlesProps {
  videoFile: File | null;
  videoFilePath?: string | null;
  onSetVideoFile: (file: File | any | null) => void;
  onSubtitlesGenerated: (subtitles: string) => void;
  showOriginalText: boolean;
  onShowOriginalTextChange: (show: boolean) => void;
  apiKeyStatus: ApiKeyStatus;
  isLoadingKeyStatus: boolean;
  onNavigateToSettings: (show: boolean) => void;
  subtitleSegments: { start: number; end: number; text: string }[];
  secondsToSrtTime: (seconds: number) => string;
}

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
  subtitleSegments,
  secondsToSrtTime,
}: GenerateSubtitlesProps) {
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
  const progressCleanupRef = useRef<(() => void) | null>(null);
  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');

  useEffect(() => {
    return () => {
      progressCleanupRef.current?.();
    };
  }, []);

  return (
    <Section title="1. Select Video Source">
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
                <FileInputSection
                  videoFile={videoFile}
                  handleFileSelectClick={handleFileSelectClick}
                />
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
                  handleProcessUrl={handleProcessUrl}
                  isProcessingUrl={isProcessingUrl}
                  isGenerating={isGenerating}
                />
              </div>
            )}

            {videoFile && (
              <Section title="2. Select Output Language" isSubSection>
                <LanguageSelection
                  targetLanguage={targetLanguage}
                  setTargetLanguage={setTargetLanguage}
                  isGenerating={isGenerating}
                  showOriginalText={showOriginalText}
                  onShowOriginalTextChange={onShowOriginalTextChange}
                />
              </Section>
            )}

            {videoFile && (
              <Section title="3. Generate Subtitles" isSubSection>
                <GenerateControls
                  videoFile={videoFile}
                  videoFilePath={videoFilePath}
                  isGenerating={isGenerating}
                  isProcessingUrl={isProcessingUrl}
                  handleGenerateSubtitles={handleGenerateSubtitles}
                  subtitleSegments={subtitleSegments}
                  handleSaveSubtitles={handleSaveSubtitles}
                />
              </Section>
            )}
          </>
        )}
    </Section>
  );

  async function handleProcessUrl() {
    if (!urlInput || !window.electron) {
      setError('Please enter a valid video URL');
      return;
    }

    setError('');
    setIsProcessingUrl(true);
    setProgressPercent(0);
    setProgressStage('Initializing...');
    setDownloadComplete(false);
    setDownloadedVideoPath(null);
    onSetVideoFile(null);
    console.log(`Processing URL: ${urlInput}`);

    progressCleanupRef.current?.();

    try {
      progressCleanupRef.current = window.electron.onProcessUrlProgress(
        progress => {
          setProgressPercent(progress.percent ?? progressPercent);
          setProgressStage(progress.stage ?? progressStage);
          if (progress.error) {
            setError(`Error during processing: ${progress.error}`);
            setIsProcessingUrl(false);
          }
        }
      );

      const result = await window.electron.processUrl({
        url: urlInput,
        quality: downloadQuality,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      console.log('Video download successful:', result);

      const videoPath = result.videoPath || result.filePath;

      if (!videoPath || !result.filename) {
        throw new Error(
          'Downloaded video information is incomplete (missing path or filename).'
        );
      }

      setProgressStage('Download complete! Reading video data...');
      setProgressPercent(100);

      setDownloadComplete(true);
      setDownloadedVideoPath(videoPath);

      try {
        const fileContentResult =
          await window.electron.readFileContent(videoPath);

        if (!fileContentResult.success || !fileContentResult.data) {
          throw new Error(
            fileContentResult.error ||
              'Failed to read downloaded video content.'
          );
        }

        const blob = new Blob([fileContentResult.data], { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);

        const videoFileObj = new File([blob], result.filename, {
          type: 'video/mp4',
        });

        (videoFileObj as any)._blobUrl = blobUrl;
        (videoFileObj as any)._originalPath = videoPath;

        setProgressStage('Setting up video...');

        console.log(
          '[GenerateSubtitles] Calling onSetVideoFile with Blob-based file object:',
          {
            name: videoFileObj.name,
            size: videoFileObj.size,
            _blobUrl: blobUrl,
          }
        );
        onSetVideoFile(videoFileObj);

        setUrlInput('');
      } catch (fileError) {
        console.error('Error reading video file:', fileError);

        if (result.fileUrl) {
          console.log('Using fileUrl as fallback:', result.fileUrl);

          const fileData = {
            name: result.filename,
            path: videoPath,
            size: result.size || 0,
            type: 'video/mp4',
            fileUrl: result.fileUrl,
          };

          onSetVideoFile(fileData as any);
          setUrlInput('');
        } else {
          throw new Error(
            'Could not read video file and no fileUrl was provided as fallback'
          );
        }
      }
    } catch (err: any) {
      console.error('Error processing URL or reading file:', err);
      setError(`Error processing URL: ${err.message || err}`);
      setProgressStage('Error');
      setProgressPercent(0);
      setDownloadComplete(false);
      setDownloadedVideoPath(null);
    } finally {
      setIsProcessingUrl(false);

      progressCleanupRef.current?.();
      progressCleanupRef.current = null;
    }
  }

  async function handleGenerateSubtitles() {
    if ((!videoFile && !videoFilePath) || !window.electron) {
      setError('Please select a video file first');
      return;
    }

    try {
      setError('');
      setIsGenerating(true);

      const options: any = {
        targetLanguage,
        streamResults: true,
      };

      if (videoFilePath) {
        options.videoPath = videoFilePath;
        delete options.videoFile;
      } else if (videoFile) {
        options.videoFile = videoFile;
      }
      console.log(
        '[GenerateSubtitles] handleGenerateSubtitles: Final Options for IPC:',
        {
          videoPath: options.videoPath,
          hasVideoFileObject: !!options.videoFile,
          videoFileName: options.videoFile?.name,
          videoFileSize: options.videoFile?.size,
          passedVideoFilePathProp: videoFilePath,
        }
      );

      console.log('Calling window.electron.generateSubtitles with:', {
        videoPath: options.videoPath,
        videoFile: options.videoFile
          ? {
              name: options.videoFile.name,
              size: options.videoFile.size,
              type: options.videoFile.type,
            }
          : undefined,
      });

      const result = await window.electron.generateSubtitles(options);

      if (result.error) {
        throw new Error(result.error);
      }
    } catch (err: any) {
      console.error('Error generating subtitles:', err);
      setError(`Error generating subtitles: ${err.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleFileSelectClick() {
    console.log('handleFileSelectClick CALLED at:', new Date().toISOString());
    setError('');
    if (!window.electron?.openFile) {
      console.error('Electron openFile API is not available.');
      setError('Error: Cannot open file dialog.');
      return;
    }
    try {
      const result = await window.electron.openFile({
        filters: [
          {
            name: 'Video Files',
            extensions: ['mp4', 'mov', 'mkv', 'avi', 'webm'],
          },
        ],
        title: 'Select Video File',
      });

      if (result.canceled || !result.filePaths?.length) {
        console.log('Video selection cancelled.');
        return;
      }

      const filePath = result.filePaths[0];
      console.log('Selected video file path via Electron:', filePath);

      const fileData = {
        name: filePath.split(/[\\/]/).pop() || 'video.mp4',
        path: filePath,
        size: 0,
        type: '',
      };

      onSetVideoFile(fileData as any);
      setUrlInput('');
      setInputMode('file');
    } catch (error: any) {
      console.error('Error opening video file with Electron:', error);
      setError(`Error selecting file: ${error.message || error}`);
    }
  }

  async function handleSaveSubtitles() {
    if (
      !subtitleSegments ||
      subtitleSegments.length === 0 ||
      !window.electron
    ) {
      setError('No subtitles to save');
      return;
    }

    try {
      const srtContent = subtitleSegments
        .map(
          (seg, index) =>
            `${index + 1}\n${secondsToSrtTime(seg.start)} --> ${secondsToSrtTime(seg.end)}\n${seg.text}`
        )
        .join('\n\n');

      const result = await window.electron.saveFile({
        content: srtContent,
        defaultPath: `subtitles_${Date.now()}.srt`,
        filters: [{ name: 'Subtitle File', extensions: ['srt'] }],
      });

      if (result.error) {
        throw new Error(result.error);
      }

      window.electron.showMessage(`Subtitles saved to: ${result.filePath}`);
    } catch (err: any) {
      setError(`Error saving subtitles: ${err.message || err}`);
    }
  }

  async function handleSaveOriginalVideo() {
    if (!downloadedVideoPath) {
      setError('Downloaded video path not found.');
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
        if (saveDialogResult.error.includes('canceled')) {
          setError('');
          return;
        } else {
          throw new Error(`Failed to get save path: ${saveDialogResult.error}`);
        }
      }

      if (!saveDialogResult.filePath) {
        setError('Save path was not selected.');
        return;
      }

      const destinationPath = saveDialogResult.filePath;

      setError('');
      const copyResult = await window.electron.copyFile(
        downloadedVideoPath,
        destinationPath
      );

      if (copyResult.error) {
        throw new Error(`Failed to copy video: ${copyResult.error}`);
      }

      window.electron.showMessage(`Video saved to: ${destinationPath}`);
    } catch (err: any) {
      console.error('Error copying original video:', err);
      setError(`Error saving video: ${err.message || err}`);
    }
  }
}
