import { useState } from 'react';
import { SrtSegment, VideoQuality } from '../../../types/interface.js';
import { nativePlayer } from '../../components/VideoPlayer/NativeVideoPlayer.js';

interface UseVideoLoaderProps {
  setMergeOperationId: (value: string | null) => void;
  setMergeStage: (value: string) => void;
  setMergeProgress: (value: number) => void;
  setIsTranslationInProgress: (value: boolean) => void;
  resetSubtitleSource: () => void;
  handleSetSubtitleSegments: (
    updater: SrtSegment[] | ((prev: SrtSegment[]) => SrtSegment[])
  ) => void;
}

export function useVideoState({
  setMergeOperationId,
  setMergeStage,
  setMergeProgress,
  setIsTranslationInProgress,
  resetSubtitleSource,
  handleSetSubtitleSegments,
}: UseVideoLoaderProps) {
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isUrlLoading, setIsUrlLoading] = useState(false);
  const [urlLoadProgressPercent, setUrlLoadProgressPercent] = useState(0);
  const [urlLoadProgressStage, setUrlLoadProgressStage] = useState('');
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const [saveError, setSaveError] = useState<string>('');

  function handleSaveAsComplete(newFilePath: string) {
    console.log(
      '[AppContent] Save As complete, setting original path to:',
      newFilePath
    );
    setOriginalSrtFilePath(newFilePath); // Update path after successful Save As
  }

  async function handleLoadFromUrl(url: string, quality: VideoQuality) {
    if (!url || !window.electron) {
      console.error('Invalid URL or Electron API not available.');
      return;
    }

    console.log(
      `[App] handleLoadFromUrl called with URL: ${url}, Quality: ${quality}`
    );
    setIsMergingInProgress(false);
    setIsTranslationInProgress(false);
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

        handleSetVideoFile(videoFileObj as any);
      } else {
        throw new Error('URL processing did not return necessary video info.');
      }
    } catch (err: any) {
      console.error('[App] Error processing URL from player:', err);
      setSaveError(`Error loading URL: ${err.message || err}`);
      setIsUrlLoading(false); // Stop loading on error
    }
  }

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused);
    }
  }

  function handleSrtFileLoaded(filePath: string) {
    console.log(
      '[AppContent] SRT file loaded, setting original path:',
      filePath
    );
    setOriginalSrtFilePath(filePath);
    setSaveError('');
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

  function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
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

  return {
    isPlaying,
    saveError,
    videoFile,
    videoUrl,
    videoFilePath,
    videoPlayerRef,
    isUrlLoading,
    isMergingInProgress,
    originalSrtFilePath,
    setIsPlaying,
    setSaveError,
    setIsMergingInProgress,
    urlLoadProgressPercent,
    urlLoadProgressStage,
    handleVideoPlayerReady,
    handleLoadFromUrl,
    handleTogglePlay,
    handleSetVideoFile,
    handleSaveAsComplete,
    handleSrtFileLoaded,
  };
}
