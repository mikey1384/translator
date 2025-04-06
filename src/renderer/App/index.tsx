import { useState, useRef, useEffect } from 'react';
import BackToTopButton from '../components/BackToTopButton.js';
import SettingsPage from '../containers/SettingsPage.js';
import StickyVideoPlayer from '../containers/EditSubtitles/StickyVideoPlayer.js';
import { nativePlayer } from '../components/NativeVideoPlayer.js';
import { EditSubtitles } from '../containers/EditSubtitles/index.js';
import GenerateSubtitles from '../containers/GenerateSubtitles/index.js';
import MergingProgressArea from '../containers/MergingProgressArea.js';
import TranslationProgressArea from '../containers/TranslationProgressArea.js';
import LogoDisplay from '../components/LogoDisplay.js';
import FindBar from '../components/FindBar.js';

import { ManagementContextProvider } from '../context/index.js';
import { SrtSegment, VideoQuality } from '../../types/interface.js';

import { parseSrt, secondsToSrtTime } from '../../shared/helpers/index.js';
import { useApiKeyStatus } from './hooks/useApiKeyStatus.js';
import { useSubtitleManagement } from './hooks/useSubtitleManagement.js';
import { useSubtitleSaving } from '../containers/EditSubtitles/hooks/useSubtitleSaving.js';

import { pageWrapperStyles, containerStyles, colors } from '../styles.js';
import { css } from '@emotion/css';

type FindResults = {
  matches: number;
  activeMatchOrdinal: number;
};

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
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');
  const [mergeOperationId, setMergeOperationId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string>('');
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);

  const [isFindBarVisible, setIsFindBarVisible] = useState(false);
  const [findResults, setFindResults] = useState<FindResults>({
    matches: 0,
    activeMatchOrdinal: 0,
  });

  const [isUrlLoading, setIsUrlLoading] = useState(false);
  const [urlLoadProgressPercent, setUrlLoadProgressPercent] = useState(0);
  const [urlLoadProgressStage, setUrlLoadProgressStage] = useState('');

  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const {
    subtitleSegments,
    handleSetSubtitleSegments,
    isTranslationInProgress,
    translationProgress,
    translationStage,
    setIsTranslationInProgress,
    isReceivingPartialResults,
    reviewedBatchStartIndex,
    resetSubtitleSource,
    translationOperationId,
  } = useSubtitleManagement(showOriginalText);

  const { canSaveDirectly, handleSaveSrt, handleSaveEditedSrtAs } =
    useSubtitleSaving({
      subtitles: subtitleSegments,
      originalSrtFilePath: originalSrtFilePath,
      setSaveError: setSaveError,
      onSaveAsComplete: handleSaveAsComplete,
    });

  const mainContentRef = useRef<HTMLDivElement>(null);
  const editSubtitlesRef = useRef<HTMLDivElement>(null);
  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({
    scrollToCurrentSubtitle: () => {},
  });

  useEffect(() => {
    if (!window.electron?.onProcessUrlProgress) return;

    console.log('[App] Setting up URL progress listener.');

    const cleanup = window.electron.onProcessUrlProgress(progress => {
      if (isUrlLoading) {
        console.log('[App] URL Progress Update:', progress);
        setUrlLoadProgressPercent(progress.percent ?? urlLoadProgressPercent);
        setUrlLoadProgressStage(progress.stage ?? urlLoadProgressStage);

        if (progress.percent >= 100 || progress.error) {
          setIsUrlLoading(false);
          if (progress.error) {
            setSaveError(`Error during processing: ${progress.error}`);
          }
        }
      }
    });

    return () => {
      console.log('[App] Cleaning up URL progress listener.');
      cleanup();
    };
  }, [isUrlLoading, urlLoadProgressPercent, urlLoadProgressStage]);

  useEffect(() => {
    if (!window.electron?.onProcessUrlProgress) return;

    console.log('[App] Setting up URL progress listener.');

    const cleanup = window.electron.onProcessUrlProgress(progress => {
      // Only update state if we are actually in the URL loading process
      if (isUrlLoading) {
        console.log('[App] URL Progress Update:', progress);
        setUrlLoadProgressPercent(progress.percent ?? urlLoadProgressPercent);
        setUrlLoadProgressStage(progress.stage ?? urlLoadProgressStage);

        // Handle completion or error
        if (progress.percent >= 100 || progress.error) {
          setIsUrlLoading(false);
          if (progress.error) {
            setSaveError(`Error during processing: ${progress.error}`);
          }
        }
      }
    });

    return () => {
      console.log('[App] Cleaning up URL progress listener.');
      cleanup();
    };
  }, [isUrlLoading, urlLoadProgressPercent, urlLoadProgressStage]);

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
  }, [setIsFindBarVisible, setFindResults]); // Added dependencies for exhaustive-deps

  return (
    <div className={pageWrapperStyles}>
      {videoUrl && <div style={{ height: 'CALC(35vh + 2rem)' }} />}
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
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown_video'; // Extract filename
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
    window.electron?.sendStopFind();
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

  function handleSrtFileLoaded(filePath: string) {
    console.log(
      '[AppContent] SRT file loaded, setting original path:',
      filePath
    );
    setOriginalSrtFilePath(filePath);
    setSaveError('');
  }

  function handleToggleSettings(show: boolean) {
    setShowSettings(show);
    if (!show) {
      fetchKeyStatus();
    }
  }

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused);
    }
  }

  function handleSaveAsComplete(newFilePath: string) {
    console.log(
      '[AppContent] Save As complete, setting original path to:',
      newFilePath
    );
    setOriginalSrtFilePath(newFilePath); // Update path after successful Save As
  }

  function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
    console.log(fileData);
    resetSubtitleSource();

    if (videoUrl && videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl);
    }

    if (!fileData) {
      setVideoFile(null);
      setVideoUrl('');
      setVideoFilePath(null);
      setIsPlaying(false);
      handleSetSubtitleSegments([]);
      return;
    }

    if (
      typeof fileData === 'object' &&
      fileData !== null &&
      !(fileData instanceof File) &&
      'path' in fileData &&
      fileData.path
    ) {
      console.log(
        '[App.tsx handleSetVideoFile] Branch: Detected object with path (priority check).'
      );
      const minimalFileObject = new File([], fileData.name, {
        type: 'video/*',
      });
      (minimalFileObject as any).path = fileData.path;
      setVideoFile(minimalFileObject as File);
      console.log(fileData);
      setVideoFilePath(fileData.path);
      const encodedPath = encodeURI(fileData.path.replace(/\\/g, '/'));
      setVideoUrl(`file://${encodedPath}`);
      console.log(
        '[App.tsx handleSetVideoFile] Setting videoFilePath to:',
        fileData.path
      );
    } else if (
      typeof fileData === 'object' &&
      fileData !== null &&
      (fileData as any)._blobUrl
    ) {
      console.log('[App.tsx handleSetVideoFile] Branch: Detected _blobUrl.');
      const blobFileData = fileData as any;
      setVideoFile(blobFileData as File);
      setVideoUrl(blobFileData._blobUrl);
      setVideoFilePath(blobFileData._originalPath || null);
      console.log(
        '[App.tsx handleSetVideoFile] Setting videoFilePath to:',
        blobFileData._originalPath || null
      );
    } else if (fileData instanceof File) {
      console.log(
        '[App.tsx handleSetVideoFile] Branch: Detected instanceof File.'
      );
      setVideoFile(fileData);
      setVideoFilePath(fileData.path);
      console.log(
        '[App.tsx handleSetVideoFile] Setting videoFilePath to: null (instanceof File)'
      );
      const blobUrl = URL.createObjectURL(fileData);
      setVideoUrl(blobUrl);
    } else {
      console.warn(
        '[App.tsx handleSetVideoFile] Branch: Fallback/unexpected case.',
        fileData
      );
      setVideoFile(null);
      setVideoUrl('');
      setVideoFilePath(null);
      console.log(
        '[App.tsx handleSetVideoFile] Setting videoFilePath to: null (Fallback)'
      );
    }
    setIsPlaying(false);
    handleSetSubtitleSegments([]);
  }

  async function handleTogglePlay() {
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
  }

  async function handleLoadFromUrl(url: string, quality: VideoQuality) {
    if (!url || !window.electron) {
      console.error('Invalid URL or Electron API not available.');
      return;
    }

    console.log(
      `[App] handleLoadFromUrl called with URL: ${url}, Quality: ${quality}`
    );
    // Reset relevant states
    setIsMergingInProgress(false); // Ensure merge progress is hidden
    setIsTranslationInProgress(false); // Ensure translation progress is hidden
    setMergeProgress(0);
    setMergeStage('');
    setMergeOperationId(null);
    setSaveError('');
    setIsUrlLoading(true);
    setUrlLoadProgressPercent(0);
    setUrlLoadProgressStage('Initializing...');

    try {
      const result = await window.electron.processUrl({
        url: url,
        quality: quality,
      });

      console.log(
        '[App] Received result from window.electron.processUrl:',
        JSON.stringify(result)
      );

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.filePath && result.filename) {
        // Read the content and create a Blob URL / File object
        const fileContentResult = await window.electron.readFileContent(
          result.filePath
        );
        if (!fileContentResult.success || !fileContentResult.data) {
          throw new Error(
            fileContentResult.error ||
              'Failed to read downloaded video content.'
          );
        }
        const blob = new Blob([fileContentResult.data], {
          type: 'video/mp4',
        });
        const blobUrl = URL.createObjectURL(blob);
        const videoFileObj = new File([blob], result.filename, {
          type: 'video/mp4',
        });
        (videoFileObj as any)._blobUrl = blobUrl;
        (videoFileObj as any)._originalPath = result.filePath;

        // Call handleSetVideoFile with the new object
        handleSetVideoFile(videoFileObj as any);
      } else {
        throw new Error('URL processing did not return necessary video info.');
      }
    } catch (err: any) {
      console.error('[App] Error processing URL from sticky player:', err);
      setSaveError(`Error loading URL: ${err.message || err}`);
      setIsUrlLoading(false); // Stop loading on error
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
