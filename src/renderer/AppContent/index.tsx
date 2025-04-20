import { useState, useRef, useEffect, useCallback } from 'react';
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
import ProgressArea from '../components/ProgressAreas/ProgressArea.js';

import { parseSrt, secondsToSrtTime } from '../../shared/helpers/index.js';
import { useApiKeyStatus } from './hooks/useApiKeyStatus.js';
import { useSubtitleState } from './hooks/subtitles/useSubtitleState.js';
import { useSubtitleActions } from './hooks/subtitles/useSubtitleActions.js';

import { pageWrapperStyles, containerStyles, colors } from '../styles.js';
import { css } from '@emotion/css';
import { useVideoActions } from './hooks/video/useVideoActions.js';
import subtitleRendererClient, {
  RenderSubtitlesOptions,
} from '../clients/subtitle-renderer-client.js';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles.js';
import { getNativePlayerInstance } from '../native-player.js';

// Add this interface definition
interface ElectronProcessUrlResult {
  success: boolean;
  message?: string;
  filePath?: string;
  videoPath?: string;
  filename?: string;
  size?: number;
  fileUrl?: string;
  originalVideoPath?: string;
  error?: string;
  operationId: string; // It's required in the backend type
  cancelled?: boolean; // Include the optional cancelled property
}

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

const DOWNLOAD_PROGRESS_COLOR = colors.primary; // Or another color

// --- Helper Function ---
const throttle = <T extends (...args: any[]) => any>(
  func: T,
  delay: number
): T & { cancel: () => void } => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let trailingCallScheduled = false;

  const throttled = (...args: Parameters<T>) => {
    lastArgs = args;

    if (!timeoutId) {
      func(...lastArgs);
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (trailingCallScheduled && lastArgs) {
          throttled(...lastArgs); // Trigger trailing call
          trailingCallScheduled = false;
        }
      }, delay);
    } else {
      trailingCallScheduled = true; // Schedule a trailing call
    }
  };

  throttled.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    trailingCallScheduled = false;
  };

  return throttled as T & { cancel: () => void };
};
// --- End Helper Function ---

function AppContent() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>('');
  const [isProcessingUrl, setIsProcessingUrl] = useState<boolean>(false);
  const [downloadComplete, setDownloadComplete] = useState<boolean>(false);
  const [downloadedVideoPath, setDownloadedVideoPath] = useState<string | null>(
    null
  );
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
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
    reviewedBatchStartIndex,
    translationOperationId,
    setIsTranslationInProgress,
    setSubtitleSegments,
    setSubtitleSourceId,
  } = useSubtitleState(showOriginalText);

  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const [saveError, setSaveError] = useState<string>('');

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [isVideoPlayerReady, setIsVideoPlayerReady] = useState<boolean>(false);

  // Function to save position immediately
  const saveCurrentPositionImmediately = useCallback(
    async (filePathToSave: string | null, player: HTMLVideoElement | null) => {
      // --- DETAILED LOGGING ---
      const now = new Date().toLocaleTimeString();
      const duration = player ? player.duration : 'N/A';
      const currentTime = player ? player.currentTime : 'N/A';
      const isPlayerValid = !!player;
      const isDurationValid = typeof duration === 'number' && duration > 0;
      const isTimeValid = typeof currentTime === 'number' && currentTime >= 0;
      console.log(
        `[${now}] [SAVE_IMMEDIATE_CHECK] Path: ${filePathToSave}, PlayerValid: ${isPlayerValid}, Duration: ${duration} (Valid: ${isDurationValid}), CurrentTime: ${currentTime} (Valid: ${isTimeValid})`
      );
      // --- END DETAILED LOGGING ---

      if (filePathToSave && player && player.duration > 0) {
        const position = player.currentTime;
        if (position >= 0) {
          // --- Add Execution Log ---
          console.log(
            `[${now}] [SAVE_IMMEDIATE_EXEC] Saving position for ${filePathToSave}: ${position}`
          );
          // --- End Execution Log ---
          await window.electron.saveVideoPlaybackPosition(
            filePathToSave,
            position
          );
        } else {
          // --- Add Skip Log ---
          console.log(
            `[${now}] [SAVE_IMMEDIATE_SKIP] Reason: Inner check failed - Invalid position (${position})`
          );
          // --- End Skip Log ---
        }
      } else {
        // --- Add Skip Log ---
        let reason = '';
        if (!filePathToSave) reason += 'No file path. ';
        if (!player) reason += 'Player is null. ';
        if (player && !(player.duration > 0))
          reason += `Invalid duration (${player?.duration}). `;
        console.log(
          `[${now}] [SAVE_IMMEDIATE_SKIP] Reason: Outer check failed - ${reason.trim()}`
        );
        // --- End Skip Log ---
      }
    },
    []
  );

  const SAVE_INTERVAL = 5000; // Save every 5 seconds during playback
  const saveCurrentPositionThrottled = useRef(
    throttle(
      (filePathToSave: string | null, player: HTMLVideoElement | null) => {
        saveCurrentPositionImmediately(filePathToSave, player);
      },
      SAVE_INTERVAL
    )
  ).current;

  useEffect(() => {
    // When videoFilePath changes, save the position of the *previous* path
    const previousPath = previousVideoPathRef.current;

    // Check readiness flag *before* getting player
    if (isVideoPlayerReady) {
      const currentPlayer = getNativePlayerInstance(); // Get player here
      if (previousPath && previousPath !== videoFilePath && currentPlayer) {
        // console.log(`[AppContent] Video path changed from ${previousPath}. Saving its position.`);
        saveCurrentPositionImmediately(previousPath, currentPlayer);
      }
    }

    // Update the ref to the new path for the next change
    previousVideoPathRef.current = videoFilePath;

    // Cleanup the throttle timer if the component unmounts while throttled
    return () => {
      // Only cancel if the throttle function exists (it should, but safety)
      if (saveCurrentPositionThrottled?.cancel) {
        saveCurrentPositionThrottled.cancel();
      }
    };
  }, [
    videoFilePath,
    isVideoPlayerReady,
    saveCurrentPositionImmediately,
    saveCurrentPositionThrottled,
  ]);

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
    setIsVideoPlayerReady,
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

  const [mergeFontSize, setMergeFontSize] = useState<number>(24); // Default size
  const [mergeStylePreset, setMergeStylePreset] =
    useState<SubtitleStylePresetKey>('Default'); // Default style

  const [downloadOperationId, setDownloadOperationId] = useState<string | null>(
    null
  );

  const [downloadProgressPercent, setDownloadProgressPercent] =
    useState<number>(0);
  const [downloadProgressStage, setDownloadProgressStage] =
    useState<string>('');

  const isInitialMount = useRef(true); // Ref to track initial mount
  const previousVideoPathRef = useRef<string | null>(null);

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
      editSubtitlesMethodsRef?.current?.scrollToSubtitleIndex(subIndex);
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

  useEffect(() => {
    const unlisten = window.electron.onProcessUrlProgress((progress: any) => {
      const currentPercent = progress.percent ?? 0;
      const currentStage = progress.stage ?? '';
      const error = progress.error ?? null;

      // *** Update specific download state ***
      setDownloadProgressPercent(currentPercent);
      setDownloadProgressStage(currentStage);
      // *** End update ***

      if (error) {
        console.error('Error during download progress:', error);
        setError(`Error during download: ${error}`);
        // Update stage to show error, let auto-close handle hiding
        setDownloadProgressStage(`Error: ${error}`); // Use specific state
        setDownloadProgressPercent(100); // Trigger auto-close on error
        setIsProcessingUrl(true); // Keep visible until auto-close
        setDownloadOperationId(null); // Clear ID on error
      } else if (currentPercent >= 100) {
        // Optionally set a specific "complete" stage if needed
        // setDownloadProgressStage("Download Complete");
        // The ProgressArea auto-close will handle hiding it based on percent
      }
    });
    return unlisten; // Cleanup listener
  }, []); // Keep empty dependency array

  useEffect(() => {
    // Make sure window.electron exists
    if (!window.electron?.onMergeSubtitlesProgress) {
      console.warn(
        '[AppContent] Merge progress listener setup failed: electron API not ready.'
      );
      return;
    }

    console.log('[AppContent] Setting up merge progress listener...');

    const unlisten = window.electron.onMergeSubtitlesProgress(
      (_event: any, progress: any) => {
        // Log the received progress data
        // console.log('[AppContent] Received merge progress:', progress);

        // Extract progress details (use defaults if properties are missing)
        const currentPercent = progress.percent ?? mergeProgress; // Keep current if undefined
        const currentStage = progress.stage ?? mergeStage; // Keep current if undefined
        const error = progress.error ?? null;
        const cancelled = progress.cancelled ?? false;
        const opId = progress.operationId ?? null; // Keep track of the operation ID

        // Update state variables
        setMergeProgress(currentPercent);
        setMergeStage(currentStage);
        setMergeOperationId(opId); // Ensure operation ID is updated

        // Handle error state specifically
        if (error) {
          console.error('[AppContent] Error during merge progress:', error);
          // Update stage to show error, keep progress bar visible until auto-close
          setMergeStage(`Error: ${error}`);
          setMergeProgress(100); // Trigger auto-close on error
          // Note: isMergingInProgress will be set to false by ProgressArea's onClose via handleClose
        } else if (cancelled) {
          console.log(
            '[AppContent] Merge operation cancelled via progress update.'
          );
          // Update stage and trigger auto-close
          setMergeStage('Merge cancelled');
          setMergeProgress(100);
          // Note: isMergingInProgress will be set to false by ProgressArea's onClose via handleClose
        } else if (currentPercent >= 100) {
          // Completion handled by ProgressArea auto-close
          console.log('[AppContent] Merge progress reached 100% or more.');
        }
      }
    );

    // Cleanup function to remove the listener when the component unmounts
    return () => {
      console.log('[AppContent] Cleaning up merge progress listener.');
      unlisten();
    };
  }, [mergeProgress, mergeStage]); // Add dependencies if needed, but likely just need it once

  useEffect(() => {
    // Load the saved target language when the component mounts
    const loadSavedLanguage = async () => {
      try {
        // Use the correct function exposed via preload
        const savedLanguage = await window.electron.getSubtitleTargetLanguage();
        if (savedLanguage && typeof savedLanguage === 'string') {
          console.log(
            `[AppContent] Loaded subtitle target language: ${savedLanguage}`
          );
          setTargetLanguage(savedLanguage);
        } else {
          console.log(
            '[AppContent] No subtitle target language saved, using default.'
          );
        }
      } catch (error) {
        console.error(
          '[AppContent] Error loading subtitle target language:',
          error
        );
      }
    };
    loadSavedLanguage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Save the target language whenever it changes (except for the initial default load)
    const saveLanguage = async () => {
      console.log(
        `[AppContent] Saving subtitle target language: ${targetLanguage}`
      );
      try {
        // Use the correct function exposed via preload
        await window.electron.setSubtitleTargetLanguage(targetLanguage);
      } catch (error) {
        console.error(
          '[AppContent] Error saving subtitle target language:',
          error
        );
      }
    };

    // --- ADD THIS CHECK ---
    // Only save after the initial mount/load cycle is complete
    if (!isInitialMount?.current) {
      // --- END ADD ---
      if (targetLanguage) {
        saveLanguage();
      }
      // --- ADD THIS CHECK ---
    } else {
      // On the initial mount, set the ref to false for subsequent renders
      isInitialMount.current = false;
    }
    // --- END ADD ---
  }, [targetLanguage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      // Check readiness flag *before* getting player
      if (document.visibilityState === 'visible' && isVideoPlayerReady) {
        const video = getNativePlayerInstance(); // Get player here
        console.log(
          '[AppContent] Window became visible. Checking video sync...'
        );
        if (video && !video.paused) {
          // Check if video is valid
          // Attempt to nudge the player to resync
          const currentTime = video.currentTime;
          console.log(
            `[AppContent] Nudging player. Current time: ${currentTime}`
          );
          video.currentTime = currentTime; // Setting time to itself can force a sync
        } else {
          console.log(
            '[AppContent] Video is paused or player invalid, no nudge needed.'
          );
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('[AppContent] Added visibilitychange listener.');

    // Cleanup listener on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[AppContent] Removed visibilitychange listener.');
    };
    // Depend on the readiness flag
  }, [isVideoPlayerReady]);

  // --- Try YET ANOTHER modification to the player event listener hook ---
  useEffect(() => {
    const currentPath = videoFilePath; // Capture path early

    // 1. Check if we even have a path. If not, cancel timer and exit.
    if (!currentPath) {
      if (saveCurrentPositionThrottled?.cancel)
        saveCurrentPositionThrottled.cancel();
      return;
    }

    // 2. Check the readiness flag first
    if (!isVideoPlayerReady) {
      console.log(
        `[AppContent] Player not ready yet for: ${currentPath}. Listener setup deferred.`
      );
      if (saveCurrentPositionThrottled?.cancel)
        saveCurrentPositionThrottled.cancel();
      return; // Exit if player not ready
    }

    // 3. Player is ready, get the instance
    const player = getNativePlayerInstance();
    if (!player) {
      // Should not happen if isVideoPlayerReady is true, but safety check
      console.error(
        '[AppContent] isVideoPlayerReady is true, but getNativePlayerInstance returned null!'
      );
      if (saveCurrentPositionThrottled?.cancel)
        saveCurrentPositionThrottled.cancel();
      return;
    }

    // 4. If we have both path AND player, proceed with listener setup.
    const handleTimeUpdate = () => {
      const now = new Date().toLocaleTimeString();
      const currentPlayer = getNativePlayerInstance();
      // --- Add Logging ---
      console.log(
        `[${now}] [HANDLE_TIMEUPDATE] Fired. Path: ${currentPath}, Player instance:`,
        currentPlayer
      ); // Log the actual player object
      // --- End Logging ---
      if (currentPath && currentPlayer) {
        saveCurrentPositionThrottled(currentPath, currentPlayer);
      } else {
        // --- Add Logging ---
        console.log(
          `[${now}] [HANDLE_TIMEUPDATE] SKIPPED SAVE. Path: ${currentPath}, Player valid: ${!!currentPlayer}`
        );
        // --- End Logging ---
      }
    };

    const handlePause = () => {
      const now = new Date().toLocaleTimeString();
      const currentPlayer = getNativePlayerInstance();
      console.log(
        `[${now}] [HANDLE_PAUSE] Fired. Path: ${currentPath}, Player instance:`,
        currentPlayer
      );
      if (currentPath && currentPlayer) {
        // --- Cancel pending throttle BEFORE immediate save ---
        if (saveCurrentPositionThrottled?.cancel) {
          saveCurrentPositionThrottled.cancel();
          console.log(`[${now}] [HANDLE_PAUSE] Canceled throttled save.`);
        }
        // --- End cancel ---
        saveCurrentPositionImmediately(currentPath, currentPlayer); // Call immediate save
      } else {
        console.log(
          `[${now}] [HANDLE_PAUSE] SKIPPED SAVE. Path: ${currentPath}, Player valid: ${!!currentPlayer}`
        );
      }
    };

    console.log(
      `[AppContent] Attaching playback listeners for: ${currentPath}`
    );
    player.addEventListener('timeupdate', handleTimeUpdate);
    player.addEventListener('pause', handlePause);

    // 5. Cleanup function
    return () => {
      console.log(
        `[AppContent] Detaching playback listeners for: ${currentPath}`
      );
      // Use the 'player' captured at setup time for removal
      // This specific instance needs to be used for removeEventListener
      if (player) {
        try {
          player.removeEventListener('timeupdate', handleTimeUpdate);
          player.removeEventListener('pause', handlePause);
        } catch (removeError) {
          console.warn(
            `[AppContent] Error removing listener during cleanup:`,
            removeError
          );
        }
      }

      // Save final position - check path and get fresh instance *at cleanup time*
      const latestPlayer = getNativePlayerInstance(); // Check current instance value
      if (currentPath && latestPlayer) {
        console.log(
          `[AppContent] Cleanup: Saving final position for ${currentPath}`
        );
        try {
          saveCurrentPositionImmediately(currentPath, latestPlayer);
        } catch (saveError) {
          console.warn(
            `[AppContent] Error saving position during cleanup:`,
            saveError
          );
        }
      } else {
        console.log(
          `[AppContent] Cleanup: Player/Path invalid, not saving final position.`
        );
      }
      // Cancel any pending throttled saves
      if (saveCurrentPositionThrottled?.cancel) {
        saveCurrentPositionThrottled.cancel();
      }
    };
  }, [
    videoFilePath,
    isVideoPlayerReady, // Use flag instead of ref
    saveCurrentPositionThrottled, // Keep throttled func ref in deps
    saveCurrentPositionImmediately, // Keep immediate func ref in deps
  ]);

  // Effect to load position and seek ONCE when video becomes ready
  useEffect(() => {
    const loadAndSeek = async () => {
      if (videoFilePath && isVideoPlayerReady) {
        const player = getNativePlayerInstance();
        if (!player) {
          console.warn(
            '[AppContent LoadSeek] Player instance not found, cannot seek.'
          );
          return;
        }
        console.log(
          `[AppContent LoadSeek] Checking saved position for: ${videoFilePath}`
        );
        try {
          const savedPosition =
            await window.electron.getVideoPlaybackPosition(videoFilePath);
          if (savedPosition !== null && player.seekable.length > 0) {
            const seekableEnd = player.seekable.end(player.seekable.length - 1);
            const seekableStart = player.seekable.start(0);

            if (
              savedPosition >= seekableStart &&
              savedPosition <= seekableEnd
            ) {
              console.log(
                `[AppContent LoadSeek] Resuming playback at ${savedPosition.toFixed(2)}s`
              );
              player.currentTime = savedPosition;
            } else {
              console.warn(
                `[AppContent LoadSeek] Saved position ${savedPosition} outside seekable range [${seekableStart}, ${seekableEnd}].`
              );
            }
          } else if (savedPosition !== null) {
            console.warn('[AppContent LoadSeek] Video not seekable yet.');
          } else {
            console.log('[AppContent LoadSeek] No saved position found.');
          }
        } catch (error) {
          console.error(
            '[AppContent LoadSeek] Error retrieving saved position:',
            error
          );
        }
      }
    };

    loadAndSeek();
    // This effect runs ONLY when the file path changes OR the player becomes ready
  }, [videoFilePath, isVideoPlayerReady]); // Dependencies: path and readiness flag

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
                mergeFontSize={mergeFontSize}
                mergeStylePreset={mergeStylePreset}
                downloadQuality={downloadQuality}
                onSetDownloadQuality={setDownloadQuality}
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
                  videoPlayerRef={
                    isVideoPlayerReady ? getNativePlayerInstance() : null
                  }
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
                  mergeFontSize={mergeFontSize}
                  setMergeFontSize={setMergeFontSize}
                  mergeStylePreset={mergeStylePreset}
                  setMergeStylePreset={setMergeStylePreset}
                />
              </div>
            </div>

            {/* --- Render ProgressArea for Download --- */}
            <ProgressArea
              isVisible={
                isProcessingUrl &&
                downloadProgressPercent > 0 &&
                !downloadComplete
              } // Use new state var
              title="Download in Progress"
              progress={downloadProgressPercent} // Use new state var
              stage={downloadProgressStage} // Use new state var
              progressBarColor={
                downloadProgressStage.toLowerCase().includes('error') // Use new state var
                  ? colors.danger
                  : DOWNLOAD_PROGRESS_COLOR
              }
              operationId={downloadOperationId}
              isCancelling={false} // Still assuming false for now
              onCancel={handleCancelDownload}
              onClose={() => {
                setIsProcessingUrl(false);
                setDownloadOperationId(null);
                // Reset download-specific state
                setDownloadProgressPercent(0);
                setDownloadProgressStage('');
              }}
              autoCloseDelay={4000}
            />
            {/* --- End Render ProgressArea for Download --- */}

            {/* Conditionally render other progress areas */}
            {isMergingInProgress && (
              <MergingProgressArea
                mergeProgress={mergeProgress}
                mergeStage={mergeStage}
                onSetIsMergingInProgress={setIsMergingInProgress}
                operationId={mergeOperationId}
                isMergingInProgress={isMergingInProgress}
              />
            )}

            <TranslationProgressArea
              isTranslationInProgress={isTranslationInProgress}
              translationProgress={translationProgress}
              translationStage={translationStage}
              onSetIsTranslationInProgress={setIsTranslationInProgress}
              translationOperationId={translationOperationId}
            />

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
    if (editSubtitlesMethodsRef?.current) {
      editSubtitlesMethodsRef?.current.scrollToCurrentSubtitle();
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
    setDownloadComplete(false);
    setDownloadedVideoPath(null);
    setDownloadOperationId(null);
    // *** Update specific download state for error ***
    setDownloadProgressStage(`Error: ${err.message || err}`);
    setDownloadProgressPercent(100); // Trigger auto-close
    setIsProcessingUrl(true); // Keep visible until auto-close
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
    const newDownloadId = `download-${Date.now()}`;
    setDownloadOperationId(newDownloadId);

    // *** ADD LOGGING HERE ***
    const optionsToSend = {
      url: urlInput,
      quality: downloadQuality,
      operationId: newDownloadId, // Include the generated ID
    };
    console.log(
      '[AppContent] Calling window.electron.processUrl with options:',
      JSON.stringify(optionsToSend)
    );
    // *** END LOGGING ***

    try {
      // Pass the prepared options object
      const result = (await window.electron.processUrl(
        optionsToSend
      )) as ElectronProcessUrlResult;

      // *** Check for cancellation FIRST ***
      if (result.cancelled) {
        console.log('[AppContent] Download operation was cancelled.');
        // Just reset state, don't show error
        resetUrlStates(); // Call reset to clear progress etc.
        setIsProcessingUrl(false); // Explicitly hide progress area if reset doesn't
        setDownloadOperationId(null);
        return; // Stop processing here
      }
      // *** End cancellation check ***

      // Original error check
      if (result.error) {
        throw new Error(result.error);
      }

      // Original success path
      const videoPath = result.videoPath || result.filePath;
      if (!videoPath || !result.filename) {
        throw new Error('Downloaded video info incomplete');
      }
      finishUrlDownload(result, videoPath);
      setUrlInput('');
      setIsProcessingUrl(false);
    } catch (err: any) {
      // Catch block remains the same - handleUrlError handles actual errors
      handleUrlError(err);
    }
  }

  function resetUrlStates() {
    setError('');
    setIsProcessingUrl(true);
    setDownloadComplete(false);
    // *** Add resets ***
    setDownloadProgressPercent(0);
    setDownloadProgressStage('');
    setDownloadOperationId(null);
  }

  async function finishUrlDownload(result: any, videoPath: string) {
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

      setVideoFile(videoFileObj);
    } catch (fileError) {
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

      // Check for errors first
      if (result.error) {
        throw new Error(result.error);
      }

      // If no error, process the final subtitles
      if (result.subtitles) {
        try {
          const finalSegments = parseSrt(result.subtitles);

          // --- ADD LOGGING HERE (Before handleSetSubtitleSegments) ---
          console.log(
            '[Frontend State Update] Data BEFORE setting state (Segment 27):',
            JSON.stringify(
              finalSegments.find(s => s.index === 27),
              null,
              2
            )
          );
          // --- END LOGGING ---

          console.log(
            '[Frontend State Update] Data BEFORE setting state (Segment 27):',
            JSON.stringify(
              finalSegments.find(s => s.index === 27),
              null,
              2
            ),
            `Timestamp: ${Date.now()}` // Add timestamp
          );
          handleSetSubtitleSegments(finalSegments);
        } catch (parseError) {
          console.error(
            '[AppContent] Error parsing final subtitles string:',
            parseError
          );
          setError(
            `Error processing final subtitles: ${parseError instanceof Error ? parseError.message : String(parseError)}`
          );
        }
      } else {
        // This case shouldn't happen if there's no error, but handle it just in case
        console.warn(
          '[AppContent] Subtitle generation finished without error, but no final subtitles data was returned.'
        );
        // setError('Subtitle generation finished, but final data was missing.');
      }
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
    setIsMergingInProgress(true);
    setMergeStage('Starting PNG sequence render...');
    setMergeOperationId(options.operationId);
    setSaveError('');

    try {
      const result = await subtitleRendererClient.renderSubtitles(options);

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
      try {
        const result = await window.electron.getVideoMetadata(filePath);
        if (result.success && result.metadata) {
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

  async function handleCancelDownload(operationId: string) {
    if (!operationId) {
      console.warn(
        '[AppContent] Cannot cancel download: operationId is missing.'
      );
      setIsProcessingUrl(false); // Hide progress
      return;
    }
    try {
      // Call the main process cancellation function
      await window.electron.cancelOperation(operationId);
    } catch (error) {
      console.error(
        `[AppContent] Error sending cancel request for download ${operationId}:`,
        error
      );
    } finally {
      // Hide the progress bar after attempting cancellation
      setIsProcessingUrl(false);
      setDownloadOperationId(null); // Clear the ID
      // *** Add resets ***
      setDownloadProgressPercent(0);
      setDownloadProgressStage('');
    }
  }
}

export default function App() {
  return <AppContent />;
}
