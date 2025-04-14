import { useState, useRef, useEffect } from 'react';
import BackToTopButton from '../components/BackToTopButton.js';
import SettingsPage from '../containers/SettingsPage.js';
import VideoPlayer from '../components/VideoPlayer/index.js';
import { EditSubtitles } from '../containers/EditSubtitles/index.js';
import GenerateSubtitles from '../containers/GenerateSubtitles/index.js';
import MergingProgressArea from '../components/ProgressAreas/MergingProgressArea.js';
import TranslationProgressArea from '../components/ProgressAreas/TranslationProgressArea.js';
import LogoDisplay from '../components/LogoDisplay.js';
import FindBar from '../components/FindBar.js';
import LanguageSwitcher from '../components/LanguageSwitcher.js';
import { SrtSegment } from '../../types/interface.js';
import { VideoQuality } from '../../services/url-processor.js';
import { useTranslation } from 'react-i18next';

import { parseSrt, secondsToSrtTime } from '../../shared/helpers/index.js';
import { useApiKeyStatus } from './hooks/useApiKeyStatus.js';
import { useSubtitleState } from './hooks/subtitles/useSubtitleState.js';
import { useSubtitleActions } from './hooks/subtitles/useSubtitleActions.js';
import { useVideoState } from './hooks/video/useVideoState.js';

import { pageWrapperStyles, containerStyles, colors } from '../styles.js';
import { css } from '@emotion/css';
import { useVideoActions } from './hooks/video/useVideoActions.js';
import subtitleRendererClient, {
  RenderSubtitlesOptions,
} from '../clients/subtitle-renderer-client.js';

const headerRightGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 15px;
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px;
`;

const settingsButtonStyles = css`
  padding: 8px 15px;
  font-size: 0.9em;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  border: 1px solid ${colors.border};
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease;
  box-shadow: none;

  &:hover {
    background-color: ${colors.light};
    border-color: ${colors.primary};
  }
`;

const mainContentStyles = css`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  flex-grow: 1;
  position: relative;
`;

function AppContent() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>('');
  const [isProcessingUrl, setIsProcessingUrl] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [downloadComplete, setDownloadComplete] = useState<boolean>(false);
  const [downloadedVideoPath, setDownloadedVideoPath] = useState<string | null>(
    null
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [progressStage, setProgressStage] = useState<string>('');
  const [downloadQuality, setDownloadQuality] = useState<VideoQuality>('mid');
  const [didDownloadFromUrl, setDidDownloadFromUrl] = useState<boolean>(false);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<string>('original');

  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');
  const [mergeOperationId, setMergeOperationId] = useState<string | null>(null);

  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [matchedIndices, setMatchedIndices] = useState<number[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

  const { apiKeyStatus, isLoadingKeyStatus, fetchKeyStatus } =
    useApiKeyStatus();

  const {
    subtitleSegments,
    isTranslationInProgress,
    translationProgress,
    translationStage,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    translationOperationId,
    setIsTranslationInProgress,
    setSubtitleSegments,
    setSubtitleSourceId,
  } = useSubtitleState(showOriginalText);

  const {
    videoFile,
    videoFilePath,
    isPlaying,
    isMergingInProgress,
    originalSrtFilePath,
    saveError,
    setIsPlaying,
    setIsMergingInProgress,
    setVideoFile,
    setVideoPlayerRef,
    setOriginalSrtFilePath,
    setSaveError,
    videoPlayerRef,
    setVideoFilePath,
  } = useVideoState();

  const { handleSaveSrt, handleSaveEditedSrtAs, handleSetSubtitleSegments } =
    useSubtitleActions({
      subtitles: subtitleSegments,
      originalSrtFilePath: originalSrtFilePath,
      setSaveError,
      onSaveAsComplete: handleSaveAsComplete,
      setSubtitleSegments,
      setSubtitleSourceId,
    });

  const {
    handleSetVideoFile,
    handleSrtFileLoaded,
    handleTogglePlay,
    handleVideoPlayerReady,
  } = useVideoActions({
    setVideoFile,
    setVideoUrl,
    setVideoFilePath,
    setIsPlaying,
    setIsMergingInProgress,
    setIsTranslationInProgress,
    setMergeProgress,
    setMergeStage,
    setMergeOperationId,
    setOriginalSrtFilePath,
    setSaveError,
    setVideoPlayerRef,
    videoUrl,
  });

  const mainContentRef = useRef<HTMLDivElement>(null);
  const editSubtitlesRef = useRef<HTMLDivElement>(null);
  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
    scrollToSubtitleIndex: (index: number) => void;
  }>({
    scrollToCurrentSubtitle: () => {},
    scrollToSubtitleIndex: (_index: number) => {},
  });

  const [videoMetadata, setVideoMetadata] = useState<{
    duration: number;
    width: number;
    height: number;
    frameRate: number;
  } | null>(null);

  useEffect(() => {
    if (!searchText) {
      setMatchedIndices([]);
      setActiveMatchIndex(0);
      return;
    }

    const lowerSearch = searchText.toLowerCase();
    const newMatches = subtitleSegments
      .map((seg, idx) =>
        seg.text.toLowerCase().includes(lowerSearch) ? idx : -1
      )
      .filter(idx => idx !== -1);

    setMatchedIndices(newMatches);
    setActiveMatchIndex(0);
  }, [searchText, subtitleSegments]);

  useEffect(() => {
    if (matchedIndices.length > 0 && isFindBarVisible) {
      const subIndex = matchedIndices[activeMatchIndex];
      editSubtitlesMethodsRef.current?.scrollToSubtitleIndex(subIndex);
    }
  }, [activeMatchIndex, matchedIndices, isFindBarVisible]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'f' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        console.log('[AppContent] Cmd/Ctrl+F detected, showing FindBar.');
        setIsFindBarVisible(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFindBarVisible]);

  return (
    <div className={pageWrapperStyles}>
      {videoUrl && <div style={{ height: 'CALC(35vh + 2rem)' }} />}
      <FindBar
        isVisible={isFindBarVisible}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        matchCount={matchedIndices.length}
        activeMatchIndex={activeMatchIndex}
        onFindNext={handleFindNext}
        onFindPrev={handleFindPrev}
        onClose={handleCloseFindBar}
        onReplaceAll={handleReplaceAll}
      />
      <div className={containerStyles}>
        <div className={headerStyles}>
          {showSettings ? (
            <button
              className={settingsButtonStyles}
              onClick={handleBackFromSettings}
            >
              {t('common.backToApp')}
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <LogoDisplay />
              <LanguageSwitcher />
            </div>
          )}
          <div className={headerRightGroupStyles}>
            {!showSettings && (
              <button
                className={settingsButtonStyles}
                onClick={() => handleToggleSettings(true)}
              >
                {t('common.settings')}
              </button>
            )}
          </div>
        </div>

        {showSettings ? (
          <SettingsPage
            apiKeyStatus={apiKeyStatus}
            isLoadingStatus={isLoadingKeyStatus}
          />
        ) : (
          <>
            {videoUrl && (
              <VideoPlayer
                videoUrl={videoUrl}
                subtitles={subtitleSegments}
                onPlayerReady={handleVideoPlayerReady}
                onSelectVideoClick={handleSelectVideoClick}
                onProcessUrl={onProcessUrl}
                onSrtLoaded={handleSetSubtitleSegments}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
                onSetUrlInput={setUrlInput}
                urlInput={urlInput}
                isProgressBarVisible={
                  isMergingInProgress || isTranslationInProgress
                }
              />
            )}

            <div ref={mainContentRef} className={mainContentStyles}>
              <GenerateSubtitles
                apiKeyStatus={apiKeyStatus}
                didDownloadFromUrl={didDownloadFromUrl}
                downloadComplete={downloadComplete}
                downloadedVideoPath={downloadedVideoPath}
                downloadQuality={downloadQuality}
                error={error}
                inputMode={inputMode}
                isGenerating={isGenerating}
                isLoadingKeyStatus={isLoadingKeyStatus}
                isProcessingUrl={isProcessingUrl}
                onGenerateSubtitles={onGenerateSubtitles}
                onNavigateToSettings={handleToggleSettings}
                onProcessUrl={onProcessUrl}
                onSaveOriginalVideo={handleSaveOriginalVideo}
                onSelectVideoClick={handleSelectVideoClick}
                onSetDownloadQuality={setDownloadQuality}
                onSetError={setError}
                onSetInputMode={setInputMode}
                onSetTargetLanguage={setTargetLanguage}
                onSetUrlInput={setUrlInput}
                onSetVideoFile={handleSetVideoFile}
                onShowOriginalTextChange={setShowOriginalText}
                progressPercent={progressPercent}
                progressStage={progressStage}
                showOriginalText={showOriginalText}
                targetLanguage={targetLanguage}
                urlInput={urlInput}
                videoFile={videoFile}
                videoFilePath={videoFilePath}
              />

              <div ref={editSubtitlesRef} id="edit-subtitles-section">
                <EditSubtitles
                  videoFile={videoFile}
                  videoUrl={videoUrl}
                  videoFilePath={videoFilePath}
                  isPlaying={isPlaying}
                  onSetIsPlaying={setIsPlaying}
                  secondsToSrtTime={secondsToSrtTime}
                  parseSrt={parseSrt}
                  subtitles={subtitleSegments}
                  videoPlayerRef={videoPlayerRef}
                  isMergingInProgress={isMergingInProgress}
                  setMergeProgress={setMergeProgress}
                  setMergeStage={setMergeStage}
                  editorRef={editSubtitlesMethodsRef}
                  onSelectVideoClick={handleSelectVideoClick}
                  onSetMergeOperationId={setMergeOperationId}
                  onSetSubtitleSegments={handleSetSubtitleSegments}
                  reviewedBatchStartIndex={reviewedBatchStartIndex}
                  canSaveDirectly={!!originalSrtFilePath}
                  handleSaveSrt={handleSaveSrt}
                  handleSaveEditedSrtAs={handleSaveEditedSrtAs}
                  onSrtFileLoaded={handleSrtFileLoaded}
                  saveError={saveError}
                  setSaveError={setSaveError}
                  searchText={searchText}
                  onStartPngRenderRequest={handleStartPngRenderFromChild}
                  videoDuration={videoMetadata?.duration}
                  videoWidth={videoMetadata?.width}
                  videoHeight={videoMetadata?.height}
                  videoFrameRate={videoMetadata?.frameRate}
                />
              </div>
            </div>

            {isTranslationInProgress && (
              <TranslationProgressArea
                translationProgress={translationProgress}
                translationStage={translationStage}
                onClose={() => setIsTranslationInProgress(false)}
                subtitleProgress={
                  isReceivingPartialResults
                    ? {
                        current: translationProgress,
                        total: 100,
                      }
                    : undefined
                }
                translationOperationId={translationOperationId}
              />
            )}

            {isMergingInProgress && (
              <MergingProgressArea
                mergeProgress={mergeProgress}
                mergeStage={mergeStage}
                onSetIsMergingInProgress={setIsMergingInProgress}
                operationId={mergeOperationId}
                onCancelComplete={() => {}}
              />
            )}

            <BackToTopButton />
          </>
        )}
      </div>
    </div>
  );

  function handleSaveAsComplete(newFilePath: string) {
    console.log(
      '[AppContent] Save As complete, setting original path to:',
      newFilePath
    );
    setOriginalSrtFilePath(newFilePath);
  }

  async function handleSelectVideoClick() {
    try {
      const result = await window.electron.openFile({
        properties: ['openFile'],
        filters: [
          {
            name: 'Media Files',
            extensions: [
              'mp4',
              'mkv',
              'avi',
              'mov',
              'webm', // Video
              'mp3',
              'wav',
              'aac',
              'ogg',
              'flac', // Audio
            ],
          },
        ],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown_media'; // Extract filename

        setDownloadedVideoPath(null); // Reset URL download state

        // --- Call BOTH state update functions ---
        // 1. Set the File object and URL (for the player preview)
        handleSetVideoFile({ path: filePath, name: fileName }); // Pass path and name info

        // 2. Set the file path state and fetch metadata
        await handleVideoFileSelected(filePath);
        // --- End calling both ---
      } else {
        console.log('File selection cancelled or no file chosen.');
      }
    } catch (err: any) {
      console.error('Error opening file dialog:', err);
      // Reset video state if dialog fails
      handleSetVideoFile(null); // Use the action to properly clear state
      setVideoFilePath(null);
      setVideoMetadata(null);
    }
  }

  function handleBackFromSettings() {
    setShowSettings(false);
    fetchKeyStatus();
  }

  function handleCloseFindBar() {
    setIsFindBarVisible(false);
    setSearchText('');
  }

  function handleFindNext() {
    if (matchedIndices.length === 0) return;
    setActiveMatchIndex(prev => (prev + 1) % matchedIndices.length);
  }

  function handleScrollToCurrentSubtitle() {
    if (editSubtitlesMethodsRef.current) {
      editSubtitlesMethodsRef.current.scrollToCurrentSubtitle();
    }
  }

  function handleShiftAllSubtitles(offsetSeconds: number) {
    handleSetSubtitleSegments((currentSegments: SrtSegment[]) =>
      currentSegments.map((segment: SrtSegment) => ({
        ...segment,
        start: Math.max(0, segment.start + offsetSeconds),
        end: Math.max(0.01, segment.end + offsetSeconds),
      }))
    );
  }

  function handleToggleSettings(show: boolean) {
    setShowSettings(show);
    if (!show) {
      fetchKeyStatus();
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

  function handleUrlError(err: any) {
    console.error('Error processing URL:', err);
    setError(`Error processing URL: ${err.message || err}`);
    setProgressStage('Error');
    setProgressPercent(0);
    setDownloadComplete(false);
    setDownloadedVideoPath(null);
  }

  function handleFindPrev() {
    if (matchedIndices.length === 0) return;
    setActiveMatchIndex(
      prev => (prev - 1 + matchedIndices.length) % matchedIndices.length
    );
  }

  function handleReplaceAll(findText: string, replaceWithText: string) {
    if (!findText || !replaceWithText) {
      console.warn(
        '[AppContent] Replace All requires both find and replace text.'
      );
      return;
    }

    console.log(
      `[AppContent] Replacing "${findText}" with "${replaceWithText}"`
    );

    // Capture the result of the replacement
    const updatedSegments = replaceAll(subtitleSegments);
    // Update the state with the new segments
    handleSetSubtitleSegments(updatedSegments);

    setMatchedIndices([]);
    setActiveMatchIndex(0);

    function replaceAll(currentSegments: SrtSegment[]) {
      try {
        const escapedFindText = findText.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
        const regex = new RegExp(escapedFindText, 'gi');

        return currentSegments.map((segment: SrtSegment) => ({
          ...segment,
          text: segment.text.replace(regex, replaceWithText),
        }));
      } catch (error) {
        console.error('Error during Replace All regex operation:', error);
        setSaveError(`Error during replacement: ${error}`);
        return currentSegments;
      }
    }
  }

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
    setDownloadComplete(false);
    setVideoFile(null);
    setDidDownloadFromUrl(false);
    setVideoUrl('');
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
    setVideoFilePath(videoPath);
    setDidDownloadFromUrl(true);

    try {
      const fileContentResult =
        await window.electron.readFileContent(videoPath);
      if (!fileContentResult.success || !fileContentResult.data) {
        throw new Error(fileContentResult.error || 'Failed to read video file');
      }

      const blob = new Blob([fileContentResult.data], { type: 'video/mp4' });
      const blobUrl = URL.createObjectURL(blob);

      setVideoUrl(blobUrl);

      const videoFileObj = new File([blob], result.filename, {
        type: 'video/mp4',
      });
      (videoFileObj as any)._blobUrl = blobUrl;
      (videoFileObj as any)._originalPath = videoPath;

      setProgressStage('Setting up video...');
      setVideoFile(videoFileObj);
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
        setVideoUrl(result.fileUrl);
        setVideoFile(fallback as any);
      } else {
        throw new Error('Could not read video. No fallback was provided');
      }
    }
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

  async function handleStartPngRenderFromChild(
    options: RenderSubtitlesOptions
  ): Promise<{ success: boolean; error?: string; outputPath?: string }> {
    console.log(
      '[AppContent] Received render request from child component:',
      options
    );
    setIsMergingInProgress(true);
    setMergeStage('Starting PNG sequence render...');
    setMergeOperationId(options.operationId);
    setSaveError('');

    try {
      const result = await subtitleRendererClient.renderSubtitles(options);
      console.log(
        '[AppContent] Final result received from main process:',
        result
      );

      if (result.success && result.outputPath) {
        // SUCCESS: Main process completed rendering AND user saved the file
        setMergeStage('Overlay video saved successfully!');
        setIsMergingInProgress(false);
        setMergeOperationId(null);
        return { success: true, outputPath: result.outputPath };
      } else {
        throw new Error(result.error || 'Overlay generation or save failed.');
      }
    } catch (error: any) {
      const errorMessage =
        error.message || 'Client call or save process failed';
      console.error(
        `[AppContent ${options.operationId}] Error during PNG render/save flow:`,
        error
      );
      // Update UI for error state
      setIsMergingInProgress(false);
      setMergeStage(`Error: ${errorMessage.substring(0, 100)}`);
      setSaveError(errorMessage); // Set error message state
      setMergeOperationId(null);
      return { success: false, error: errorMessage };
    }
  }

  async function handleVideoFileSelected(filePath: string) {
    setVideoFilePath(filePath);
    setVideoMetadata(null);
    if (filePath) {
      console.log(`[AppContent] Fetching metadata for: ${filePath}`);
      try {
        const result = await window.electron.getVideoMetadata(filePath);
        if (result.success && result.metadata) {
          console.log('[AppContent] Received metadata:', result.metadata);
          setVideoMetadata(result.metadata);
        } else {
          console.error(
            '[AppContent] Failed to get video metadata:',
            result.error
          );
          setError(`Failed to get video metadata: ${result.error}`);
        }
      } catch (error) {
        console.error(
          '[AppContent] Error calling getVideoMetadata IPC:',
          error
        );
        setError(
          `Error fetching video metadata: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
}

export default function App() {
  return <AppContent />;
}
