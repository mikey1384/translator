import { useState } from 'react';

export function useVideoState() {
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const [saveError, setSaveError] = useState<string>('');

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);

  return {
    isMergingInProgress,
    setIsMergingInProgress,
    isPlaying,
    setIsPlaying,
    originalSrtFilePath,
    setOriginalSrtFilePath,
    saveError,
    setSaveError,
    videoFile,
    setVideoFile,
    videoFilePath,
    setVideoFilePath,
    videoPlayerRef,
    setVideoPlayerRef,
  };
}
