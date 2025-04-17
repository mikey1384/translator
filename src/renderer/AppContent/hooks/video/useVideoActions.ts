import { nativePause, nativePlay } from '../../../native-player.js';
import { nativeIsPlaying } from '../../../native-player.js';
import { useCallback } from 'react';

export function useVideoActions({
  setVideoFile,
  setVideoUrl,
  setVideoFilePath,
  setIsPlaying,
  setOriginalSrtFilePath,
  setSaveError,
  setIsVideoPlayerReady,
  videoUrl,
}: {
  setVideoFile: (value: File | null) => void;
  setVideoUrl: (value: string) => void;
  setVideoFilePath: (value: string | null) => void;
  setIsPlaying: (value: boolean) => void;
  setIsMergingInProgress: (value: boolean) => void;
  setIsTranslationInProgress: (value: boolean) => void;
  setMergeProgress: (value: number) => void;
  setMergeStage: (value: string) => void;
  setMergeOperationId: (value: string | null) => void;
  setOriginalSrtFilePath: (value: string) => void;
  setSaveError: (value: string) => void;
  setIsVideoPlayerReady: (value: boolean) => void;
  videoUrl: string;
}) {
  function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
    setIsVideoPlayerReady(false);

    if (videoUrl && videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl);
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
      const blobUrl = URL.createObjectURL(fileData);
      setVideoUrl(blobUrl);
    } else {
      console.warn(
        '[App.tsx handleSetVideoFile] Branch: Fallback/unexpected case.',
        fileData
      );
      setVideoFile(null);
      setVideoUrl('');
    }
    setIsPlaying(false);
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
      if (nativeIsPlaying()) {
        nativePause();
        setIsPlaying(false);
      } else {
        await nativePlay();
        setIsPlaying(true);
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
    }
  }

  const handleVideoPlayerReady = useCallback(() => {
    console.log('[VideoActions] Signaling Video player ready.');
    setIsVideoPlayerReady(true);
  }, [setIsVideoPlayerReady]);

  return {
    handleSetVideoFile,
    handleSrtFileLoaded,
    handleTogglePlay,
    handleVideoPlayerReady,
  };
}
