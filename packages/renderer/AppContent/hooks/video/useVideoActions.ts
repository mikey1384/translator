import { useCallback } from 'react';
import {
  nativePause,
  nativePlay,
  nativeIsPlaying,
} from '../../../native-player.js';
import * as VideoIPC from '@ipc/video';

const isPlainFile = (f: unknown): f is Blob & { name: string } =>
  !!f &&
  typeof f === 'object' &&
  'name' in f &&
  'type' in f &&
  f instanceof Blob;

export function useVideoActions({
  setVideoFile,
  setVideoUrl,
  setVideoFilePath,
  onSrtFileLoaded,
  setIsVideoPlayerReady,
  setIsAudioOnly,
  videoUrl = '',
}: {
  onSrtFileLoaded: (filePath: string | null) => void;
  setVideoFile: (value: File | null) => void;
  setVideoUrl: (value: string) => void;
  setVideoFilePath: (value: string | null) => void;
  setIsVideoPlayerReady: (value: boolean) => void;
  setIsAudioOnly: (value: boolean) => void;
  videoUrl?: string;
}) {
  const analyseFile = useCallback(
    async (path: string) => {
      try {
        const hasVideo = await VideoIPC.hasVideoTrack(path);
        setIsAudioOnly(!hasVideo);
      } catch (err) {
        console.error('[useVideoActions] hasVideoTrack probe failed:', err);
        setIsAudioOnly(false);
      }
    },
    [setIsAudioOnly]
  );

  const reset = useCallback(() => {
    setVideoFile(null);
    setVideoUrl('');
    setIsAudioOnly(false);
  }, [setVideoFile, setVideoUrl, setIsAudioOnly]);

  async function handleSetVideoFile(
    fileData: File | { name: string; path: string } | null
  ) {
    onSrtFileLoaded(null);
    setIsVideoPlayerReady(false);

    if (videoUrl?.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(videoUrl);
      } catch {
        // Ignore error
      }
    }

    if (!fileData) {
      console.warn('[useVideoActions] No fileData provided');
      reset();
      return;
    }

    if ('path' in fileData) {
      // ① path-based object (from File-open dialog)
      const minimalFile = {
        name: fileData.name,
        path: fileData.path,
      } as File & { path: string };

      setVideoFile(minimalFile as any);
      setVideoFilePath(fileData.path);
      setVideoUrl(`file://${encodeURI(fileData.path.replace(/\\/g, '/'))}`);
      await analyseFile(fileData.path);
    } else if ((fileData as any)?._blobUrl) {
      // ② special blob wrapper (URL download flow)
      const blobFile = fileData as any;
      setVideoFile(blobFile);
      setVideoUrl(blobFile._blobUrl);
      setVideoFilePath(blobFile._originalPath || null);
      if (blobFile._originalPath && blobFile._hasVideo === undefined) {
        await analyseFile(blobFile._originalPath);
      }
    } else if (isPlainFile(fileData)) {
      // ③ vanilla File (drag-and-drop)
      setVideoFile(fileData);
      const filePath = (fileData as any).path;
      setVideoFilePath(filePath || null);
      const blobUrl = URL.createObjectURL(fileData);
      setVideoUrl(blobUrl);
      if (filePath) {
        await analyseFile(filePath);
      } else {
        setIsAudioOnly(false); // assume video present
      }
    } else {
      // ④ unexpected / null
      console.warn('[useVideoActions] Unexpected fileData:', fileData);
      reset();
    }
  }

  async function handleTogglePlay() {
    try {
      if (nativeIsPlaying()) {
        nativePause();
      } else {
        await nativePlay();
      }
    } catch (err) {
      console.error('[useVideoActions] toggle play/pause error:', err);
    }
  }

  const handleVideoPlayerReady = useCallback(() => {
    setIsVideoPlayerReady(true);
  }, [setIsVideoPlayerReady]);

  return {
    handleSetVideoFile,
    handleTogglePlay,
    handleVideoPlayerReady,
    reset,
  };
}
