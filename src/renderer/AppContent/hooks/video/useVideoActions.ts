import { useCallback } from 'react';
import {
  nativePause,
  nativePlay,
  nativeIsPlaying,
} from '../../../native-player.js';

/**
 * Extra prop: setIsAudioOnly – lets the parent know whether
 * the loaded media has a video track or not
 */
export function useVideoActions({
  setVideoFile,
  setVideoUrl,
  setVideoFilePath,
  setIsPlaying,
  setOriginalSrtFilePath,
  setSaveError,
  setIsVideoPlayerReady,
  setIsAudioOnly, // <-- [NEW]
  videoUrl,
}: {
  setVideoFile: (value: File | null) => void;
  setVideoUrl: (value: string) => void;
  setVideoFilePath: (value: string | null) => void;
  setIsPlaying: (value: boolean) => void;
  setOriginalSrtFilePath: (value: string) => void;
  setSaveError: (value: string) => void;
  setIsVideoPlayerReady: (value: boolean) => void;
  setIsAudioOnly: (value: boolean) => void; // <-- [NEW]
  videoUrl: string;
}) {
  /**
   * -------------------------------------------------------------
   * 1. Helper – run ffprobe in the main-process and update state
   * -------------------------------------------------------------
   */
  async function analyseFile(path: string) {
    try {
      // (Assumes window.electron.hasVideoTrack is defined in preload)
      const hasVideo = await window.electron.hasVideoTrack(path);
      setIsAudioOnly(!hasVideo); // If no video track => isAudioOnly = true
    } catch (err) {
      console.error('[useVideoActions] hasVideoTrack probe failed:', err);
      // Fall back: treat as if it has video
      setIsAudioOnly(false);
    }
  }

  /**
   * -------------------------------------------------------------
   * 2. Main setter – handleSetVideoFile
   * -------------------------------------------------------------
   */
  async function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
    setIsVideoPlayerReady(false);

    // Revoke any old blob URL to avoid memory leaks
    if (videoUrl && videoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(videoUrl);
    }

    // ---------- (A) object with explicit .path ----------
    if (
      fileData &&
      typeof fileData === 'object' &&
      !(fileData instanceof File) &&
      'path' in fileData &&
      fileData.path
    ) {
      const minimalFileObj = new File([], fileData.name, { type: 'video/*' });
      (minimalFileObj as any).path = fileData.path;

      setVideoFile(minimalFileObj as File);
      setVideoFilePath(fileData.path);

      const encodedPath = encodeURI(fileData.path.replace(/\\/g, '/'));
      setVideoUrl(`file://${encodedPath}`);

      // [NEW] check if audio-only
      await analyseFile(fileData.path);
    }

    // ---------- (B) “fake” File object from a blob or URL download ----------
    else if (
      fileData &&
      typeof fileData === 'object' &&
      (fileData as any)._blobUrl
    ) {
      const blobFileData = fileData as any;

      setVideoFile(blobFileData as File);
      setVideoUrl(blobFileData._blobUrl);
      setVideoFilePath(blobFileData._originalPath || null);

      if (blobFileData._originalPath) {
        await analyseFile(blobFileData._originalPath);
      }
    }

    // ---------- (C) genuine File object from user’s machine ----------
    else if (fileData instanceof File) {
      setVideoFile(fileData);
      setVideoFilePath(fileData.path);

      const blobUrl = URL.createObjectURL(fileData);
      setVideoUrl(blobUrl);

      // [NEW] check if audio-only
      await analyseFile(fileData.path);
    }

    // ---------- (D) fallback / nothing ----------
    else {
      console.warn('[useVideoActions] Unexpected fileData:', fileData);
      setVideoFile(null);
      setVideoUrl('');
      setIsAudioOnly(false); // fallback to “not audio-only”
    }

    // Always reset playback to paused
    setIsPlaying(false);
  }

  /**
   * -------------------------------------------------------------
   * 3. Misc helpers
   * -------------------------------------------------------------
   */
  function handleSrtFileLoaded(filePath: string) {
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
    } catch (err) {
      console.error('[useVideoActions] toggle play/pause error:', err);
    }
  }

  const handleVideoPlayerReady = useCallback(() => {
    setIsVideoPlayerReady(true);
  }, [setIsVideoPlayerReady]);

  /**
   * -------------------------------------------------------------
   * 4. Expose these functions
   * -------------------------------------------------------------
   */
  return {
    handleSetVideoFile,
    handleSrtFileLoaded,
    handleTogglePlay,
    handleVideoPlayerReady,
  };
}
