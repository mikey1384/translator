import { useState } from 'react';

export function useVideoState() {
  const [isMergingInProgress, setIsMergingInProgress] =
    useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isUrlLoading, setIsUrlLoading] = useState(false);
  const [originalSrtFilePath, setOriginalSrtFilePath] = useState<string | null>(
    null
  );
  const [saveError, setSaveError] = useState<string>('');

  const [urlLoadProgressPercent, setUrlLoadProgressPercent] = useState(0);
  const [urlLoadProgressStage, setUrlLoadProgressStage] = useState('');

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [videoPlayerRef, setVideoPlayerRef] = useState<any>(null);

  return {
    isMergingInProgress,
    setIsMergingInProgress,
    isPlaying,
    setIsPlaying,
    isUrlLoading,
    setIsUrlLoading,
    originalSrtFilePath,
    setOriginalSrtFilePath,
    saveError,
    setSaveError,
    urlLoadProgressPercent,
    setUrlLoadProgressPercent,
    urlLoadProgressStage,
    setUrlLoadProgressStage,
    videoFile,
    setVideoFile,
    videoFilePath,
    setVideoFilePath,
    videoPlayerRef,
    setVideoPlayerRef,
  };
}
