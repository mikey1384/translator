import React, { useState, useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from './EditSubtitles/NativeVideoPlayer';
import { SrtSegment } from '../App';
import TimestampDisplay from './TimestampDisplay';
import Button from './Button';

interface StickyVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
  onStickyChange?: (isSticky: boolean) => void; // Keeping for backward compatibility
  onScrollToCurrentSubtitle?: () => void; // New prop to scroll to current subtitle
}

// Always fixed position styling with dynamic height based on scroll position
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

// Create a placeholder to prevent layout jumps
const placeholderStyles = (height: number) => css`
  display: block;
  height: ${height}px;
  width: 100%;
  margin-bottom: 10px;
`;

// Button gradient styles for play/pause button
const buttonGradientStyles = {
  base: css`
    position: relative;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
    color: white !important;

    &:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      color: white !important;
    }

    &:active:not(:disabled) {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      color: white !important;
    }

    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      color: rgba(255, 255, 255, 0.9) !important;
    }
  `,
  primary: css`
    background: linear-gradient(
      135deg,
      rgba(0, 123, 255, 0.9),
      rgba(0, 80, 188, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(0, 143, 255, 0.95),
        rgba(0, 103, 204, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(0, 123, 255, 0.6),
        rgba(0, 80, 188, 0.6)
      ) !important;
    }
  `,
  danger: css`
    background: linear-gradient(
      135deg,
      rgba(220, 53, 69, 0.9),
      rgba(170, 30, 45, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(230, 73, 89, 0.95),
        rgba(190, 50, 65, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(220, 53, 69, 0.6),
        rgba(170, 30, 45, 0.6)
      ) !important;
    }
  `,
};

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

  // Update isPlaying state when video plays/pauses
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
  }, [nativePlayer.instance]);

  if (!videoUrl) return null;

  const handlePlayerReadyWrapper = (player: any) => {
    onPlayerReady(player);
  };

  const handleTogglePlay = () => {
    try {
      isPlaying ? nativePlayer.pause() : nativePlayer.play();
    } catch (err) {
      console.error('Error toggling play state:', err);
    }
  };

  // Custom play button
  const playButton = (
    <Button
      onClick={handleTogglePlay}
      variant={isPlaying ? 'danger' : 'primary'}
      size="sm"
      className={`${buttonGradientStyles.base} ${
        isPlaying ? buttonGradientStyles.danger : buttonGradientStyles.primary
      } ${css`
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 70px;
      `}`}
    >
      {isPlaying ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
          </svg>
          Pause
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
          </svg>
          Play
        </>
      )}
    </Button>
  );

  return (
    <div ref={containerRef}>
      {/* Placeholder div to prevent layout jumps */}
      <div className={placeholderStyles(placeholderHeight)} />

      {/* The actual player */}
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
          customPlayButton={playButton}
          onChangeVideo={onChangeVideo}
          onChangeSrt={onChangeSrt}
          hasSubtitles={subtitles && subtitles.length > 0}
          subtitles={subtitles}
          onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
        />
      </div>
    </div>
  );
};

export default StickyVideoPlayer;
