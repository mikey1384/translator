import { VideoQuality } from '../../../../types/interface.js';
import { nativePause, nativePlay } from '../../../native-player.js';
import { SrtSegment } from '../../../../types/interface.js';
import { nativeIsPlaying } from '../../../native-player.js';

export function useVideoActions({
  resetSubtitleSource,
  setIsUrlLoading,
  setUrlLoadProgressPercent,
  setUrlLoadProgressStage,
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
  setVideoPlayerRef,
  videoUrl,
  handleSetSubtitleSegments,
  onReset,
}: {
  resetSubtitleSource: () => void;
  setIsUrlLoading: (value: boolean) => void;
  setUrlLoadProgressPercent: (value: number) => void;
  setUrlLoadProgressStage: (value: string) => void;
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
  setVideoPlayerRef: (value: any) => void;
  videoUrl: string;
  handleSetSubtitleSegments: (value: SrtSegment[]) => void;
  onReset: () => void;
}) {
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

  function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
    resetSubtitleSource();

    if (videoUrl && videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl);
    }

    if (!fileData) {
      onReset();
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

  function handleVideoPlayerReady(player: any) {
    setVideoPlayerRef(player);
    if (player) {
      setIsPlaying(!player.paused);
    }
  }

  return {
    handleLoadFromUrl,
    handleSetVideoFile,
    handleSrtFileLoaded,
    handleTogglePlay,
    handleVideoPlayerReady,
  };
}
