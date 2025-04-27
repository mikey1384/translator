import React, { useState, useEffect, useRef, useCallback } from 'react';
import { css } from '@emotion/css';
import NativeVideoPlayer from './NativeVideoPlayer.js';
import SideMenu from './SideMenu.js';
import { colors } from '../../styles.js';
import Button from '../Button.js';
import { SrtSegment } from '../../../types/interface.js';
import { getNativePlayerInstance, nativeSeek } from '../../native-player.js';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles.js';
import { VideoQuality } from '../../../types/interface.js';

const SCROLL_IGNORE_DURATION = 2000;

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
  bottom: 0;
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

const fixedVideoContainerStyles = (isFullScreen: boolean) => css`
  ${fixedVideoContainerBaseStyles}

  ${isFullScreen
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
    width: calc(95% - 30px);
    max-height: 35vh;
    padding: 10px;
    border-radius: 0 0 8px 8px;
    margin-bottom: 0;

    @media (max-height: 700px) {
      max-height: 30vh;
    }
  `}
`;

const playerWrapperStyles = (isFullScreen: boolean) => css`
  flex-grow: 1;
  flex-shrink: 1;
  min-width: 0;
  position: relative;
  ${isFullScreen ? 'height: 100%;' : ''}/* Take full height in fullscreen */
`;

const controlsWrapperStyles = (isFullScreen: boolean) => css`
  flex-shrink: 0;
  transition: background-color 0.3s ease;
  ${isFullScreen
    ? `
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 100px;
    background-color: transparent; // Default to transparent
    border-top: none; // Remove border when overlaying
    z-index: 10; // Ensure it's above the video wrapper
    &:hover {
      background-color: rgba(0, 0, 0, 0.95); // Darker, more opaque background
      border-top: 1px solid ${colors.border}; // Show border on hover
    }
  `
    : `
    width: 240px;
    border-top: 1px solid ${colors.border}; // Keep border for non-fullscreen
  `}
`;

export default function VideoPlayer({
  videoUrl,
  subtitles,
  onPlayerReady,
  onSelectVideoClick,
  onSetUrlInput,
  urlInput,
  onSrtLoaded,
  onScrollToCurrentSubtitle,
  onTogglePlay,
  onShiftAllSubtitles,
  onUiInteraction,
  onProcessUrl,
  mergeFontSize,
  mergeStylePreset,
  downloadQuality,
  onSetDownloadQuality,
  videoRef,
}: {
  isProgressBarVisible: boolean;
  videoUrl: string;
  subtitles: SrtSegment[];
  onSetUrlInput: (url: string) => void;
  urlInput: string;
  onPlayerReady: (player: any) => void;
  onSelectVideoClick: () => void;
  onSrtLoaded: (segments: SrtSegment[]) => void;
  onScrollToCurrentSubtitle?: () => void;
  onTogglePlay?: () => void;
  onShiftAllSubtitles?: (offsetSeconds: number) => void;
  onUiInteraction?: () => void;
  onProcessUrl: () => void;
  mergeFontSize: number;
  mergeStylePreset: SubtitleStylePresetKey;
  downloadQuality: VideoQuality;
  onSetDownloadQuality: (quality: VideoQuality) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const [progressBarHeight, setProgressBarHeight] = useState(0);

  // Add a state to track if we're currently auto-scrolling from "Scroll to Current" button
  const isScrollToCurrentActive = useRef(false);
  const scrollToCurrentTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- State for Fullscreen Control Auto-Hide --- START ---
  const [showFullscreenControls, setShowFullscreenControls] = useState(true); // Initially visible
  const activityTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // --- State for Fullscreen Control Auto-Hide --- END ---

  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const ignoreScrollRef = useRef(false);
  const ignoreScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to handle UI interaction and set ignore flag
  const handleUiInteraction = useCallback(() => {
    ignoreScrollRef.current = true;
    // Clear any existing timeout
    if (ignoreScrollTimeoutRef?.current) {
      clearTimeout(ignoreScrollTimeoutRef?.current);
    }
    // Set a new timeout to reset the flag
    ignoreScrollTimeoutRef.current = setTimeout(() => {
      ignoreScrollRef.current = false;
    }, SCROLL_IGNORE_DURATION);

    // Call the prop if provided
    if (onUiInteraction) onUiInteraction();
  }, [onUiInteraction]);

  const handleScrollToCurrentSubtitle = useCallback(() => {
    if (!onScrollToCurrentSubtitle) return;

    if (ignoreScrollTimeoutRef?.current) {
      clearTimeout(ignoreScrollTimeoutRef?.current);
      ignoreScrollTimeoutRef.current = null;
    }
    ignoreScrollRef.current = false;
    console.log('Cleared existing cooldowns before Scroll to Current');

    isScrollToCurrentActive.current = true;
    console.log('Scroll to Current activated, preventing size changes');

    if (scrollToCurrentTimeoutRef?.current) {
      clearTimeout(scrollToCurrentTimeoutRef?.current);
    }

    onScrollToCurrentSubtitle();

    scrollToCurrentTimeoutRef.current = setTimeout(() => {
      isScrollToCurrentActive.current = false;
      scrollToCurrentTimeoutRef.current = null;
      console.log('Scroll to Current complete, size changes enabled');
    }, 1500);
  }, [onScrollToCurrentSubtitle]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (ignoreScrollTimeoutRef?.current) {
        clearTimeout(ignoreScrollTimeoutRef?.current);
      }
      if (scrollToCurrentTimeoutRef?.current) {
        clearTimeout(scrollToCurrentTimeoutRef?.current);
      }
    };
  }, []);

  useEffect(() => {
    const videoElement = getNativePlayerInstance();
    if (!videoElement) return;

    const updatePlayState = () => setIsPlaying(!videoElement.paused);

    videoElement.addEventListener('play', updatePlayState);
    videoElement.addEventListener('pause', updatePlayState);

    updatePlayState();

    return () => {
      videoElement.removeEventListener('play', updatePlayState);
      videoElement.removeEventListener('pause', updatePlayState);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullScreen(prev => !prev);
    if (!isFullScreen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    // Recalculate layout or trigger re-render if necessary
    window.dispatchEvent(new Event('resize'));
  }, [isFullScreen]);

  // --- New: Handle Escape key to exit pseudo-fullscreen ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullScreen) {
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Ensure body overflow is reset if component unmounts while fullscreen
      if (isFullScreen) {
        document.body.style.overflow = '';
      }
    };
  }, [isFullScreen, toggleFullscreen]);

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
    const videoElement = getNativePlayerInstance();
    if (!videoElement) return;

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
      const seekTime = parseFloat(e.target.value);
      // Use the imported nativeSeek function
      nativeSeek(seekTime);
      if (onUiInteraction) onUiInteraction();
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

  // --- Logic for Fullscreen Control Auto-Hide --- START ---
  const handleActivity = useCallback(() => {
    if (!isFullScreen) return; // Only run in fullscreen

    setShowFullscreenControls(true);

    // Clear existing timeout
    if (activityTimeoutRef?.current) {
      clearTimeout(activityTimeoutRef?.current);
    }

    // Set new timeout to hide controls
    activityTimeoutRef.current = setTimeout(() => {
      setShowFullscreenControls(false);
    }, 3000); // Hide after 3 seconds
  }, [isFullScreen]);

  // Effect to attach/detach listeners and clean up timeout
  useEffect(() => {
    const playerWrapper = playerRef?.current?.querySelector(
      '.native-video-player-wrapper'
    ); // Target the inner wrapper

    if (isFullScreen && playerWrapper) {
      // Initially show controls and start timer
      handleActivity();

      playerWrapper.addEventListener('mousemove', handleActivity);
      playerWrapper.addEventListener('mouseleave', handleActivity); // Hide immediately on leave

      return () => {
        playerWrapper.removeEventListener('mousemove', handleActivity);
        playerWrapper.removeEventListener('mouseleave', handleActivity);
        if (activityTimeoutRef?.current) {
          clearTimeout(activityTimeoutRef?.current);
        }
      };
    } else {
      // Ensure controls are shown when not in fullscreen
      setShowFullscreenControls(true);
      // Clear timeout if exiting fullscreen
      if (activityTimeoutRef?.current) {
        clearTimeout(activityTimeoutRef?.current);
      }
    }
  }, [isFullScreen, handleActivity]);
  // --- Logic for Fullscreen Control Auto-Hide --- END ---

  // Add effect to detect and measure the progress bar
  useEffect(() => {
    const checkProgressBar = () => {
      // Specifically looking for the progress bars by their content
      // This is more reliable than class names which might be hashed
      const progressAreas = Array.from(document.querySelectorAll('div')).filter(
        el => {
          // Check if this element contains headers with specific text
          return (
            el.innerHTML.includes('Translation in Progress') ||
            el.innerHTML.includes('Merge in Progress')
          );
        }
      );

      let maxHeight = 0;
      progressAreas.forEach(el => {
        // Find the top-most parent with fixed positioning
        let currentEl: HTMLElement | null = el;
        let fixedParent: HTMLElement | null = null;

        while (currentEl && currentEl !== document.body) {
          const style = window.getComputedStyle(currentEl);
          if (style.position === 'fixed') {
            fixedParent = currentEl;
            break;
          }
          currentEl = currentEl.parentElement;
        }

        if (fixedParent) {
          const height = fixedParent.getBoundingClientRect().height;
          if (height > maxHeight) {
            maxHeight = height;
          }
        }
      });

      setProgressBarHeight(maxHeight);
    };

    // Check initially
    checkProgressBar();

    // Set up a mutation observer to detect when progress bar appears/disappears
    const observer = new MutationObserver(checkProgressBar);
    observer.observe(document.body, { childList: true, subtree: true });

    // Check periodically as well for safety
    const intervalId = setInterval(checkProgressBar, 500);

    // Clean up
    return () => {
      observer.disconnect();
      clearInterval(intervalId);
    };
  }, []);

  // Add keyboard shortcut handler for time seeking with arrow keys
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Handle escape key for fullscreen toggle
      if (e.key === 'Escape' && isFullScreen) {
        toggleFullscreen();
        e.preventDefault();
        return;
      }

      // Handle arrow keys for seeking if player is ready
      const videoElement = getNativePlayerInstance();
      if (videoElement) {
        const currentTime = videoElement.currentTime;
        const duration = videoElement.duration || 0;

        switch (e.key) {
          case 'ArrowRight':
            // Use nativeSeek for consistency
            nativeSeek(Math.min(currentTime + 10, duration));
            if (onUiInteraction) onUiInteraction();
            e.preventDefault();
            break;

          case 'ArrowLeft':
            // Use nativeSeek for consistency
            nativeSeek(Math.max(currentTime - 10, 0));
            if (onUiInteraction) onUiInteraction();
            e.preventDefault();
            break;
        }
      }
    },
    [isFullScreen, toggleFullscreen, onUiInteraction]
  );

  if (!videoUrl) return null;

  // Calculate progress percentage for the seekbar
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div ref={containerRef}>
      <div
        className={`${fixedVideoContainerStyles(isFullScreen)}`}
        ref={playerRef}
        style={{ top: isFullScreen ? 0 : progressBarHeight }}
        tabIndex={0} // Make container focusable
        onKeyDown={handleKeyDown} // Handle keyboard events at this level
      >
        <div
          className={playerWrapperStyles(isFullScreen)}
          onMouseEnter={handlePlayerWrapperHover}
          onMouseLeave={handlePlayerWrapperLeave}
        >
          <NativeVideoPlayer
            videoRef={videoRef}
            videoUrl={videoUrl}
            subtitles={subtitles}
            onPlayerReady={handlePlayerReady}
            isFullyExpanded={isFullScreen}
            parentRef={playerRef}
            baseFontSize={mergeFontSize}
            stylePreset={mergeStylePreset}
          />

          {/* Modified Video Controls Overlay to work in both modes */}
          <div
            className={
              isFullScreen
                ? fullscreenOverlayControlsStyles
                : videoOverlayControlsStyles
            }
            style={{
              opacity: isFullScreen
                ? showFullscreenControls
                  ? 1
                  : 0
                : showOverlay
                  ? 1
                  : 0,
            }}
          >
            <Button
              onClick={handleOverlayTogglePlay}
              variant="primary"
              size="sm"
              className={
                isFullScreen ? fullscreenButtonStyles : transparentButtonStyles
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
                isFullScreen ? fullscreenTimeDisplayStyles : timeDisplayStyles
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
                  isFullScreen ? fullscreenSeekbarStyles : seekbarStyles
                }
                style={{ '--seek-before-width': `${progressPercent}%` } as any}
              />
            </div>

            <span
              className={
                isFullScreen ? fullscreenTimeDisplayStyles : timeDisplayStyles
              }
            >
              {formatTime(duration)}
            </span>

            {/* Add Fullscreen Button */}
            <Button
              onClick={() => {
                toggleFullscreen();
                playerRef.current?.focus();
              }}
              variant="secondary"
              size="sm"
              className={
                isFullScreen ? fullscreenButtonStyles : transparentButtonStyles
              }
              title={isFullScreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {isFullScreen ? (
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

        {!isFullScreen && (
          <div className={controlsWrapperStyles(isFullScreen)}>
            <SideMenu
              onProcessUrl={onProcessUrl}
              hasSubtitles={subtitles && subtitles.length > 0}
              onSrtLoaded={onSrtLoaded}
              onShiftAllSubtitles={onShiftAllSubtitles}
              onScrollToCurrentSubtitle={handleScrollToCurrentSubtitle}
              onUiInteraction={handleUiInteraction}
              onSetUrlInput={onSetUrlInput}
              urlInput={urlInput}
              onSelectVideoClick={onSelectVideoClick}
              downloadQuality={downloadQuality}
              onSetDownloadQuality={onSetDownloadQuality}
            />
          </div>
        )}
      </div>
    </div>
  );

  function handlePlayerReady(player: any) {
    onPlayerReady(player);
  }
}
