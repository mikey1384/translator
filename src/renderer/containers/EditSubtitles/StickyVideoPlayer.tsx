import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from '../../components/NativeVideoPlayer';
import { SrtSegment } from '../../../types/interface';
import { TimestampDisplay } from './TimestampDisplay';
import throttle from 'lodash/throttle';
import { colors } from '../../styles';

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
  onUiInteraction?: () => void;
}

// Threshold for scrolling up before expanding (in pixels)
const EXPAND_SCROLL_THRESHOLD = 1000;
// Duration to ignore scroll events after UI interaction (in milliseconds)
const SCROLL_IGNORE_DURATION = 200;

const fixedVideoContainerStyles = (isExpanded: boolean) => css`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: ${isExpanded ? 'calc(90% - 30px)' : 'calc(85% - 30px)'};
  max-height: ${isExpanded ? '60vh' : '25vh'};
  padding: ${isExpanded ? '15px' : '10px'};
  z-index: 100;
  background-color: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(12px);
  border-radius: 0 0 8px 8px;
  border: 1px solid ${colors.border};
  margin-bottom: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 15px;
  overflow: visible;
  transition: all 0.3s ease-out;

  @media (max-height: 700px) {
    max-height: ${isExpanded ? '50vh' : '20vh'};
  }
`;

const playerWrapperStyles = css`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  position: relative;
`;

const controlsWrapperStyles = (isExpanded: boolean) => css`
  flex-shrink: 0;
  width: ${isExpanded ? '280px' : '240px'};
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
  const [isExpanded, setIsExpanded] = useState(true);
  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const isStickyActive = useRef(false);
  const scrollUpStartPosition = useRef<number | null>(null);
  // Ref to flag whether to ignore scroll events
  const ignoreScrollRef = useRef(false);
  // Timeout ref for clearing the ignore flag
  const ignoreScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to handle UI interaction and set ignore flag
  const handleUiInteraction = useCallback(() => {
    ignoreScrollRef.current = true;
    // Clear any existing timeout
    if (ignoreScrollTimeoutRef.current) {
      clearTimeout(ignoreScrollTimeoutRef.current);
    }
    // Set a new timeout to reset the flag
    ignoreScrollTimeoutRef.current = setTimeout(() => {
      ignoreScrollRef.current = false;
    }, SCROLL_IGNORE_DURATION);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (ignoreScrollTimeoutRef.current) {
        clearTimeout(ignoreScrollTimeoutRef.current);
      }
    };
  }, []);

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
    const handleScroll = throttle(() => {
      // --- Check Ignore Flag ---
      if (ignoreScrollRef.current) {
        return; // Ignore scroll event if flag is set
      }
      // --- End Check Ignore Flag ---

      const currentScrollY = window.scrollY;
      const placeholderTop = placeholderRef.current?.offsetTop ?? 0;
      const buffer = 30;

      const shouldBeSticky = currentScrollY > placeholderTop;

      if (shouldBeSticky) {
        if (!isStickyActive.current) {
          setIsExpanded(true);
          isStickyActive.current = true;
          scrollUpStartPosition.current = null;
          if (onStickyChange) onStickyChange(true);
        }

        if (Math.abs(currentScrollY - lastScrollY.current) > buffer) {
          if (currentScrollY < lastScrollY.current) {
            if (scrollUpStartPosition.current === null) {
              scrollUpStartPosition.current = lastScrollY.current;
            }
            if (
              isExpanded ||
              (scrollUpStartPosition.current !== null &&
                scrollUpStartPosition.current - currentScrollY >=
                  EXPAND_SCROLL_THRESHOLD)
            ) {
              setIsExpanded(true);
            }
          } else if (currentScrollY > lastScrollY.current) {
            setIsExpanded(false);
            scrollUpStartPosition.current = null;
          }
        }
      } else {
        if (isStickyActive.current) {
          setIsExpanded(true);
          isStickyActive.current = false;
          scrollUpStartPosition.current = null;
          if (onStickyChange) onStickyChange(false);
        }
      }

      lastScrollY.current = currentScrollY;
    }, 100);

    window.addEventListener('scroll', handleScroll, { passive: true });
    lastScrollY.current = window.scrollY;

    handleScroll();

    return () => {
      window.removeEventListener('scroll', handleScroll);
      handleScroll.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onStickyChange]);

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
      <div
        ref={placeholderRef}
        className={placeholderStyles(placeholderHeight)}
      />

      <div
        className={`${fixedVideoContainerStyles(
          isExpanded
        )} sticky-video-container ${isExpanded ? 'expanded' : 'shrunk'}`}
        ref={playerRef}
        data-expanded={isExpanded}
      >
        <div className={playerWrapperStyles}>
          <NativeVideoPlayer
            videoUrl={videoUrl}
            subtitles={subtitles}
            onPlayerReady={handlePlayerReady}
            isExpanded={isExpanded}
          />
        </div>

        <div className={controlsWrapperStyles(isExpanded)}>
          <TimestampDisplay
            videoElement={nativePlayer.instance}
            onChangeVideo={onChangeVideo}
            onSrtLoaded={onSrtLoaded}
            hasSubtitles={subtitles && subtitles.length > 0}
            onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
            isPlaying={isPlaying}
            onTogglePlay={onTogglePlay}
            onShiftAllSubtitles={onShiftAllSubtitles}
            onUiInteraction={handleUiInteraction}
            isStickyExpanded={isExpanded}
          />
        </div>
      </div>
    </div>
  );

  function handlePlayerReady(player: any) {
    onPlayerReady(player);
  }
};

export default StickyVideoPlayer;
