import React, { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from '../../components/NativeVideoPlayer';
import { SrtSegment } from '../../../types/interface';
import { TimestampDisplay } from '../../components/TimestampDisplay';

interface StickyVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
  onStickyChange?: (isSticky: boolean) => void;
  onScrollToCurrentSubtitle?: () => void;
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
  onChangeSrt,
  onStickyChange,
  onScrollToCurrentSubtitle,
}) => {
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Calculate placeholder height on mount and resize
  useEffect(() => {
    const calculateHeight = () => {
      if (!playerRef.current) return;

      // Get the height of the player
      const rect = playerRef.current.getBoundingClientRect();
      if (rect.height > 0) {
        setPlaceholderHeight(rect.height);
      }
    };

    // Initial calculation
    calculateHeight();

    // Add resize event listener
    window.addEventListener('resize', calculateHeight);

    // Notify parent that video is always sticky
    if (onStickyChange) {
      onStickyChange(true);
    }

    // Clean up
    return () => {
      window.removeEventListener('resize', calculateHeight);
    };
  }, [onStickyChange]);

  // Add scroll listener to check position relative to Edit Subtitles section
  useEffect(() => {
    const checkScrollPosition = () => {
      // Find the sections
      const editSubtitlesSection = document.getElementById(
        'edit-subtitles-section'
      );

      // Find the GenerateSubtitles section by looking for the section with "Generate Subtitles" title
      const generateSubtitlesSections = Array.from(
        document.querySelectorAll('h2')
      ).filter(h2 => h2.textContent?.includes('Generate Subtitles'));
      const generateSubtitlesSection =
        generateSubtitlesSections.length > 0
          ? generateSubtitlesSections[0]
          : null;

      if (!editSubtitlesSection) return;

      // Get the vertical center point of the screen
      const screenCenterY = window.innerHeight / 2;

      // Get the top position of the Edit Subtitles section relative to the viewport
      const editSectionRect = editSubtitlesSection.getBoundingClientRect();

      // Determine expansion states based on scroll position
      let shouldFullyExpand = false;
      let shouldExpand = false;

      // 1. Check if we should be in expanded mode (screen center above Edit Subtitles)
      shouldExpand = editSectionRect.top > screenCenterY;

      // 2. Check if we should be in fully expanded mode (scrolling upward past Generate Subtitles)
      if (generateSubtitlesSection) {
        const generateSectionRect =
          generateSubtitlesSection.getBoundingClientRect();
        // If user is scrolling UP and the Generate Subtitles is coming into view from the bottom
        // We want to expand when it's below the viewport or just entering it
        shouldFullyExpand = generateSectionRect.top > window.innerHeight - 100;
      }

      // Update states if needed, with priority for fully expanded
      if (shouldFullyExpand !== isFullyExpanded) {
        setIsFullyExpanded(shouldFullyExpand);
        // When fully expanding, also ensure expanded is true
        if (shouldFullyExpand && !isExpanded) {
          setIsExpanded(true);
        }
      } else if (shouldExpand !== isExpanded && !shouldFullyExpand) {
        setIsExpanded(shouldExpand);
      }
    };

    // Check initial position
    checkScrollPosition();

    // Add scroll event listener with throttling to improve performance
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

    // Clean up
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

    return () => {
      videoElement.removeEventListener('play', updatePlayState);
      videoElement.removeEventListener('pause', updatePlayState);
    };
  }, []);

  if (!videoUrl) return null;

  const handlePlayerReadyWrapper = (player: any) => {
    onPlayerReady(player);
  };

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
          onPlayerReady={handlePlayerReadyWrapper}
          isExpanded={isExpanded}
          isFullyExpanded={isFullyExpanded}
        />

        <TimestampDisplay
          videoElement={nativePlayer.instance}
          onChangeVideo={onChangeVideo}
          onChangeSrt={onChangeSrt}
          hasSubtitles={subtitles && subtitles.length > 0}
          onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
          isPlaying={isPlaying}
        />
      </div>
    </div>
  );
};

export default StickyVideoPlayer;
