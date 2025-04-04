import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer, {
  nativePlayer,
} from '../../components/NativeVideoPlayer';
import { SrtSegment } from '../../../types/interface';
import { TimestampDisplay } from './TimestampDisplay';
import throttle from 'lodash/throttle';
import { colors } from '../../styles';
import Button from '../../components/Button';

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

// --- Add Video Controls Overlay Styles --- START ---
const videoOverlayControlsStyles = css`
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.8) 0%,
    rgba(0, 0, 0, 0.5) 60%,
    transparent 100%
  );
  z-index: 10;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 15px;
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &:hover {
    opacity: 1;
  }
`;

// Add fullscreen variants of controls styles
const fullscreenOverlayControlsStyles = css`
  ${videoOverlayControlsStyles}
  height: 100px;
  padding: 0 40px;
  background: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.9) 0%,
    rgba(0, 0, 0, 0.7) 30%,
    transparent 100%
  );
  bottom: 20px;
`;

const seekbarStyles = css`
  width: 100%;
  height: 8px;
  cursor: pointer;
  appearance: none;
  background: linear-gradient(
    to right,
    ${colors.primary} 0%,
    ${colors.primary} var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) var(--seek-before-width, 0%),
    rgba(255, 255, 255, 0.3) 100%
  );
  border-radius: 4px;
  outline: none;
  position: relative;
  z-index: 2;
  margin: 0;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    background: ${colors.light};
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }
  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    background: ${colors.light};
    border-radius: 50%;
    cursor: pointer;
    border: none;
    box-shadow: 0 0 3px rgba(0, 0, 0, 0.6);
  }
`;

// Add fullscreen variant for seekbar
const fullscreenSeekbarStyles = css`
  ${seekbarStyles}
  height: 12px;

  &::-webkit-slider-thumb {
    width: 24px;
    height: 24px;
  }
  &::-moz-range-thumb {
    width: 24px;
    height: 24px;
  }
`;

const timeDisplayStyles = css`
  font-size: 0.9rem;
  min-width: 50px;
  text-align: center;
  font-family: monospace;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
`;

// Add fullscreen variant for time display
const fullscreenTimeDisplayStyles = css`
  ${timeDisplayStyles}
  font-size: 1.2rem;
  min-width: 70px;
`;

const transparentButtonStyles = css`
  background: transparent !important;
  border: none !important;
  padding: 5px;
  color: white;
  &:hover {
    color: ${colors.primary};
  }
  svg {
    width: 24px;
    height: 24px;
  }
`;

// Add fullscreen variant for button
const fullscreenButtonStyles = css`
  ${transparentButtonStyles}
  svg {
    width: 32px;
    height: 32px;
  }
`;
// --- Add Video Controls Overlay Styles --- END ---

const fixedVideoContainerBaseStyles = css`
  position: fixed;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  background-color: rgba(30, 30, 30, 0.75);
  backdrop-filter: blur(12px);
  border: 1px solid ${colors.border};
  display: flex;
  flex-direction: row;
  align-items: stretch;
  gap: 15px;
  overflow: visible;
  transition: all 0.3s ease-out;
`;

const fixedVideoContainerStyles = (
  isExpanded: boolean,
  isPseudoFullscreen: boolean
) => css`
  ${fixedVideoContainerBaseStyles}

  ${isPseudoFullscreen
    ? `
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    transform: none;
    padding: 0;
    border-radius: 0;
    z-index: 9999;
    background-color: black;
    gap: 0; /* Adjust gap for fullscreen */
    flex-direction: column; /* Stack elements vertically */
  `
    : `
    width: ${isExpanded ? 'calc(90% - 30px)' : 'calc(85% - 30px)'};
    max-height: ${isExpanded ? '60vh' : '25vh'};
    padding: ${isExpanded ? '15px' : '10px'};
    border-radius: 0 0 8px 8px;
    margin-bottom: 0;

    @media (max-height: 700px) {
      max-height: ${isExpanded ? '50vh' : '20vh'};
    }
  `}
`;

const playerWrapperStyles = (isPseudoFullscreen: boolean) => css`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  position: relative;
  ${isPseudoFullscreen
    ? 'height: 100%;'
    : ''}/* Take full height in fullscreen */
`;

const controlsWrapperStyles = (
  isExpanded: boolean,
  isPseudoFullscreen: boolean
) => css`
  flex-shrink: 0;
  transition: background-color 0.3s ease;
  ${isPseudoFullscreen
    ? `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0; // Use right: 0 instead of width: 100%
    width: 100%;
    height: 100px; /* Increase height for fullscreen controls */
    background-color: transparent; // Default to transparent
    border-top: none; // Remove border when overlaying
    z-index: 10; // Ensure it's above the video wrapper
    &:hover {
      background-color: rgba(0, 0, 0, 0.95); // Darker, more opaque background
      border-top: 1px solid ${colors.border}; // Show border on hover
    }
  `
    : `
    width: ${isExpanded ? '280px' : '240px'};
    border-top: 1px solid ${colors.border}; // Keep border for non-fullscreen
  `}
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
  onUiInteraction,
}) => {
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const isStickyActive = useRef(false);
  const scrollUpStartPosition = useRef<number | null>(null);
  const ignoreScrollRef = useRef(false);
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

    // Call the prop if provided
    if (onUiInteraction) onUiInteraction();
  }, [onUiInteraction]);

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

      // Disable scroll-based expand/shrink when in pseudo-fullscreen
      if (isPseudoFullscreen) {
        if (!isExpanded) setIsExpanded(true); // Ensure it's expanded in fullscreen
        return;
      }

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
  }, [onStickyChange, isPseudoFullscreen]);

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

  // --- New: Toggle Pseudo Fullscreen Function ---
  const togglePseudoFullscreen = useCallback(() => {
    setIsPseudoFullscreen(prev => !prev);
    // Optionally, pause/play video or trigger other actions
    // If entering fullscreen, might want to hide scrollbars
    if (!isPseudoFullscreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    // Recalculate layout or trigger re-render if necessary
    window.dispatchEvent(new Event('resize'));
  }, [isPseudoFullscreen]);

  // --- New: Handle Escape key to exit pseudo-fullscreen ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isPseudoFullscreen) {
        togglePseudoFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Ensure body overflow is reset if component unmounts while fullscreen
      if (isPseudoFullscreen) {
        document.body.style.overflow = '';
      }
    };
  }, [isPseudoFullscreen, togglePseudoFullscreen]);

  // Add utility function to format time for the progress bar
  const formatTime = useCallback((seconds: number): string => {
    if (isNaN(seconds)) return '00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, []);

  // Add effects for tracking video time and playing status
  useEffect(() => {
    if (!nativePlayer.instance) return;

    const videoElement = nativePlayer.instance;

    // Update state when video time changes
    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
    };

    // Update duration when available
    const handleDurationChange = () => {
      if (!isNaN(videoElement.duration)) {
        setDuration(videoElement.duration);
      }
    };

    // Update play state
    const updatePlayState = () => {
      setIsPlaying(!videoElement.paused);
    };

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('durationchange', handleDurationChange);
    videoElement.addEventListener('play', updatePlayState);
    videoElement.addEventListener('pause', updatePlayState);

    // Initial setup
    handleTimeUpdate();
    handleDurationChange();
    updatePlayState();

    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('durationchange', handleDurationChange);
      videoElement.removeEventListener('play', updatePlayState);
      videoElement.removeEventListener('pause', updatePlayState);
    };
  }, []);

  // Add handlers for the overlay controls
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (nativePlayer.instance) {
        const seekTime = parseFloat(e.target.value);
        nativePlayer.instance.currentTime = seekTime;
        if (onUiInteraction) onUiInteraction();
      }
    },
    [onUiInteraction]
  );

  const handleOverlayTogglePlay = useCallback(() => {
    if (onTogglePlay) {
      onTogglePlay();
      if (onUiInteraction) onUiInteraction();
    }
  }, [onTogglePlay, onUiInteraction]);

  const handlePlayerWrapperHover = useCallback(() => {
    setShowOverlay(true);
  }, []);

  const handlePlayerWrapperLeave = useCallback(() => {
    setShowOverlay(false);
  }, []);

  if (!videoUrl) return null;

  // Calculate progress percentage for the seekbar
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={containerRef}>
      <div
        ref={placeholderRef}
        className={placeholderStyles(placeholderHeight)}
      />

      <div
        className={`${fixedVideoContainerStyles(
          isExpanded,
          isPseudoFullscreen
        )} sticky-video-container ${isExpanded ? 'expanded' : 'shrunk'} ${isPseudoFullscreen ? 'pseudo-fullscreen' : ''}`}
        ref={playerRef}
        data-expanded={isExpanded}
      >
        <div
          className={playerWrapperStyles(isPseudoFullscreen)}
          onMouseEnter={handlePlayerWrapperHover}
          onMouseLeave={handlePlayerWrapperLeave}
        >
          <NativeVideoPlayer
            videoUrl={videoUrl}
            subtitles={subtitles}
            onPlayerReady={handlePlayerReady}
            isExpanded={isExpanded}
            isFullyExpanded={isPseudoFullscreen}
          />

          {/* Modified Video Controls Overlay to work in both modes */}
          <div
            className={
              isPseudoFullscreen
                ? fullscreenOverlayControlsStyles
                : videoOverlayControlsStyles
            }
            style={{ opacity: showOverlay ? 1 : 0 }}
          >
            <Button
              onClick={handleOverlayTogglePlay}
              variant="primary"
              size="sm"
              className={
                isPseudoFullscreen
                  ? fullscreenButtonStyles
                  : transparentButtonStyles
              }
            >
              {isPlaying ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M11.596 8.697l-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
                </svg>
              )}
            </Button>

            <span
              className={
                isPseudoFullscreen
                  ? fullscreenTimeDisplayStyles
                  : timeDisplayStyles
              }
            >
              {formatTime(currentTime)}
            </span>

            <div style={{ flexGrow: 1, position: 'relative' }}>
              <input
                type="range"
                min={0}
                max={duration || 1}
                value={currentTime}
                onChange={handleSeek}
                step="0.1"
                className={
                  isPseudoFullscreen ? fullscreenSeekbarStyles : seekbarStyles
                }
                style={{ '--seek-before-width': `${progressPercent}%` } as any}
              />
            </div>

            <span
              className={
                isPseudoFullscreen
                  ? fullscreenTimeDisplayStyles
                  : timeDisplayStyles
              }
            >
              {formatTime(duration)}
            </span>

            {/* Add Fullscreen Button */}
            <Button
              onClick={togglePseudoFullscreen}
              variant="secondary"
              size="sm"
              className={
                isPseudoFullscreen
                  ? fullscreenButtonStyles
                  : transparentButtonStyles
              }
              title={
                isPseudoFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'
              }
            >
              {isPseudoFullscreen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M1.5 1a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4A1.5 1.5 0 0 1 1.5 0h4a.5.5 0 0 1 0 1h-4zM10 .5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 16 1.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zM.5 10a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 0 14.5v-4a.5.5 0 0 1 .5-.5zm15 0a.5.5 0 0 1 .5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5z" />
                </svg>
              )}
            </Button>
          </div>
        </div>

        {/* Only show side controls when not in fullscreen mode */}
        {!isPseudoFullscreen && (
          <div
            className={controlsWrapperStyles(isExpanded, isPseudoFullscreen)}
          >
            <TimestampDisplay
              _videoElement={nativePlayer.instance}
              onChangeVideo={onChangeVideo}
              onSrtLoaded={onSrtLoaded}
              hasSubtitles={subtitles && subtitles.length > 0}
              onScrollToCurrentSubtitle={onScrollToCurrentSubtitle}
              _isPlaying={isPlaying}
              _onTogglePlay={onTogglePlay}
              onShiftAllSubtitles={onShiftAllSubtitles}
              onUiInteraction={handleUiInteraction}
              _isStickyExpanded={isExpanded}
              _isPseudoFullscreen={isPseudoFullscreen}
              _onTogglePseudoFullscreen={togglePseudoFullscreen}
            />
          </div>
        )}
      </div>
    </div>
  );

  function handlePlayerReady(player: any) {
    onPlayerReady(player);
  }
};

export default StickyVideoPlayer;
