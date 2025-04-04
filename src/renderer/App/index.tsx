import { useState, useRef, useCallback } from 'react';

import BackToTopButton from '../components/BackToTopButton';
import SettingsPage from '../containers/SettingsPage';
import StickyVideoPlayer from '../containers/EditSubtitles/StickyVideoPlayer';
import { nativePlayer } from '../components/NativeVideoPlayer';
import { EditSubtitles } from '../containers/EditSubtitles';
import GenerateSubtitles from '../containers/GenerateSubtitles';
import MergingProgressArea from '../containers/MergingProgressArea';
import TranslationProgressArea from '../containers/TranslationProgressArea';
import LogoDisplay from '../components/LogoDisplay';

import { ManagementContextProvider } from '../context';
import { SrtSegment } from '../../types/interface';

import { parseSrt, secondsToSrtTime } from '../helpers';
import { useApiKeyStatus } from './hooks/useApiKeyStatus';
import { useSubtitleManagement } from './hooks/useSubtitleManagement';
import { useSubtitleSaving } from '../containers/EditSubtitles/hooks/useSubtitleSaving';

import { pageWrapperStyles, containerStyles } from '../styles';
import { css } from '@emotion/css';
import { colors } from '../styles';

const headerRightGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 15px; // Gap between logo and button
`;

const headerStyles = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
  gap: 15px; // Add gap between title and right group
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

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');

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
  } = useSubtitleManagement(showOriginalText); // Pass showOriginalText

  // State for save error (still needed for display, set by the hook via prop)
  const [saveError, setSaveError] = useState<string>('');

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

  const hasScrolledToStickyRef = useRef(false);

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
      if (videoUrl && !videoUrl.startsWith('file://')) {
        // Only revoke if it's an object URL, not a file:// URL
        URL.revokeObjectURL(videoUrl);
      }

      // Special case for files with direct URL from downloaded videos
      if (file && file._isUrlDirect && file._directUrl) {
        // This is our special file-like object with a direct URL
        console.log('Using direct file URL:', file._directUrl);
        setVideoFile(file); // Keep the file-like object in state
        setVideoUrl(file._directUrl); // Use the direct file:// URL
        setIsPlaying(false); // Reset playback state on new video
        // Clear subtitles when a new video (even downloaded) is set
        handleSetSubtitleSegments([]);
        return;
      }

      // Handle standard File objects or null
      setVideoFile(file);

      if (file) {
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setIsPlaying(false); // Reset playback state on new video
        // Clear subtitles for newly selected local files
        handleSetSubtitleSegments([]);
      } else {
        // If file is null (cleared or cancelled selection)
        setVideoUrl('');
        setIsPlaying(false);
        // Clear subtitles if video removed
        handleSetSubtitleSegments([]);
      }
    },
    [videoUrl, resetSubtitleSource]
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

  return (
    <div className={pageWrapperStyles}>
      <div id="top-padding" style={{ height: '10px' }}></div>
      <div className={containerStyles}>
        <div className={headerStyles}>
          {/* Left side: Logo */}
          <LogoDisplay />

          {/* Right side: Settings Button */}
          <div
            className={
              headerRightGroupStyles
            } /* REMOVE style={{ marginLeft: 'auto' }} */
          >
            {/* <LogoDisplay />  MOVED */}
            {!showSettings && (
              <button
                className={settingsButtonStyles}
                onClick={() => handleToggleSettings(true)}
              >
                Settings
              </button>
            )}
          </div>
        </div>
        {showSettings ? (
          <SettingsPage
            apiKeyStatus={apiKeyStatus}
            isLoadingStatus={isLoadingKeyStatus}
            onBack={() => handleToggleSettings(false)}
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
                onStickyChange={handleStickyChange}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
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
              />
            )}

            {isMergingInProgress && (
              <MergingProgressArea
                mergeProgress={mergeProgress}
                mergeStage={mergeStage}
                onSetIsMergingInProgress={setIsMergingInProgress}
                operationId={null}
                onCancelComplete={() => {}}
              />
            )}

            <BackToTopButton />
          </>
        )}
      </div>
    </div>
  );

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused); // Update isPlaying based on initial player state
    }
  }

  function handleStickyChange(): void {
    if (!hasScrolledToStickyRef.current && editSubtitlesRef.current) {
      const stickyVideoHeight =
        document.querySelector('.sticky-video-container')?.clientHeight || 0;
      const offsetTop =
        editSubtitlesRef.current.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top: offsetTop - stickyVideoHeight - 20, // 20px extra space
        behavior: 'auto',
      });
      hasScrolledToStickyRef.current = true;
    }
  }
}

export default function App() {
  return (
    <ManagementContextProvider>
      <AppContent />
    </ManagementContextProvider>
  );
}
