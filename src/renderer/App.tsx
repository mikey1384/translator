import { useEffect, useState, useRef, useCallback } from 'react';

import StatusSection from './components/StatusSection';
import BackToTopButton from './components/BackToTopButton';
import StickyVideoPlayer from './containers/EditSubtitles/StickyVideoPlayer';

import { EditSubtitles } from './containers/EditSubtitles';
import GenerateSubtitles from './containers/GenerateSubtitles';
import MergingProgressArea from './containers/MergingProgressArea';
import TranslationProgressArea from './containers/TranslationProgressArea';

import { registerSubtitleStreamListeners } from './helpers/electron-ipc';
import { loadSrtFile } from './helpers/subtitle-utils';

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
  const [showOriginalText, setShowOriginalText] = useState<boolean>(true);

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
            } else if (line.includes('-->')) {
              continue;
            } else if (currentLineNumber && !currentContent) {
              if (!generatedSubtitleMapRef.current[currentLineNumber]) {
                generatedSubtitleIndexesRef.current.push(
                  parseInt(currentLineNumber)
                );
              }
              currentContent = line.trim();
              newSubtitleMap[currentLineNumber] = currentContent;
            } else if (currentLineNumber && currentContent) {
              newSubtitleMap[currentLineNumber] += ' ' + line.trim();
            }
          }

          generatedSubtitleMapRef.current = {
            ...generatedSubtitleMapRef.current,
            ...newSubtitleMap,
          };
          const newSegments: SrtSegment[] =
            generatedSubtitleIndexesRef.current.map(arrayIndex => {
              const originalText =
                generatedSubtitleMapRef.current[arrayIndex.toString()] || '';
              let processedText = originalText;
              if (originalText.includes('###TRANSLATION_MARKER###')) {
                if (showOriginalText) {
                  processedText = originalText.replace(
                    '###TRANSLATION_MARKER###',
                    '\n'
                  );
                } else {
                  const parts = originalText.split('###TRANSLATION_MARKER###');
                  processedText = parts[1] ? parts[1].trim() : '';
                }
              }

              return {
                index: arrayIndex,
                start: (arrayIndex - 1) * 3,
                end: arrayIndex * 3,
                text: processedText,
              };
            });
          setSubtitleSegments(newSegments);
        }

        setTranslationProgress(safeResult.percent);
        setTranslationStage(safeResult.stage);
        setIsTranslationInProgress(true);
      } catch (error) {
        console.error('Error handling partial result:', error);
      }
    }
  }, [setSubtitleSegments, showOriginalText]);

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
    }
  }

  async function handleChangeSrt(file: File) {
    localStorage.setItem('loadedSrtFileName', file.name);
    const realPath = (file as any).path;
    if (realPath) {
      localStorage.setItem('originalLoadPath', realPath);
    }

    const result = await loadSrtFile(
      file,
      (_, segments, filePath) => {
        setSubtitleSegments(segments);
        if (filePath) {
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
