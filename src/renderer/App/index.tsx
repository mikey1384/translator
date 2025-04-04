import React, { useState, useRef, useCallback, useEffect } from 'react';

import BackToTopButton from '../components/BackToTopButton';
import SettingsPage from '../containers/SettingsPage';
import StickyVideoPlayer from '../containers/EditSubtitles/StickyVideoPlayer';
import { nativePlayer } from '../components/NativeVideoPlayer';
import { EditSubtitles } from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import MergingProgressArea from '../containers/MergingProgressArea';
import TranslationProgressArea from '../containers/TranslationProgressArea';
import LogoDisplay from '../components/LogoDisplay';
import FindBar from '../components/FindBar';

import { ManagementContextProvider } from '../context';
import { SrtSegment } from '../../types/interface';

import { parseSrt, secondsToSrtTime } from '../helpers';
import { useApiKeyStatus } from './hooks/useApiKeyStatus';
import { useSubtitleManagement } from './hooks/useSubtitleManagement';
import { useSubtitleSaving } from '../containers/EditSubtitles/hooks/useSubtitleSaving';

import { pageWrapperStyles, containerStyles, colors } from '../styles';
import { css } from '@emotion/css';

// Define FindResults type
type FindResults = {
  matches: number;
  activeMatchOrdinal: number;
};

// --- Restore Local Style Definitions ---
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
// --- End Restore Local Style Definitions ---

function AppContent() {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const { apiKeyStatus, isLoadingKeyStatus, fetchKeyStatus } =
    useApiKeyStatus();

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');
  const [mergeOperationId, setMergeOperationId] = useState<string | null>(null);

  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

  // --- State for the original loaded SRT file path ---
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );

  const {
    subtitleSegments,
    handleSetSubtitleSegments, // This is the setter for the hook's state
    isTranslationInProgress,
    translationProgress,
    translationStage,
    setIsTranslationInProgress,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    handleSubtitlesGenerated, // Use the handler from the hook
    resetSubtitleSource, // Get the reset function
    translationOperationId,
  } = useSubtitleManagement(showOriginalText); // Pass showOriginalText

  // State for save error (still needed for display, set by the hook via prop)
  const [saveError, setSaveError] = useState<string>('');

  // --- Find Bar State ---
  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [findResults, setFindResults] = useState<FindResults>({
    matches: 0,
    activeMatchOrdinal: 0,
  });
  // --- End Find Bar State ---

  // Callback for when Save As completes
  const handleSaveAsComplete = useCallback((newFilePath: string) => {
    console.log(
      '[AppContent] Save As complete, setting original path to:',
      newFilePath
    );
    setOriginalSrtFilePath(newFilePath); // Update path after successful Save As
  }, []);

  // Simplified Subtitle Saving Hook Call
  const {
    canSaveDirectly, // This is now derived from originalSrtFilePath passed in
    handleSaveSrt,
    handleSaveEditedSrtAs,
  } = useSubtitleSaving({
    subtitles: subtitleSegments,
    originalSrtFilePath: originalSrtFilePath, // Pass the state here
    setSaveError: setSaveError, // Pass the setter for error display
    onSaveAsComplete: handleSaveAsComplete, // Pass the callback
  });

  const mainContentRef = useRef<HTMLDivElement>(null);

  const editSubtitlesRef = useRef<HTMLDivElement>(null);

  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({
    scrollToCurrentSubtitle: () => {},
  });

  const handleSetVideoFile = useCallback(
    (file: File | any | null) => {
      // --- Reset subtitle source before changing video --- START ---
      resetSubtitleSource();
      // --- Reset subtitle source before changing video --- END ---

      // Clean up previous object URL if it exists
      if (videoUrl && videoUrl.startsWith('blob:')) {
        // Only revoke blob URLs
        URL.revokeObjectURL(videoUrl);
      }

      // --- MODIFIED: Handle Blob-based file objects --- START ---
      if (file && file._blobUrl) {
        // This is our Blob-based file object from downloaded/processed video
        console.log('Using Blob URL:', file._blobUrl);
        setVideoFile(file); // Keep the File object in state
        setVideoUrl(file._blobUrl); // Use the Blob URL for the player
        setIsPlaying(false);
        handleSetSubtitleSegments([]);
        return;
      }
      // --- MODIFIED: Handle Blob-based file objects --- END ---

      // --- MODIFIED: Handle direct file:// URLs (if passed) --- START ---
      // Keep this for backward compatibility or other scenarios if needed
      if (file && file._isUrlDirect && file._directUrl) {
        console.log('Using direct file URL (fallback):', file._directUrl);
        setVideoFile(file);
        setVideoUrl(file._directUrl);
        setIsPlaying(false);
        handleSetSubtitleSegments([]);
        return;
      }
      // --- MODIFIED: Handle direct file:// URLs (if passed) --- END ---

      // Handle standard File objects (from local file selection)
      setVideoFile(file);

      if (file instanceof File) {
        const url = URL.createObjectURL(file);
        console.log('Created Blob URL for local file:', url);
        setVideoUrl(url);
        setIsPlaying(false);
        handleSetSubtitleSegments([]);
      } else {
        // If file is null (cleared or cancelled selection)
        setVideoUrl('');
        setIsPlaying(false);
        handleSetSubtitleSegments([]);
      }
    },
    [videoUrl, resetSubtitleSource, handleSetSubtitleSegments] // Add handleSetSubtitleSegments
  );

  const handleSetIsPlaying = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  const handleSetMergeProgress = useCallback(
    (progress: number | ((prevState: number) => number)) => {
      setMergeProgress(progress);
    },
    []
  );

  const handleSetMergeStage = useCallback(
    (stage: string | ((prevState: string) => string)) => {
      setMergeStage(stage);
    },
    []
  );

  const handleSetIsMergingInProgress = useCallback(
    (inProgress: boolean | ((prevState: boolean) => boolean)) => {
      setIsMergingInProgress(inProgress);
    },
    []
  );

  const handleScrollToCurrentSubtitle = () => {
    if (editSubtitlesMethodsRef.current) {
      editSubtitlesMethodsRef.current.scrollToCurrentSubtitle();
    }
  };

  const handleTogglePlay = useCallback(async () => {
    try {
      if (nativePlayer.instance) {
        if (nativePlayer.isPlaying()) {
          nativePlayer.pause();
          setIsPlaying(false);
        } else {
          await nativePlayer.play();
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
    }
  }, []); // No dependencies needed if only using nativePlayer and setIsPlaying

  const handleShiftAllSubtitles = useCallback(
    (offsetSeconds: number) => {
      // Use the setter from the hook
      handleSetSubtitleSegments((currentSegments: SrtSegment[]) =>
        currentSegments.map((segment: SrtSegment) => ({
          ...segment,
          start: Math.max(0, segment.start + offsetSeconds),
          end: Math.max(0.01, segment.end + offsetSeconds), // Ensure end is slightly after start if start becomes 0
        }))
      );
    },
    [handleSetSubtitleSegments]
  );

  const handleToggleSettings = (show: boolean) => {
    setShowSettings(show);
    if (!show) {
      fetchKeyStatus();
    }
  };

  // Wrapper for subtitle generation completion
  const handleGeneratedSubtitlesWrapper = useCallback(
    (generatedSrt: string) => {
      handleSubtitlesGenerated(generatedSrt); // Call the original handler
      setOriginalSrtFilePath(null); // Explicitly clear save path after generation
      console.log(
        '[AppContent] Subtitles generated, originalSrtFilePath set to null.'
      );
    },
    [handleSubtitlesGenerated]
  ); // Removed clearSaveState dependency

  // --- New Callback for SRT File Loading ---
  const handleSrtFileLoaded = useCallback((filePath: string) => {
    console.log(
      '[AppContent] SRT file loaded, setting original path:',
      filePath
    );
    setOriginalSrtFilePath(filePath);
    setSaveError(''); // Clear any previous save errors on successful load
  }, []);

  // --- Find Bar Listeners ---
  useEffect(() => {
    console.log('[AppContent] Find Bar useEffect running.');
    if (!window.electron) {
      console.error('[AppContent] window.electron is NOT defined!');
      return;
    }

    console.log('[AppContent] Checking preload functions:', {
      onShowFindBarExists: typeof window.electron.onShowFindBar === 'function',
      onFindResultsExists: typeof window.electron.onFindResults === 'function',
    });

    if (
      typeof window.electron.onShowFindBar !== 'function' ||
      typeof window.electron.onFindResults !== 'function'
    ) {
      console.error(
        '[AppContent] Required find functions NOT available on window.electron!'
      );
      return;
    }

    console.log('[AppContent] Attempting to set up find listeners...');
    const cleanupShowListener = window.electron.onShowFindBar(() => {
      console.log('[AppContent] Show find bar triggered');
      setIsFindBarVisible(true);
    });

    const cleanupResultsListener = window.electron.onFindResults(results => {
      console.log('[AppContent] Find results received:', results);
      setFindResults({
        matches: results.matches,
        activeMatchOrdinal: results.activeMatchOrdinal,
      });
    });
    console.log('[AppContent] Find listeners potentially set up.');

    return () => {
      console.log('[AppContent] Cleaning up find listeners.');
      cleanupShowListener();
      cleanupResultsListener();
    };
  }, []); // Runs once on mount
  // --- End Find Bar Listeners ---

  const handleCloseFindBar = useCallback(() => {
    setIsFindBarVisible(false);
    window.electron?.sendStopFind();
  }, []);

  // Callback from Header to navigate back from Settings
  const handleBackFromSettings = () => {
    setShowSettings(false);
    // Optionally refetch key status when returning from settings
    fetchKeyStatus();
  };

  // Function to handle video player readiness
  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused); // Update isPlaying based on initial player state
    }
  }

  return (
    <div className={pageWrapperStyles}>
      {/* --- FindBar Render (Moved near top) --- */}
      <FindBar
        isVisible={isFindBarVisible}
        results={findResults}
        onClose={handleCloseFindBar}
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
              <StickyVideoPlayer
                videoUrl={videoUrl}
                subtitles={subtitleSegments}
                onPlayerReady={handleVideoPlayerReady}
                onChangeVideo={handleSetVideoFile}
                onSrtLoaded={handleSetSubtitleSegments}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
                isProgressBarVisible={
                  isMergingInProgress || isTranslationInProgress
                }
              />
            )}

            <div ref={mainContentRef} className={mainContentStyles}>
              <GenerateSubtitles
                videoFile={videoFile}
                onSetVideoFile={handleSetVideoFile}
                onSubtitlesGenerated={handleGeneratedSubtitlesWrapper}
                showOriginalText={showOriginalText}
                onShowOriginalTextChange={setShowOriginalText}
                apiKeyStatus={apiKeyStatus}
                isLoadingKeyStatus={isLoadingKeyStatus}
                onNavigateToSettings={handleToggleSettings}
                subtitleSegments={subtitleSegments}
                secondsToSrtTime={secondsToSrtTime}
              />

              <div ref={editSubtitlesRef} id="edit-subtitles-section">
                <EditSubtitles
                  videoFile={videoFile}
                  videoUrl={videoUrl}
                  isPlaying={isPlaying}
                  onSetVideoFile={handleSetVideoFile}
                  onSetIsPlaying={handleSetIsPlaying}
                  secondsToSrtTime={secondsToSrtTime}
                  parseSrt={parseSrt}
                  subtitles={subtitleSegments}
                  videoPlayerRef={videoPlayerRef}
                  isMergingInProgress={isMergingInProgress}
                  setMergeProgress={handleSetMergeProgress}
                  setMergeStage={handleSetMergeStage}
                  setIsMergingInProgress={handleSetIsMergingInProgress}
                  editorRef={editSubtitlesMethodsRef}
                  onSetMergeOperationId={setMergeOperationId}
                  onSetSubtitlesDirectly={handleSetSubtitleSegments}
                  reviewedBatchStartIndex={reviewedBatchStartIndex}
                  canSaveDirectly={canSaveDirectly}
                  handleSaveSrt={handleSaveSrt}
                  handleSaveEditedSrtAs={handleSaveEditedSrtAs}
                  onSrtFileLoaded={handleSrtFileLoaded}
                  saveError={saveError}
                  setSaveError={setSaveError}
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
}

export default function App() {
  return (
    <ManagementContextProvider>
      <AppContent />
    </ManagementContextProvider>
  );
}
