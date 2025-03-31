import React, { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from '../../components/NativeVideoPlayer';
import { SrtSegment } from '../../../types/interface';
import { TimestampDisplay } from './TimestampDisplay';

interface StickyVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
  onChangeVideo?: (file: File) => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onStickyChange?: (isSticky: boolean) => void;
  onScrollToCurrentSubtitle?: () => void;
  onTogglePlay?: () => void;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
}

const fixedVideoContainerStyles = (
  isExpanded: boolean,
  isFullyExpanded: boolean
) => css`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: ${isFullyExpanded ? 'calc(95% - 30px)' : 'calc(90% - 30px)'};
  z-index: 100;
  background-color: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  padding: 15px;
  border-radius: 0 0 8px 8px;
  border: 1px solid rgba(238, 238, 238, 0.9);
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  max-height: ${isFullyExpanded
    ? 'calc(100vh - 60px)'
    : isExpanded
      ? '50vh'
      : '40vh'};
  overflow: visible;
  transition: all 0.3s ease-out;
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
`;

const placeholderStyles = (height: number) => css`
  display: block;
  height: ${height}px;
  width: 100%;
  margin-bottom: 10px;
`;

const StickyVideoPlayer: React.FC<StickyVideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
  onChangeVideo,
  onSrtLoaded,
  onStickyChange,
  onScrollToCurrentSubtitle,
  onTogglePlay,
  onShiftAllSubtitles,
}) => {
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const calculateHeight = () => {
      if (!playerRef.current) return;
      const rect = playerRef.current.getBoundingClientRect();
      if (rect.height > 0) {
        setPlaceholderHeight(rect.height);
      }
    };

    calculateHeight();
    window.addEventListener('resize', calculateHeight);
    if (onStickyChange) {
      onStickyChange(true);
    }
    return () => {
      window.removeEventListener('resize', calculateHeight);
    };
  }, [onStickyChange]);

  useEffect(() => {
    const checkScrollPosition = () => {
      const editSubtitlesSection = document.getElementById(
        'edit-subtitles-section'
      );

      const generateSubtitlesSections = Array.from(
        document.querySelectorAll('h2')
      ).filter(h2 => h2.textContent?.includes('Generate Subtitles'));
      const generateSubtitlesSection =
        generateSubtitlesSections.length > 0
          ? generateSubtitlesSections[0]
          : null;

      if (!editSubtitlesSection) return;

      const screenCenterY = window.innerHeight / 2;

      const editSectionRect = editSubtitlesSection.getBoundingClientRect();

      let shouldFullyExpand = false;
      let shouldExpand = false;

      shouldExpand = editSectionRect.top > screenCenterY;

      if (generateSubtitlesSection) {
        const generateSectionRect =
          generateSubtitlesSection.getBoundingClientRect();
        shouldFullyExpand = generateSectionRect.top > window.innerHeight - 100;
      }

      if (shouldFullyExpand !== isFullyExpanded) {
        setIsFullyExpanded(shouldFullyExpand);
        if (shouldFullyExpand && !isExpanded) {
          setIsExpanded(true);
        }
      } else if (shouldExpand !== isExpanded && !shouldFullyExpand) {
        setIsExpanded(shouldExpand);
      }
    };

    checkScrollPosition();

    let scrollTimeout: number | null = null;
    const throttledScroll = () => {
      if (scrollTimeout === null) {
        scrollTimeout = window.setTimeout(() => {
          checkScrollPosition();
          scrollTimeout = null;
        }, 100);
      }
    };

    window.addEventListener('scroll', throttledScroll);

    return () => {
      window.removeEventListener('scroll', throttledScroll);
      if (scrollTimeout) {
        window.clearTimeout(scrollTimeout);
      }
    };
  }, [isExpanded, isFullyExpanded]);

  useEffect(() => {
    if (!nativePlayer.instance) return;

    const videoElement = nativePlayer.instance;
    const updatePlayState = () => setIsPlaying(!videoElement.paused);

    videoElement.addEventListener('play', updatePlayState);
    videoElement.addEventListener('pause', updatePlayState);

    updatePlayState();

    return () => {
      videoElement.removeEventListener('play', updatePlayState);
      videoElement.removeEventListener('pause', updatePlayState);
    };
  }, []);

  if (!videoUrl) return null;

  return (
    <div ref={containerRef}>
      <div className={placeholderStyles(placeholderHeight)} />

      <div
        className={`${fixedVideoContainerStyles(
          isExpanded,
          isFullyExpanded
        )} sticky-video-container ${isExpanded ? 'expanded' : ''} ${
          isFullyExpanded ? 'fully-expanded' : ''
        }`}
        ref={playerRef}
        data-expanded={isExpanded}
        data-fully-expanded={isFullyExpanded}
      >
        <NativeVideoPlayer
          videoUrl={videoUrl}
          subtitles={subtitles}
          onPlayerReady={handlePlayerReady}
          isExpanded={isExpanded}
          isFullyExpanded={isFullyExpanded}
        />

        <TimestampDisplay
          videoElement={nativePlayer.instance}
          onChangeVideo={onChangeVideo}
          onSrtLoaded={onSrtLoaded}
          hasSubtitles={subtitles && subtitles.length > 0}
          onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          onShiftAllSubtitles={onShiftAllSubtitles}
        />
      </div>
    </div>
  );

  function handlePlayerReady(player: any) {
    onPlayerReady(player);
  }
};

export default StickyVideoPlayer;
