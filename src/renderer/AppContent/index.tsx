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
import { SrtSegment } from '../../types/interface.js';

import { parseSrt, secondsToSrtTime } from '../../shared/helpers/index.js';
import { useApiKeyStatus } from './hooks/useApiKeyStatus.js';
import { useSubtitleState } from './hooks/subtitles/useSubtitleState.js';
import { useSubtitleActions } from './hooks/subtitles/useSubtitleActions.js';
import { useVideoState } from './hooks/video/useVideoState.js';

import { pageWrapperStyles, containerStyles, colors } from '../styles.js';
import { css } from '@emotion/css';
import { useVideoActions } from './hooks/video/useVideoActions.js';

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
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const { apiKeyStatus, isLoadingKeyStatus, fetchKeyStatus } =
    useApiKeyStatus();
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');
  const [mergeOperationId, setMergeOperationId] = useState<string | null>(null);

  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [matchedIndices, setMatchedIndices] = useState<number[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

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
    videoUrl,
    videoFilePath,
    isUrlLoading,
    isPlaying,
    isMergingInProgress,
    urlLoadProgressPercent,
    urlLoadProgressStage,
    originalSrtFilePath,
    saveError,
    setIsPlaying,
    setIsMergingInProgress,
    setIsUrlLoading,
    setUrlLoadProgressPercent,
    setUrlLoadProgressStage,
    setVideoFile,
    setVideoUrl,
    setVideoFilePath,
    setVideoPlayerRef,
    setOriginalSrtFilePath,
    setSaveError,
    videoPlayerRef,
  } = useVideoState();

  const {
    handleSaveSrt,
    handleSaveEditedSrtAs,
    handleSetSubtitleSegments,
    resetSubtitleSource,
  } = useSubtitleActions({
    subtitles: subtitleSegments,
    originalSrtFilePath: originalSrtFilePath,
    setSaveError,
    onSaveAsComplete: handleSaveAsComplete,
    setSubtitleSegments,
    setSubtitleSourceId,
  });

  const {
    handleLoadFromUrl,
    handleSetVideoFile,
    handleSrtFileLoaded,
    handleTogglePlay,
    handleVideoPlayerReady,
  } = useVideoActions({
    resetSubtitleSource,
    setIsUrlLoading,
    setUrlLoadProgressPercent,
    setUrlLoadProgressStage,
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
    handleSetSubtitleSegments,
    onReset: handleResetVideo,
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
              ← Back to App
            </button>
          ) : (
            <LogoDisplay />
          )}
          <div className={headerRightGroupStyles}>
            {/* Removed Settings Button here, handled by header logic */}
          </div>
        </div>
        {showSettings ? (
          <SettingsPage
            apiKeyStatus={apiKeyStatus}
            isLoadingStatus={isLoadingKeyStatus}
            onBack={handleBackFromSettings}
          />
        ) : (
          <>
            {videoUrl && (
              <VideoPlayer
                videoUrl={videoUrl}
                subtitles={subtitleSegments}
                onPlayerReady={handleVideoPlayerReady}
                onChangeVideo={handleSetVideoFile}
                onLoadFromUrl={handleLoadFromUrl}
                onSrtLoaded={handleSetSubtitleSegments}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
                isUrlLoading={isUrlLoading}
                urlLoadProgress={urlLoadProgressPercent}
                urlLoadStage={urlLoadProgressStage}
                isProgressBarVisible={
                  isMergingInProgress || isTranslationInProgress || isUrlLoading
                }
              />
            )}

            <div ref={mainContentRef} className={mainContentStyles}>
              <GenerateSubtitles
                videoFile={videoFile}
                videoFilePath={videoFilePath}
                onSetVideoFile={handleSetVideoFile}
                showOriginalText={showOriginalText}
                onShowOriginalTextChange={setShowOriginalText}
                apiKeyStatus={apiKeyStatus}
                isLoadingKeyStatus={isLoadingKeyStatus}
                onNavigateToSettings={handleToggleSettings}
                onSelectVideoClick={handleSelectVideoClick}
              />

              <div ref={editSubtitlesRef} id="edit-subtitles-section">
                <EditSubtitles
                  videoFile={videoFile}
                  videoUrl={videoUrl}
                  videoFilePath={videoFilePath}
                  isPlaying={isPlaying}
                  onSetVideoFile={handleSetVideoFile}
                  onSetIsPlaying={setIsPlaying}
                  secondsToSrtTime={secondsToSrtTime}
                  parseSrt={parseSrt}
                  subtitles={subtitleSegments}
                  videoPlayerRef={videoPlayerRef}
                  isMergingInProgress={isMergingInProgress}
                  setMergeProgress={setMergeProgress}
                  setMergeStage={setMergeStage}
                  setIsMergingInProgress={setIsMergingInProgress}
                  editorRef={editSubtitlesMethodsRef}
                  onSelectVideoClick={handleSelectVideoClick}
                  onSetMergeOperationId={setMergeOperationId}
                  onSetSubtitlesDirectly={handleSetSubtitleSegments}
                  reviewedBatchStartIndex={reviewedBatchStartIndex}
                  canSaveDirectly={!!originalSrtFilePath}
                  handleSaveSrt={handleSaveSrt}
                  handleSaveEditedSrtAs={handleSaveEditedSrtAs}
                  onSrtFileLoaded={handleSrtFileLoaded}
                  saveError={saveError}
                  setSaveError={setSaveError}
                  searchText={searchText}
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
          { name: 'Videos', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
        ],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown_video';
        handleSetVideoFile({ path: filePath, name: fileName });
      } else {
        console.log('File selection cancelled or no file chosen.');
      }
    } catch (err: any) {
      console.error('Error opening file dialog:', err);
      handleSetVideoFile(null);
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

  function handleFindNext() {
    if (matchedIndices.length === 0) return;
    setActiveMatchIndex(prev => (prev + 1) % matchedIndices.length);
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

  function handleResetVideo() {
    setVideoFile(null);
    setVideoUrl('');
    setVideoFilePath(null);
    setIsPlaying(false);
    handleSetSubtitleSegments([]);
  }
}

export default function App() {
  return <AppContent />;
}
