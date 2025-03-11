import { useEffect, useState, useRef, useCallback } from 'react';

import StatusSection from './components/StatusSection';
import GenerateSubtitles from './components/GenerateSubtitles';
import EditSubtitles from './components/EditSubtitles';
import BackToTopButton from './components/BackToTopButton';
import StickyVideoPlayer from './components/StickyVideoPlayer';
import MergingProgressArea from './components/MergingProgressArea';
import TranslationProgressArea from './components/TranslationProgressArea';

import { registerSubtitleStreamListeners } from './helpers/electron-ipc';
import { loadSrtFile } from './helpers/subtitle-utils';

import { ManagementContextProvider } from './context';

import {
  parseSrt,
  secondsToSrtTime,
  buildSrt,
  fixOverlappingSegments,
} from './helpers';

// Styles
import { pageWrapperStyles, containerStyles, titleStyles } from './styles';

// Shared types
export interface SrtSegment {
  index: number;
  start: number; // in seconds
  end: number; // in seconds
  text: string;
  originalText?: string;
  translatedText?: string;
}

function AppContent() {
  const [electronConnected, setElectronConnected] = useState<boolean>(false);

  const generatedSubtitleMapRef = useRef<{
    [key: string]: string;
  }>({});
  const generatedSubtitleIndexesRef = useRef<number[]>([]);

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
  const [editingTimes, setEditingTimes] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const [isReceivingPartialResults, setIsReceivingPartialResults] =
    useState<boolean>(false);

  const mainContentRef = useRef<HTMLDivElement>(null);

  const hasScrolledToStickyRef = useRef(false);

  const editSubtitlesRef = useRef<HTMLDivElement>(null);

  const editSubtitlesMethodsRef = useRef<{
    scrollToCurrentSubtitle: () => void;
  }>({ scrollToCurrentSubtitle: () => {} });

  const handleScrollToCurrentSubtitle = useCallback(() => {
    if (editSubtitlesMethodsRef.current) {
      editSubtitlesMethodsRef.current.scrollToCurrentSubtitle();
    }
  }, []);

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
    const cleanup = registerSubtitleStreamListeners(handlePartialResult);

    if (window.electron) {
      const generateListener = (progress: any) => {
        handlePartialResult(progress || {});
      };

      if (typeof window.electron.onGenerateSubtitlesProgress === 'function') {
        window.electron.onGenerateSubtitlesProgress(generateListener);
      }
    }

    return () => {
      cleanup();
    };

    function handlePartialResult(result: {
      partialResult?: string;
      percent?: number;
      stage?: string;
      current?: number;
      total?: number;
    }) {
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

          const lines = safeResult.partialResult.split('\n');
          const newSubtitleMap: { [key: string]: string } = {};

          let currentLineNumber: string | null = null;
          let currentContent: string | null = null;

          for (const line of lines) {
            if (!line.trim()) continue;

            // Check if line is a number
            if (/^\d+$/.test(line.trim())) {
              currentLineNumber = line.trim();
              currentContent = null;
            }
            // Skip timestamp lines
            else if (line.includes('-->')) {
              continue;
            } else if (currentLineNumber && !currentContent) {
              if (!generatedSubtitleMapRef.current[currentLineNumber]) {
                generatedSubtitleIndexesRef.current.push(
                  parseInt(currentLineNumber)
                );
              }
              currentContent = line.trim();
              newSubtitleMap[currentLineNumber] = currentContent;
            }
            // If we already have content, append this line
            else if (currentLineNumber && currentContent) {
              newSubtitleMap[currentLineNumber] += ' ' + line.trim();
            }
          }

          generatedSubtitleMapRef.current = {
            ...generatedSubtitleMapRef.current,
            ...newSubtitleMap,
          };
          const newSegments: SrtSegment[] =
            generatedSubtitleIndexesRef.current.map(arrayIndex => ({
              index: arrayIndex,
              start: (arrayIndex - 1) * 3,
              end: arrayIndex * 3,
              text:
                generatedSubtitleMapRef.current[arrayIndex.toString()] || '',
            }));

          setSubtitleSegments(newSegments);
        }

        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);
        setIsTranslationInProgress(true);
      } catch (error) {
        console.error('Error handling partial result:', error);
      }
    }
  }, [setSubtitleSegments]);

  // Handle generated subtitles
  const handleSubtitlesGenerated = (generatedSubtitles: string) => {
    // Parse the generated subtitles into segments for possible editing later
    try {
      const segments = parseSrt(generatedSubtitles);
      const fixedSegments = fixOverlappingSegments(segments);
      setSubtitleSegments(fixedSegments);
    } catch (err) {
      console.error('Error parsing generated subtitles:', err);
    }
  };

  const handleVideoPlayerReady = (player: any) => {
    setVideoPlayerRef(player);
  };

  const handleSetVideoUrl = (url: string | null) => {
    if (url !== null) {
      setVideoUrl(url);
    }
  };

  const handleChangeVideo = (file: File) => {
    if (file) {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      // Set the new video file
      setVideoFile(file);

      // Create and set URL for the new video
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    }
  };

  // Handler for changing SRT file
  const handleChangeSrt = async (file: File) => {
    // Always store the filename in localStorage for consistent saving behavior
    localStorage.setItem('loadedSrtFileName', file.name);

    // Try to get the real path if possible (for Electron)
    const realPath = (file as any).path;
    if (realPath) {
      localStorage.setItem('originalLoadPath', realPath);
    }

    const result = await loadSrtFile(
      file,
      (_, segments, filePath) => {
        setSubtitleSegments(segments);

        // Store path in a shared state for the EditSubtitles component to access
        if (filePath) {
          // We could use localStorage, URL parameters, or context API to share this
          // The simplest approach would be localStorage for this quick fix
          localStorage.setItem('originalSrtPath', filePath);
        }
      },
      error => {
        console.error('Error loading SRT:', error);
      }
    );

    if (result.error && !result.error.includes('canceled')) {
      console.error('Error in loadSrtFile:', result.error);
    }
  };

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
            onChangeSrt={handleChangeSrt}
            onStickyChange={handleStickyChange}
            onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
          />
        )}

        <div ref={mainContentRef} style={{ position: 'relative' }}>
          <GenerateSubtitles onSubtitlesGenerated={handleSubtitlesGenerated} />

          <div ref={editSubtitlesRef} id="edit-subtitles-section">
            <EditSubtitles
              videoFile={videoFile}
              videoUrl={videoUrl}
              isPlaying={isPlaying}
              editingTimes={editingTimes}
              onSetVideoFile={setVideoFile}
              onSetVideoUrl={handleSetVideoUrl}
              onSetError={error => console.error(error)}
              onSetEditingTimes={setEditingTimes}
              onSetIsPlaying={setIsPlaying}
              secondsToSrtTime={secondsToSrtTime}
              parseSrt={parseSrt}
              subtitles={subtitleSegments}
              translationProgress={translationProgress}
              videoPlayerRef={videoPlayerRef}
              isMergingInProgress={isMergingInProgress}
              onSetIsMergingInProgress={setIsMergingInProgress}
              editorRef={editSubtitlesMethodsRef}
              onMergeSubtitlesWithVideo={handleMergeSubtitlesWithVideo}
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
