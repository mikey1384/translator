import { useEffect, useState, useRef, useCallback } from 'react';

import BackToTopButton from './components/BackToTopButton';
import SettingsPage from './containers/SettingsPage';
import StickyVideoPlayer from './containers/EditSubtitles/StickyVideoPlayer';
import { nativePlayer } from './components/NativeVideoPlayer';
import { EditSubtitles } from './containers/EditSubtitles';
import GenerateSubtitles from './containers/GenerateSubtitles';
import MergingProgressArea from './containers/MergingProgressArea';
import TranslationProgressArea from './containers/TranslationProgressArea';
import LogoDisplay from './components/LogoDisplay';

import { ManagementContextProvider } from './context';
import { SrtSegment } from '../types/interface';

import {
  parseSrt,
  secondsToSrtTime,
  buildSrt,
  fixOverlappingSegments,
} from './helpers';

// Styles
import { pageWrapperStyles, containerStyles } from './styles';
import { css } from '@emotion/css';
import { colors } from './styles';

// Group for logo and settings button
const headerRightGroupStyles = css`
  display: flex;
  align-items: center;
  gap: 15px; // Gap between logo and button
`;

// Define Key Status Type
type ApiKeyStatus = {
  openai: boolean;
  anthropic: boolean;
} | null;

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

function AppContent() {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>(null);
  const [isLoadingKeyStatus, setIsLoadingKeyStatus] = useState<boolean>(true);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');

  const [subtitleSegments, setSubtitleSegments] = useState<SrtSegment[]>([]);

  const [isTranslationInProgress, setIsTranslationInProgress] =
    useState<boolean>(false);
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);

  const [translationProgress, setTranslationProgress] = useState(0);
  const [translationStage, setTranslationStage] = useState('');
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');

  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

  const [isReceivingPartialResults, setIsReceivingPartialResults] =
    useState<boolean>(false);

  // New state to track the start index of the last reviewed batch
  const [reviewedBatchStartIndex, setReviewedBatchStartIndex] = useState<
    number | null
  >(null);

  const mainContentRef = useRef<HTMLDivElement>(null);

  const hasScrolledToStickyRef = useRef(false);

  const editSubtitlesRef = useRef<HTMLDivElement>(null);

  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({
    scrollToCurrentSubtitle: () => {},
  });

  // Ref to hold the latest handlePartialResult callback
  const handlePartialResultRef = useRef<any>(null);

  // --- Fetch API Key Status ---
  const fetchKeyStatus = useCallback(async () => {
    console.log('Attempting to fetch API key status...');
    setIsLoadingKeyStatus(true);
    try {
      const result = await window.electron.getApiKeyStatus();
      if (result.success) {
        console.log('API Key Status fetched:', result.status);
        setApiKeyStatus(result.status);
      } else {
        console.error('Failed to fetch key status:', result.error);
        setApiKeyStatus({ openai: false, anthropic: false }); // Assume none set on error
      }
    } catch (error) {
      console.error('Error calling getApiKeyStatus:', error);
      setApiKeyStatus({ openai: false, anthropic: false });
    } finally {
      setIsLoadingKeyStatus(false);
      console.log('Finished fetching API key status.');
    }
  }, []);

  // Fetch status on initial mount
  useEffect(() => {
    fetchKeyStatus();
  }, [fetchKeyStatus]);

  // --- Centralized Video File Handling ---
  const handleSetVideoFile = useCallback(
    (file: File | null) => {
      // Clean up previous URL if it exists
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setVideoFile(file);

      if (file) {
        const url = URL.createObjectURL(file);
        setVideoUrl(url);
        setIsPlaying(false); // Reset playback state on new video
        // Potentially reset subtitle segments if needed?
        // setSubtitleSegments([]);
      } else {
        // If file is null, clear the URL
        setVideoUrl('');
        setIsPlaying(false);
        setSubtitleSegments([]); // Clear subtitles if video removed
      }
    },
    [videoUrl] // Dependency: videoUrl for cleanup
  );

  const handleSetIsPlaying = useCallback((playing: boolean) => {
    setIsPlaying(playing);
  }, []);

  const handleSetSubtitleSegments = useCallback(
    (segments: SrtSegment[] | ((prevState: SrtSegment[]) => SrtSegment[])) => {
      setSubtitleSegments(segments);
    },
    []
  );

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
  // --- End Wrapped Callbacks ---

  const handleScrollToCurrentSubtitle = () => {
    if (editSubtitlesMethodsRef.current) {
      editSubtitlesMethodsRef.current.scrollToCurrentSubtitle();
    }
  };

  const handlePartialResult = useCallback(
    (result: {
      partialResult?: string;
      percent?: number;
      stage?: string;
      current?: number;
      total?: number;
      batchStartIndex?: number;
    }) => {
      try {
        const safeResult = {
          partialResult: result?.partialResult || '',
          percent: result?.percent || 0,
          stage: result?.stage || 'Processing',
          current: result?.current || 0,
          total: result?.total || 100,
          batchStartIndex: result?.batchStartIndex,
        };

        if (safeResult.batchStartIndex !== undefined) {
          setReviewedBatchStartIndex(safeResult.batchStartIndex);
        }

        if (
          safeResult.partialResult &&
          safeResult.partialResult.trim().length > 0
        ) {
          setIsReceivingPartialResults(true);
          const parsedSegments = parseSrt(safeResult.partialResult);
          const processedSegments = parsedSegments.map(segment => {
            let processedText = segment.text;
            if (segment.text.includes('###TRANSLATION_MARKER###')) {
              if (showOriginalText) {
                processedText = segment.text.replace(
                  '###TRANSLATION_MARKER###',
                  '\n'
                );
              } else {
                const parts = segment.text.split('###TRANSLATION_MARKER###');
                processedText = parts[1] ? parts[1].trim() : '';
              }
            }
            return {
              ...segment,
              text: processedText,
            };
          });

          setSubtitleSegments(prevSegments => {
            // Simplified update logic for clarity
            // A more robust check might compare based on segment IDs if available
            const newSrt = buildSrt(processedSegments);
            const prevSrt = buildSrt(prevSegments);
            return newSrt !== prevSrt ? processedSegments : prevSegments;
          });
        }

        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);
        // Only set to true, let other components set to false when done/closed
        if (safeResult.percent < 100) {
          setIsTranslationInProgress(true);
        }
      } catch (error) {
        console.error('Error handling partial result:', error);
      }
    },
    // Keep dependencies for useCallback
    [
      showOriginalText,
      setSubtitleSegments,
      setIsTranslationInProgress,
      setTranslationProgress,
      setTranslationStage,
      setIsReceivingPartialResults,
      setReviewedBatchStartIndex,
    ]
  );

  // Effect to keep the ref updated with the latest callback
  useEffect(() => {
    handlePartialResultRef.current = handlePartialResult;
  }, [handlePartialResult]);

  // Effect to set up IPC listeners - runs only once
  useEffect(() => {
    // Use the ref inside the handler
    const handleProgressUpdate = (progress: any) => {
      if (handlePartialResultRef.current) {
        handlePartialResultRef.current(progress || {});
      }
    };

    let cleanupGenerate: (() => void) | null = null;
    let cleanupTranslate: (() => void) | null = null;

    if (window.electron) {
      if (typeof window.electron.onGenerateSubtitlesProgress === 'function') {
        const cleanup =
          window.electron.onGenerateSubtitlesProgress(handleProgressUpdate);
        if (typeof cleanup === 'function') {
          cleanupGenerate = cleanup;
        }
      }
      if (typeof window.electron.onTranslateSubtitlesProgress === 'function') {
        const cleanup =
          window.electron.onTranslateSubtitlesProgress(handleProgressUpdate);
        if (typeof cleanup === 'function') {
          cleanupTranslate = cleanup;
        }
      }
    }

    return () => {
      cleanupGenerate?.();
      cleanupTranslate?.();
    };
  }, []); // Empty dependency array - runs only once

  // --- Player Control Handlers ---
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

  const handleShiftAllSubtitles = useCallback((offsetSeconds: number) => {
    setSubtitleSegments(currentSegments =>
      currentSegments.map(segment => ({
        ...segment,
        start: Math.max(0, segment.start + offsetSeconds),
        end: Math.max(0.01, segment.end + offsetSeconds), // Ensure end is slightly after start if start becomes 0
      }))
    );
  }, []);

  // --- Updated Subtitle Generated Handler ---
  // Only needs to handle subtitles now, video is set via handleSetVideoFile
  const handleSubtitlesGenerated = useCallback(
    (generatedSubtitles: string) => {
      try {
        const segments = parseSrt(generatedSubtitles);
        const fixedSegments = fixOverlappingSegments(segments);
        setSubtitleSegments(fixedSegments);
        // No need to set video file/URL here anymore
      } catch (err) {
        console.error('Error parsing generated subtitles:', err);
      }
    },
    [] // No dependencies needed now
  );

  // --- Updated handleToggleSettings ---
  // Renamed from simple setShowSettings(false) in SettingsPage's onBack
  const handleToggleSettings = (show: boolean) => {
    setShowSettings(show);
    // If returning *from* settings, refresh the key status
    if (!show) {
      fetchKeyStatus();
    }
  };

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
                onSrtLoaded={setSubtitleSegments}
                onStickyChange={handleStickyChange}
                onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
                onTogglePlay={handleTogglePlay}
                onShiftAllSubtitles={handleShiftAllSubtitles}
              />
            )}

            <div ref={mainContentRef} style={{ position: 'relative' }}>
              <GenerateSubtitles
                videoFile={videoFile}
                onSetVideoFile={handleSetVideoFile}
                onSubtitlesGenerated={handleSubtitlesGenerated}
                showOriginalText={showOriginalText}
                onShowOriginalTextChange={setShowOriginalText}
                apiKeyStatus={apiKeyStatus}
                isLoadingKeyStatus={isLoadingKeyStatus}
                onNavigateToSettings={handleToggleSettings}
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

  // --- Helper Functions ---

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused);
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
