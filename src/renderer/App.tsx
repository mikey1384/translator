import { useEffect, useState, useRef, useCallback } from 'react';

import StatusSection from './components/StatusSection';
import BackToTopButton from './components/BackToTopButton';
import StickyVideoPlayer from './containers/EditSubtitles/StickyVideoPlayer';
import { nativePlayer } from './components/NativeVideoPlayer';
import { EditSubtitles } from './containers/EditSubtitles';
import GenerateSubtitles from './containers/GenerateSubtitles';
import MergingProgressArea from './containers/MergingProgressArea';
import TranslationProgressArea from './containers/TranslationProgressArea';

import { ManagementContextProvider } from './context';
import { SrtSegment } from '../types/interface';

import {
  parseSrt,
  secondsToSrtTime,
  buildSrt,
  fixOverlappingSegments,
} from './helpers';

// Styles
import { pageWrapperStyles, containerStyles, titleStyles } from './styles';

function AppContent() {
  const [electronConnected, setElectronConnected] = useState<boolean>(false);

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

  const mainContentRef = useRef<HTMLDivElement>(null);

  const hasScrolledToStickyRef = useRef(false);

  const editSubtitlesRef = useRef<HTMLDivElement>(null);

  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({
    scrollToCurrentSubtitle: () => {},
  });

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
    }) => {
      try {
        const safeResult = {
          partialResult: result?.partialResult || '',
          percent: result?.percent || 0,
          stage: result?.stage || 'Processing',
          current: result?.current || 0,
          total: result?.total || 100,
        };

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
            if (prevSegments.length !== processedSegments.length) {
              return processedSegments;
            }
            const prevSrt = buildSrt(prevSegments);
            const newSrt = buildSrt(processedSegments);
            if (prevSrt !== newSrt) {
              return processedSegments;
            }
            return prevSegments;
          });
        }

        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);
        setIsTranslationInProgress(true);
      } catch (error) {
        console.error('Error handling partial result:', error);
      }
    },
    [showOriginalText, setSubtitleSegments]
  );

  useEffect(() => {
    const checkElectron = async () => {
      try {
        if (window.electron) {
          try {
            setElectronConnected(true);
          } catch (innerError) {
            setElectronConnected(true);
          }
        }
      } catch (err) {
        setElectronConnected(true);
      }
    };

    checkElectron();
  }, []);

  useEffect(() => {
    const handleProgressUpdate = (progress: any) => {
      handlePartialResult(progress || {});
    };

    let cleanupGenerate: (() => void) | null = null;
    let cleanupTranslate: (() => void) | null = null;

    if (window.electron) {
      if (typeof window.electron.onGenerateSubtitlesProgress === 'function') {
        window.electron.onGenerateSubtitlesProgress(handleProgressUpdate);
        cleanupGenerate = () => {
          window.electron.onGenerateSubtitlesProgress(null);
        };
      }

      if (typeof window.electron.onTranslateSubtitlesProgress === 'function') {
        window.electron.onTranslateSubtitlesProgress(handleProgressUpdate);
        cleanupTranslate = () => {
          window.electron.onTranslateSubtitlesProgress(null);
        };
      }
    }

    return () => {
      cleanupGenerate?.();
      cleanupTranslate?.();
    };
  }, [handlePartialResult]);

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

  return (
    <div className={pageWrapperStyles}>
      <div id="top-padding" style={{ height: '10px' }}></div>
      <div className={containerStyles}>
        <h1 className={titleStyles}>Subtitle Generator & Translator</h1>

        <StatusSection isConnected={electronConnected} />

        {videoUrl && (
          <StickyVideoPlayer
            videoUrl={videoUrl}
            subtitles={subtitleSegments}
            onPlayerReady={handleVideoPlayerReady}
            onChangeVideo={handleChangeVideo}
            onSrtLoaded={setSubtitleSegments}
            onStickyChange={handleStickyChange}
            onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
            onTogglePlay={handleTogglePlay}
            onShiftAllSubtitles={handleShiftAllSubtitles}
          />
        )}

        <div ref={mainContentRef} style={{ position: 'relative' }}>
          <GenerateSubtitles
            onSubtitlesGenerated={handleSubtitlesGenerated}
            showOriginalText={showOriginalText}
            onShowOriginalTextChange={setShowOriginalText}
          />

          <div ref={editSubtitlesRef} id="edit-subtitles-section">
            <EditSubtitles
              videoFile={videoFile}
              videoUrl={videoUrl}
              isPlaying={isPlaying}
              onSetVideoFile={setVideoFile}
              onSetVideoUrl={handleSetVideoUrl}
              onSetIsPlaying={setIsPlaying}
              secondsToSrtTime={secondsToSrtTime}
              parseSrt={parseSrt}
              subtitles={subtitleSegments}
              videoPlayerRef={videoPlayerRef}
              isMergingInProgress={isMergingInProgress}
              onSetIsMergingInProgress={setIsMergingInProgress}
              editorRef={editSubtitlesMethodsRef}
              onMergeSubtitlesWithVideo={handleMergeSubtitlesWithVideo}
              onSetSubtitlesDirectly={setSubtitleSegments}
            />
          </div>
        </div>

        {isTranslationInProgress && (
          <TranslationProgressArea
            progress={translationProgress}
            progressStage={translationStage}
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
          />
        )}

        <BackToTopButton />
      </div>
    </div>
  );

  // --- Helper Functions ---

  function handleSubtitlesGenerated(
    generatedSubtitles: string,
    videoFile: File
  ) {
    try {
      const segments = parseSrt(generatedSubtitles);
      const fixedSegments = fixOverlappingSegments(segments);
      setSubtitleSegments(fixedSegments);

      // Now also set the video file and URL
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl); // Clean up previous URL if exists
      }
      setVideoFile(videoFile);
      const url = URL.createObjectURL(videoFile);
      setVideoUrl(url);
    } catch (err) {
      console.error('Error parsing generated subtitles:', err);
    }
  }

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused);
    }
  }

  function handleSetVideoUrl(url: string | null) {
    if (url !== null) {
      setVideoUrl(url);
    }
  }

  function handleChangeVideo(file: File) {
    if (file) {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setIsPlaying(false);
    }
  }

  async function handleMergeSubtitlesWithVideo(
    videoFile: File,
    subtitles: SrtSegment[],
    options: { onProgress: (percent: number) => void }
  ) {
    setIsMergingInProgress(true);
    setMergeProgress(0);
    setMergeStage('Preparing subtitle file...');

    try {
      const srtContent = buildSrt(fixOverlappingSegments(subtitles));

      setMergeStage('Saving subtitle file...');
      const subtitlesResult = await window.electron.saveFile({
        content: srtContent,
        defaultPath: 'subtitles.srt',
        filters: [{ name: 'Subtitle Files', extensions: ['srt'] }],
      });

      if (subtitlesResult.error) {
        throw new Error(subtitlesResult.error);
      }

      setMergeStage('Merging subtitles with video...');
      window.electron.onMergeSubtitlesProgress(progress => {
        setMergeProgress(progress.percent);
        setMergeStage(progress.stage);
        options.onProgress(progress.percent);
      });

      const videoPath = videoFile.path || videoFile.name;

      const result = await window.electron.mergeSubtitles({
        videoPath: videoPath,
        subtitlesPath: subtitlesResult.filePath,
      });

      setMergeProgress(100);
      setMergeStage('Merge complete!');

      setTimeout(() => {
        setIsMergingInProgress(false);
      }, 1500);

      if (result.error) {
        throw new Error(result.error);
      }

      return result;
    } catch (error) {
      setMergeStage(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setTimeout(() => {
        setIsMergingInProgress(false);
      }, 3000);
      throw error;
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
