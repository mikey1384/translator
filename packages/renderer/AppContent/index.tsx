import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
} from 'react';
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
import type { VideoQuality, ProcessUrlResult } from '@shared-types/app';
import { useTranslation } from 'react-i18next';
import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';
import ProgressArea from '../components/ProgressAreas/ProgressArea.js';

import { parseSrt } from '../../shared/helpers/index.js';
import { useApiKeyStatus } from './hooks/useApiKeyStatus.js';
import { useSubtitleState } from './hooks/subtitles/useSubtitleState.js';
import { useSubtitleActions } from './hooks/subtitles/useSubtitleActions.js';

import { pageWrapperStyles, containerStyles, colors } from '../styles.js';
import { css } from '@emotion/css';
import { useVideoActions } from './hooks/video/useVideoActions.js';
import subtitleRendererClient from '../clients/subtitle-renderer-client.js';
import { SubtitleStylePresetKey } from '../../shared/constants/subtitle-styles.js';
import { getNativePlayerInstance } from '../native-player.js';

import * as FileIPC from '@ipc/file';
import * as VideoIPC from '@ipc/video';
import * as SubtitlesIPC from '@ipc/subtitles';
import * as UrlIPC from '@ipc/url';
import * as OperationIPC from '@ipc/operation';
import * as SystemIPC from '@ipc/system';

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

const DOWNLOAD_PROGRESS_COLOR = colors.progressDownload;

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
          throttled(...lastArgs);
          trailingCallScheduled = false;
        }
      }, delay);
    } else {
      trailingCallScheduled = true;
    }
  };

  throttled.cancel = () => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
    trailingCallScheduled = false;
  };

  return throttled as T & { cancel: () => void };
};

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
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  const [inputMode, setInputMode] = useState<'file' | 'url'>('file');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [mergeStage, setMergeStage] = useState('');
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeOperationId, setMergeOperationId] = useState<string | null>(null);

  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [matchedIndices, setMatchedIndices] = useState<number[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState<number>(0);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

  const { state: apiKeyState, refetch: fetchKeyStatus } = useApiKeyStatus();
  const isLoadingKeyStatus = apiKeyState.status === 'loading';
  const apiKeyStatus = apiKeyState.status === 'ready' ? apiKeyState.data : null;

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
    reset: resetSubtitleState,
  } = useSubtitleState();

  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const [saveError, setSaveError] = useState<string>('');

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [isVideoPlayerReady, setIsVideoPlayerReady] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const saveCurrentPositionImmediately = useCallback(
    async (filePathToSave: string | null, player: HTMLVideoElement | null) => {
      const now = new Date().toLocaleTimeString();
      const duration = player ? player.duration : 'N/A';
      const currentTime = player ? player.currentTime : 'N/A';
      const isPlayerValid = !!player;
      const isDurationValid = typeof duration === 'number' && duration > 0;
      const isTimeValid = typeof currentTime === 'number' && currentTime >= 0;
      console.log(
        `[${now}] [SAVE_IMMEDIATE_CHECK] Path: ${filePathToSave}, PlayerValid: ${isPlayerValid}, Duration: ${duration} (Valid: ${isDurationValid}), CurrentTime: ${currentTime} (Valid: ${isTimeValid})`
      );

      if (filePathToSave && player && player.duration > 0) {
        const position = player.currentTime;
        if (position >= 0) {
          console.log(
            `[${now}] [SAVE_IMMEDIATE_EXEC] Saving position for ${filePathToSave}: ${position}`
          );
          await VideoIPC.savePlaybackPosition(filePathToSave, position);
        } else {
          console.log(
            `[${now}] [SAVE_IMMEDIATE_SKIP] Reason: Inner check failed - Invalid position (${position})`
          );
        }
      } else {
        let reason = '';
        if (!filePathToSave) reason += 'No file path. ';
        if (!player) reason += 'Player is null. ';
        if (player && !(player.duration > 0))
          reason += `Invalid duration (${player?.duration}). `;
        console.log(
          `[${now}] [SAVE_IMMEDIATE_SKIP] Reason: Outer check failed - ${reason.trim()}`
        );
      }
    },
    []
  );

  const SAVE_INTERVAL = 5000;
  const saveCurrentPositionThrottled = useRef(
    throttle(
      (filePathToSave: string | null, player: HTMLVideoElement | null) => {
        saveCurrentPositionImmediately(filePathToSave, player);
      },
      SAVE_INTERVAL
    )
  ).current;

  useEffect(() => {
    const previousPath = previousVideoPathRef.current;

    if (isVideoPlayerReady) {
      const currentPlayer = getNativePlayerInstance(); // Get player here
      if (previousPath && previousPath !== videoFilePath && currentPlayer) {
        saveCurrentPositionImmediately(previousPath, currentPlayer);
      }
    }

    previousVideoPathRef.current = videoFilePath;

    return () => {
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
      originalSrtFilePath: originalSrtFilePath,
      setSaveError,
      onSaveAsComplete: handleSaveAsComplete,
      setSubtitleSegments,
      setSubtitleSourceId,
      showOriginalText,
    });

  const {
    handleSetVideoFile,
    handleTogglePlay,
    handleVideoPlayerReady,
    reset: resetVideoState,
  } = useVideoActions({
    setVideoFile,
    setVideoUrl,
    setVideoFilePath,
    setIsAudioOnly,
    setIsVideoPlayerReady,
    videoUrl,
    onSrtFileLoaded: handleSrtFileLoaded,
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

  const [mergeFontSize, setMergeFontSize] = useState<number>(24);
  const [mergeStylePreset, setMergeStylePreset] =
    useState<SubtitleStylePresetKey>('Default');

  const [downloadOperationId, setDownloadOperationId] = useState<string | null>(
    null
  );

  const [downloadProgressPercent, setDownloadProgressPercent] =
    useState<number>(0);
  const [downloadProgressStage, setDownloadProgressStage] =
    useState<string>('');

  const isInitialMount = useRef(true);
  const previousVideoPathRef = useRef<string | null>(null);

  const [isCancellingDownload, setIsCancellingDownload] = useState(false);

  useEffect(() => {
    if (!searchText) {
      setMatchedIndices([]);
      setActiveMatchIndex(0);
      return;
    }

    const lowerSearch = searchText.toLowerCase();
    const newMatches = subtitleSegments
      .map((seg, idx) => {
        const haystack = showOriginalText
          ? `${seg.original}\n${seg.translation ?? ''}`
          : (seg.translation ?? seg.original);

        return haystack.toLowerCase().includes(lowerSearch) ? idx : -1;
      })
      .filter(idx => idx !== -1);

    setMatchedIndices(newMatches);
    setActiveMatchIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, []);

  useEffect(() => {
    const unlisten = UrlIPC.onProgress((progress: any) => {
      const currentPercent = progress.percent ?? 0;
      const currentStage = progress.stage ?? '';
      const error = progress.error ?? null;

      // Handle cancellation gracefully
      if (currentStage === 'Download cancelled') {
        setIsProcessingUrl(false);
        setDownloadOperationId(null);
        setDownloadProgressPercent(0);
        setDownloadProgressStage('');
        setIsCancellingDownload(false);
        return;
      }

      setDownloadProgressPercent(currentPercent);
      setDownloadProgressStage(currentStage);

      if (error) {
        console.error('Error during download progress:', error);
        setError(`Error during download: ${error}`);
        setDownloadProgressStage(`Error: ${error}`);
        setDownloadProgressPercent(100);
        setIsProcessingUrl(true);
        setDownloadOperationId(null);
      }
    });
    return unlisten;
  }, []);

  useEffect(() => {
    const loadSavedLanguage = async () => {
      try {
        const savedLanguage = await SubtitlesIPC.getTargetLanguage();
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
    const saveLanguage = async () => {
      console.log(
        `[AppContent] Saving subtitle target language: ${targetLanguage}`
      );
      try {
        await SubtitlesIPC.setTargetLanguage(targetLanguage);
      } catch (error) {
        console.error(
          '[AppContent] Error saving subtitle target language:',
          error
        );
      }
    };

    if (!isInitialMount?.current) {
      if (targetLanguage) {
        saveLanguage();
      }
    } else {
      isInitialMount.current = false;
    }
  }, [targetLanguage]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isVideoPlayerReady) {
        const video = getNativePlayerInstance();
        console.log(
          '[AppContent] Window became visible. Checking video sync...'
        );
        if (video && !video.paused) {
          const currentTime = video.currentTime;
          console.log(
            `[AppContent] Nudging player & track. Current time: ${currentTime}`
          );

          let activeTrack: TextTrack | null = null;
          for (let i = 0; i < video.textTracks.length; i++) {
            if (video.textTracks[i].mode === 'showing') {
              activeTrack = video.textTracks[i];
              break;
            }
          }

          if (activeTrack) {
            const originalMode = activeTrack.mode;
            activeTrack.mode = 'hidden';
            video.currentTime = currentTime;

            setTimeout(() => {
              if (activeTrack) {
                activeTrack.mode = originalMode;
                console.log('[AppContent] Restored track mode.');
              }
            }, 10);
          } else {
            video.currentTime = currentTime;
          }
        } else {
          console.log(
            '[AppContent] Video is paused or player invalid, no nudge needed.'
          );
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    console.log('[AppContent] Added visibilitychange listener.');

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      console.log('[AppContent] Removed visibilitychange listener.');
    };
  }, [isVideoPlayerReady]);

  const handleTimeUpdate = useCallback(() => {
    const currentPlayer = getNativePlayerInstance();

    if (videoFilePath && currentPlayer) {
      saveCurrentPositionThrottled(videoFilePath, currentPlayer);
    }
  }, [videoFilePath, saveCurrentPositionThrottled]);

  const handlePause = useCallback(() => {
    const currentPlayer = getNativePlayerInstance();

    if (videoFilePath && currentPlayer) {
      saveCurrentPositionThrottled.cancel?.();
      saveCurrentPositionImmediately(videoFilePath, currentPlayer);
    }
  }, [
    videoFilePath,
    saveCurrentPositionThrottled,
    saveCurrentPositionImmediately,
  ]);

  useEffect(() => {
    const currentPath = videoFilePath;
    if (!currentPath) {
      saveCurrentPositionThrottled.cancel?.();
      return;
    }
    if (!isVideoPlayerReady) {
      console.log(`[AppContent] Player not ready for: ${currentPath}`);
      saveCurrentPositionThrottled.cancel?.();
      return;
    }

    const player = getNativePlayerInstance();
    if (!player) {
      console.error('[AppContent] Player is null despite readiness.');
      saveCurrentPositionThrottled.cancel?.();
      return;
    }

    // Now attach fresh listeners
    player.addEventListener('timeupdate', handleTimeUpdate);
    player.addEventListener('pause', handlePause);
    console.log(`[AppContent] Attached playback listeners for: ${currentPath}`);

    // Cleanup function → remove the listeners we just added
    return () => {
      console.log(`[AppContent] Detaching listeners for: ${currentPath}`);
      player.removeEventListener('timeupdate', handleTimeUpdate);
      player.removeEventListener('pause', handlePause);
    };
  }, [
    videoFilePath,
    isVideoPlayerReady,
    handleTimeUpdate,
    handlePause,
    saveCurrentPositionThrottled,
    saveCurrentPositionImmediately,
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
            await VideoIPC.getPlaybackPosition(videoFilePath);
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
  }, [videoFilePath, isVideoPlayerReady]);

  useEffect(() => {
    if (!previousVideoPathRef.current) {
      previousVideoPathRef.current = videoFilePath;
      return;
    }

    saveCurrentPositionThrottled.cancel?.();

    const oldPlayer = getNativePlayerInstance();
    if (oldPlayer) {
      oldPlayer.removeEventListener('timeupdate', handleTimeUpdate);
      oldPlayer.removeEventListener('pause', handlePause);
      console.log(
        `[AppContent] Removed event listeners for old file path: ${previousVideoPathRef.current}`
      );
    }

    previousVideoPathRef.current = videoFilePath;
  }, [
    videoFilePath,
    handleTimeUpdate,
    handlePause,
    saveCurrentPositionThrottled,
  ]);

  useEffect(() => {
    const remove = SubtitlesIPC.onMergeProgress(
      ({ percent = 0, stage = '', error }) => {
        setMergeProgress(percent);
        setMergeStage(stage);
        if (error) {
          setIsMergingInProgress(false);
          setMergeOperationId(null);
        }
      }
    );
    return remove;
  }, []);

  useLayoutEffect(() => {
    if (!videoUrl) return;
    requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      resetVideoState();
    };
  }, [resetVideoState]);

  return (
    <div className={pageWrapperStyles}>
      {!showSettings && videoUrl && (
        <div style={{ height: 'calc(35vh + 2rem)' }} />
      )}
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
                videoRef={videoRef}
                videoUrl={videoUrl}
                subtitles={subtitleSegments}
                onPlayerReady={handleVideoPlayerReady}
                onSelectVideoClick={handleSelectVideoClick}
                onProcessUrl={onProcessUrl}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
                onSetUrlInput={setUrlInput}
                onSetSubtitleSegments={handleSetSubtitleSegments}
                onSrtFileLoaded={handleSrtFileLoaded}
                urlInput={urlInput}
                isProgressBarVisible={
                  isMergingInProgress || isTranslationInProgress
                }
                mergeFontSize={mergeFontSize}
                mergeStylePreset={mergeStylePreset}
                downloadQuality={downloadQuality}
                onSetDownloadQuality={setDownloadQuality}
                showOriginalText={showOriginalText}
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
                onShowOriginalTextChange={setShowOriginalText}
                showOriginalText={showOriginalText}
                targetLanguage={targetLanguage}
                urlInput={urlInput}
                videoFile={videoFile}
                videoFilePath={videoFilePath}
                isMergingInProgress={isMergingInProgress}
              />

              <div ref={editSubtitlesRef} id="edit-subtitles-section">
                <EditSubtitles
                  showOriginalText={showOriginalText}
                  isAudioOnly={isAudioOnly}
                  videoFile={videoFile}
                  videoFilePath={videoFilePath}
                  subtitles={subtitleSegments}
                  videoPlayerRef={
                    isVideoPlayerReady ? getNativePlayerInstance() : null
                  }
                  isMergingInProgress={isMergingInProgress}
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
                  isTranslationInProgress={isTranslationInProgress}
                />
              </div>
            </div>

            <ProgressArea
              isVisible={
                isProcessingUrl &&
                downloadProgressPercent > 0 &&
                !downloadComplete
              }
              title="Download in Progress"
              progress={downloadProgressPercent}
              stage={downloadProgressStage}
              progressBarColor={
                downloadProgressStage.toLowerCase().includes('error')
                  ? colors.danger
                  : DOWNLOAD_PROGRESS_COLOR
              }
              operationId={downloadOperationId}
              isCancelling={isCancellingDownload}
              onCancel={handleCancelDownload}
              onClose={() => {
                setIsProcessingUrl(false);
                setDownloadOperationId(null);
                setDownloadProgressPercent(0);
                setDownloadProgressStage('');
              }}
              autoCloseDelay={4000}
            />

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
      const result = await FileIPC.open({
        properties: ['openFile'],
        filters: [
          {
            name: 'Media Files',
            extensions: [
              'mp4',
              'mkv',
              'avi',
              'mov',
              'webm',
              'mp3',
              'wav',
              'aac',
              'ogg',
              'flac',
            ],
          },
        ],
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown_media';

        setDownloadedVideoPath(null);

        await handleSetVideoFile({ path: filePath, name: fileName });

        await handleVideoFileSelected(filePath);
      } else {
        console.log('File selection cancelled or no file chosen.');
      }
    } catch (err: any) {
      console.error('Error opening file dialog:', err);
    }
  }

  function handleBackFromSettings() {
    setShowSettings(false);
    if (typeof fetchKeyStatus === 'function') {
      fetchKeyStatus();
    }
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
      if (typeof fetchKeyStatus === 'function') {
        fetchKeyStatus();
      }
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
      const saveDialogResult = await FileIPC.save({
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

      const copyRes = await FileIPC.copy(
        downloadedVideoPath,
        saveDialogResult.filePath
      );
      if (copyRes.error) throw new Error(copyRes.error);

      SystemIPC.showMessage(`Video saved: ${saveDialogResult.filePath}`);
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
    setDownloadProgressStage(`Error: ${err.message || err}`);
    setDownloadProgressPercent(100);
    setIsProcessingUrl(true);
    resetVideoState();
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

    const updatedSegments = replaceAll(subtitleSegments);
    handleSetSubtitleSegments(updatedSegments);

    setMatchedIndices([]);
    setActiveMatchIndex(0);

    function replaceAll(currentSegments: SrtSegment[]) {
      try {
        const escapedFindText = findText.replace(/[.*+?^${}()|[\\\]]/g, '\\$&');
        const regex = new RegExp(escapedFindText, 'gi');

        return currentSegments.map(seg => ({
          ...seg,
          translation: (seg.translation ?? '').replace(regex, replaceWithText),
        }));
      } catch (error) {
        console.error('Error during Replace All regex operation:', error);
        setSaveError(`Error during replacement: ${error}`);
        return currentSegments;
      }
    }
  }

  function handleSrtFileLoaded(filePath: string | null) {
    setOriginalSrtFilePath(filePath);
    setSaveError('');
  }

  async function onProcessUrl() {
    if (!urlInput) {
      setError('Please enter a valid video URL');
      return;
    }
    resetUrlStates();
    const newDownloadId = `download-${Date.now()}`;
    setDownloadOperationId(newDownloadId);

    const optionsToSend = {
      url: urlInput,
      quality: downloadQuality,
      operationId: newDownloadId,
    };
    console.log(
      '[AppContent] Calling UrlIPC.process with options:',
      JSON.stringify(optionsToSend)
    );

    try {
      const result = (await UrlIPC.process(optionsToSend)) as ProcessUrlResult;

      if (result.cancelled) {
        console.log('[AppContent] Download operation was cancelled.');
        resetUrlStates();
        setIsProcessingUrl(false);
        setDownloadOperationId(null);
        return;
      }

      if (result.error) {
        throw new Error(result.error);
      }

      const videoPath = result.videoPath || result.filePath;
      if (!videoPath || !result.filename) {
        throw new Error('Downloaded video info incomplete');
      }
      finishUrlDownload(result, videoPath);
      setUrlInput('');
      setIsProcessingUrl(false);
    } catch (err: any) {
      if (err?.isCancelled) {
        console.log('[AppContent] Download operation was cancelled.');
        resetUrlStates();
        setIsProcessingUrl(false);
        setDownloadOperationId(null);
        return;
      }
      handleUrlError(err);
    }
  }

  function resetUrlStates() {
    setError('');
    setIsProcessingUrl(true);
    setDownloadComplete(false);
    setDownloadProgressPercent(0);
    setDownloadProgressStage('');
    setDownloadOperationId(null);
  }

  async function finishUrlDownload(result: any, videoPath: string) {
    setDownloadComplete(true);
    setDownloadedVideoPath(videoPath);
    setVideoFilePath(videoPath);
    setDidDownloadFromUrl(true);
    await handleVideoFileSelected(videoPath);
    resetSubtitleState();

    try {
      const fileContentResult = await FileIPC.readFileContent(videoPath);
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
    } catch {
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
    if (!videoFile && !videoFilePath) {
      setError('Please select a video file first');
      return;
    }
    setError('');
    resetSubtitleState();
    setIsGenerating(true);
    const operationId = `generate-${Date.now()}`;
    setIsTranslationInProgress(true);
    try {
      const options = buildGenerateOptions();
      options.operationId = operationId;
      const result = await SubtitlesIPC.generate(options);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.subtitles) {
        handleSrtFileLoaded(null);
        setOriginalSrtFilePath(null);
        try {
          const finalSegments = parseSrt(result.subtitles);
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
      } else if (result.cancelled) {
        setIsGenerating(false);
      } else {
        setError(
          'No subtitles were generated. This could be due to a language not being supported, audio quality, internet connection issues, or the video being too short.'
        );
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
        setMergeStage('Overlay video saved successfully!');
        setTimeout(() => setIsMergingInProgress(false), 3500);
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
      setIsMergingInProgress(false);
      setMergeStage(`Error: ${errorMessage.substring(0, 100)}`);
      setSaveError(errorMessage);
      setMergeOperationId(null);
      return { success: false, error: errorMessage };
    }
  }

  async function handleVideoFileSelected(filePath: string) {
    setVideoFilePath(filePath);
    setVideoMetadata(null);
    if (filePath) {
      try {
        if (!isAudioOnly) {
          const result = await VideoIPC.getMetadata(filePath);
          if (result.success && result.metadata) {
            setVideoMetadata(result.metadata);
          } else {
            console.error(
              '[AppContent] Failed to get video metadata:',
              result.error
            );
            setError(`Failed to get video metadata: ${result.error}`);
          }
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
      setIsProcessingUrl(false);
      return;
    }

    try {
      setIsCancellingDownload(true);
      console.log(
        `[AppContent] Sending cancel request for download ${operationId}`
      );
      await OperationIPC.cancel(operationId);
    } catch (error) {
      console.error(
        `[AppContent] Error sending cancel request for download ${operationId}:`,
        error
      );
    } finally {
      setIsCancellingDownload(false);
      setIsProcessingUrl(false);
      setDownloadOperationId(null);
      setDownloadProgressPercent(0);
      setDownloadProgressStage('');
    }
  }
}

export default function App() {
  return <AppContent />;
}
