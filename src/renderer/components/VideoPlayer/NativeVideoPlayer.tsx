import { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import {
  setNativePlayerInstance,
  getNativePlayerInstance,
} from '../../native-player.js';

declare global {
  interface Window {
    _videoLastValidTime?: number;
  }
}

// Define SVG Icons
interface IconProps {
  size?: string;
  color?: string;
}

const PlayIcon = ({ size = '64px', color = '#fff' }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M6.96817 4.2448C5.56675 3.40125 3.80317 4.48751 3.80317 6.11543V17.8846C3.80317 19.5125 5.56675 20.5987 6.96817 19.7552L17.6627 13.8706C19.039 13.0445 19.039 10.9555 17.6627 10.1294L6.96817 4.2448Z"
      fill={color}
    />
  </svg>
);

const PauseIcon = ({ size = '64px', color = '#fff' }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="6" y="4" width="4" height="16" rx="1" fill={color} />
    <rect x="14" y="4" width="4" height="16" rx="1" fill={color} />
  </svg>
);

interface NativeVideoPlayerProps {
  videoUrl: string;
  subtitles: {
    start: number | string;
    end: number | string;
    text: string;
  }[];
  onPlayerReady: (player: HTMLVideoElement) => void;
  isFullyExpanded?: boolean;
  parentRef?: React.RefObject<HTMLDivElement | null>;
}

export default function NativeVideoPlayer({
  videoUrl,
  subtitles,
  onPlayerReady,
  isFullyExpanded = false,
  parentRef,
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for timeout

  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeSubtitle, setActiveSubtitle] = useState<string>('');

  // Add a state to track subtitle appearance animation
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  // Add state and refs to track and prevent video resets
  const [isFileUrlVideo, setIsFileUrlVideo] = useState(false);
  const lastValidTimeRef = useRef<number>(0);
  const isSeekingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);
  const timeUpdateCount = useRef(0);

  // State for YouTube-like click behavior
  const [_isPlaying, setIsPlaying] = useState(false);
  const [showIndicator, setShowIndicator] = useState(false);
  const [indicatorType, setIndicatorType] = useState<'play' | 'pause'>('pause');

  // Updated handlePlayerClick to toggle play/pause
  const handlePlayerClick = useCallback(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    // Clear any existing timeout
    if (indicatorTimeoutRef.current) {
      clearTimeout(indicatorTimeoutRef.current);
    }

    // Toggle play/pause (indicator type set by event listeners now)
    if (video.paused) {
      video.play().catch(err => console.error('Play error:', err));
    } else {
      video.pause();
    }

    // Show ephemeral overlay (regardless of type initially, event listener sets it)
    setShowIndicator(true);
    // Hide again after 600ms
    indicatorTimeoutRef.current = setTimeout(() => {
      setShowIndicator(false);
    }, 600);

    // Keep existing focus logic
    if (parentRef?.current) {
      parentRef.current.focus();
      console.log('Video clicked, parent container focused');
    } else if (containerRef.current) {
      containerRef.current.focus();
      console.log('Video clicked, local container focused');
    }
  }, [parentRef]);

  // Keyboard event handler for video seeking
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      console.log('Video container keydown:', event.key);

      if (!videoRef.current) return;

      const videoElement = videoRef.current;
      const currentTime = videoElement.currentTime;
      const duration = videoElement.duration || 0;

      switch (event.key) {
        case 'ArrowRight':
          // Skip forward 10 seconds
          console.log('Skipping forward 10 seconds');
          videoElement.currentTime = Math.min(currentTime + 10, duration);
          event.preventDefault();
          break;
        case 'ArrowLeft':
          // Skip backward 10 seconds
          console.log('Skipping backward 10 seconds');
          videoElement.currentTime = Math.max(currentTime - 10, 0);
          event.preventDefault();
          break;
      }
    },
    []
  );

  // When video URL changes, check if it's a file:// URL
  useEffect(() => {
    setIsFileUrlVideo(videoUrl.startsWith('file://'));
  }, [videoUrl]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Flag to track if the player is ready in this effect run
    let isReady = false;

    const handleError = (_e: Event) => {
      if (videoElement.error) {
        setErrorMessage(
          `Video error: ${videoElement.error.message || videoElement.error.code}`
        );
      } else {
        setErrorMessage('Unknown video error');
      }
      // Ensure player isn't marked as ready globally on error
      if (getNativePlayerInstance() === videoElement) {
        // Cannot directly set isReady, use setNativePlayerInstance if needed
        // For now, just logging or handling the error state is typical
        console.error(
          'Native player error encountered, associated instance:',
          videoElement
        );
      }
    };

    const handleCanPlay = () => {
      if (isReady) return; // Prevent multiple calls if event fires again
      isReady = true;
      // Update global state as well
      if (getNativePlayerInstance() !== videoElement) {
        setNativePlayerInstance(videoElement); // Use the setter function
      }
      // Cannot directly set isReady/isInitialized here, managed by setNativePlayerInstance
      // nativePlayer.isReady = true; // Remove direct access
      // nativePlayer.lastAccessed = Date.now(); // Remove direct access (done internally)
      // nativePlayer.isInitialized = true; // Remove direct access
      console.log('Native player is now ready.');
      // Call the prop callback
      onPlayerReady(videoElement);

      // For file:// URLs, apply any pending seek operation that was waiting for canplay
      if (isFileUrlVideo && pendingSeekRef.current !== null) {
        const targetTime = pendingSeekRef.current;
        console.log(`Applying pending seek to ${targetTime} after canPlay`);
        videoElement.currentTime = targetTime;
        pendingSeekRef.current = null;
      }
    };

    // Fix for videos loaded from URL that reset to the beginning
    const handleSeeking = () => {
      const time = videoElement.currentTime;
      console.log('Video seeking event at time:', time);
      isSeekingRef.current = true;

      // Store the seek target as the last valid time
      if (time > 0) {
        lastValidTimeRef.current = time;
        // Reset the timeUpdateCount when a legitimate seek happens
        timeUpdateCount.current = 0;
      }
    };

    const handleSeeked = () => {
      const time = videoElement.currentTime;
      console.log('Video seeked event, now at time:', time);
      isSeekingRef.current = false;

      // Double-check the currentTime after seeked to ensure it stuck
      if (time > 0) {
        lastValidTimeRef.current = time;
      } else if (isFileUrlVideo && lastValidTimeRef.current > 0) {
        // If we ended up at 0 but had a valid time, try to restore it
        console.log(
          `Video reset detected after seek, restoring to ${lastValidTimeRef.current}`
        );
        videoElement.currentTime = lastValidTimeRef.current;
      }
    };

    // Enhanced timeupdate handler to detect and fix resets
    const handleTimeUpdateExtended = () => {
      const time = videoElement.currentTime;

      // For file:// URLs, detect video reset pattern
      if (isFileUrlVideo && !isSeekingRef.current) {
        if (time === 0 && lastValidTimeRef.current > 0) {
          timeUpdateCount.current++;

          // More aggressive correction: fix immediately for file:// URLs
          // This prevents the visible flash of reset to beginning
          console.log(
            `Detected reset to 0, immediately restoring to ${lastValidTimeRef.current}`
          );
          videoElement.currentTime = lastValidTimeRef.current;

          // If we've had multiple resets, try a more drastic approach
          if (timeUpdateCount.current >= 3) {
            console.log('Multiple resets detected, applying emergency fix');
            // This forces a pause-seek-play cycle which can help with stubborn videos
            const wasPlaying = !videoElement.paused;
            if (wasPlaying) {
              videoElement.pause();
              setTimeout(() => {
                if (!videoElement) return;
                videoElement.currentTime = lastValidTimeRef.current;
                videoElement.play().catch(err => {
                  console.error('Failed to resume after emergency fix:', err);
                });
              }, 50);
            } else {
              videoElement.currentTime = lastValidTimeRef.current;
            }
            // Reset the counter after emergency fix
            timeUpdateCount.current = 0;
          }
        } else if (time > 0) {
          // Update the last valid time when we have a legitimate time
          lastValidTimeRef.current = time;
          // Only reset the counter if we've been stable for a while
          if (timeUpdateCount.current <= 1) {
            timeUpdateCount.current = 0;
          } else {
            // Gradually decrease counter instead of immediately resetting
            timeUpdateCount.current--;
          }
        }
      }
    };

    // Add more handlers to debug and fix URL video issues
    const handlePlay = () => {
      console.log('Video play event at time:', videoElement.currentTime);

      // Restore position if we're at 0 but should be elsewhere
      if (
        isFileUrlVideo &&
        videoElement.currentTime === 0 &&
        lastValidTimeRef.current > 0
      ) {
        console.log(
          `Restoring position on play to ${lastValidTimeRef.current}`
        );
        // Use a short timeout to ensure the play event fully processes first
        setTimeout(() => {
          if (!videoElement) return;
          videoElement.currentTime = lastValidTimeRef.current;
          console.log(
            `Position after restoration: ${videoElement.currentTime}`
          );
        }, 50);
      }
    };

    const handlePause = () => {
      console.log('Video pause event at time:', videoElement.currentTime);
      // Save current time as last valid when pausing
      if (videoElement.currentTime > 0) {
        lastValidTimeRef.current = videoElement.currentTime;
      }
    };

    const handleLoadedMetadata = () => {
      console.log('NativeVideoPlayer: Loaded metadata');
      if (!videoElement) return;

      // Reset internal state when new metadata loaded
      lastValidTimeRef.current = 0;
      isSeekingRef.current = false;
      pendingSeekRef.current = null;
      timeUpdateCount.current = 0;

      // Set initial playing state based on video
      setIsPlaying(!videoElement.paused);

      if (!isReady) {
        console.log(
          'NativeVideoPlayer: Ready state triggered by loadedmetadata'
        );
        // Use the setter function to update the instance
        if (getNativePlayerInstance() !== videoElement) {
          setNativePlayerInstance(videoElement);
        }
        // nativePlayer.instance = videoElement; // Removed direct access
        // nativePlayer.isReady = true; // Removed direct access (managed internally)
        // nativePlayer.lastAccessed = Date.now(); // Removed direct access (managed internally)
        onPlayerReady(videoElement);
        isReady = true;
      }

      // Special handling for file URLs after metadata
      if (isFileUrlVideo) {
        const storedTime = window._videoLastValidTime;
        if (storedTime && storedTime > 0 && videoElement.currentTime === 0) {
          console.log(
            `NativeVideoPlayer: Restoring file video position to ${storedTime} on loadedmetadata`
          );
          videoElement.currentTime = storedTime;
          lastValidTimeRef.current = storedTime; // Update ref as well
        }
      }
    };

    const handleLoadedData = () => {
      console.log(
        'Video loadeddata event, readyState:',
        videoElement.readyState
      );

      // Another opportunity to restore position for file:// URLs
      if (
        isFileUrlVideo &&
        lastValidTimeRef.current > 0 &&
        !isSeekingRef.current
      ) {
        console.log(
          `Restoring position after data loaded to ${lastValidTimeRef.current}`
        );
        videoElement.currentTime = lastValidTimeRef.current;
      }
    };

    // Add handler for stalled/waiting events
    const handleWaiting = () => {
      console.log(
        'Video waiting/stalled event at time:',
        videoElement.currentTime
      );

      // Check if we're at position 0 but should be elsewhere
      if (
        isFileUrlVideo &&
        videoElement.currentTime === 0 &&
        lastValidTimeRef.current > 0
      ) {
        console.log(
          `Video stalled at beginning, restoring to ${lastValidTimeRef.current}`
        );
        videoElement.currentTime = lastValidTimeRef.current;
      }
    };

    // Always add listeners
    videoElement.addEventListener('error', handleError);
    videoElement.addEventListener('canplay', handleCanPlay);
    videoElement.addEventListener('seeking', handleSeeking);
    videoElement.addEventListener('seeked', handleSeeked);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);
    videoElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoElement.addEventListener('loadeddata', handleLoadedData);
    videoElement.addEventListener('timeupdate', handleTimeUpdateExtended);
    videoElement.addEventListener('waiting', handleWaiting);

    // Check if the source needs to be set/reset
    if (videoElement.src !== videoUrl) {
      const isBlob = videoUrl.startsWith('blob:');
      const isFileUrl = videoUrl.startsWith('file://');
      let videoType = 'video/mp4';
      if (!isBlob) {
        if (videoUrl.endsWith('.webm')) videoType = 'video/webm';
        else if (videoUrl.endsWith('.ogg')) videoType = 'video/ogg';
      }

      // Reset time tracking when loading a new video
      lastValidTimeRef.current = 0;
      timeUpdateCount.current = 0;
      pendingSeekRef.current = null;

      videoElement.setAttribute('src', videoUrl);
      videoElement.setAttribute('type', videoType);

      // Special handling for file:// URLs
      if (isFileUrl) {
        videoElement.crossOrigin = 'anonymous';
        // Set a longer preload buffer for File URLs
        videoElement.preload = 'auto';
      }

      videoElement.load(); // Explicitly call load()
      // Reset global state until canplay fires
      // Use the setter function, it handles readiness and initialization state
      setNativePlayerInstance(videoElement);
      // nativePlayer.instance = videoElement; // Removed direct access
      // nativePlayer.isReady = false; // Removed direct access (managed internally by setNativePlayerInstance)
      // nativePlayer.isInitialized = true; // Removed direct access (managed internally by setNativePlayerInstance)
    } else {
      // If src is the same, check if it can play already, maybe it loaded quickly
      if (videoElement.readyState >= 3) {
        // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
        handleCanPlay();
      }
      // Ensure global instance is set if src matches but instance was lost
      else if (getNativePlayerInstance() !== videoElement) {
        setNativePlayerInstance(videoElement);
        // Don't set isReady true here, wait for canplay
      }
    }

    // Cleanup
    return () => {
      videoElement.removeEventListener('error', handleError);
      videoElement.removeEventListener('canplay', handleCanPlay);
      videoElement.removeEventListener('seeking', handleSeeking);
      videoElement.removeEventListener('seeked', handleSeeked);
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
      videoElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
      videoElement.removeEventListener('loadeddata', handleLoadedData);
      videoElement.removeEventListener('timeupdate', handleTimeUpdateExtended);
      videoElement.removeEventListener('waiting', handleWaiting);
    };
  }, [videoUrl, onPlayerReady, isFileUrlVideo]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    videoElement.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
    };

    function handleTimeUpdate() {
      if (!videoElement) return;
      const newCurrentTime = videoElement.currentTime;

      if (subtitles && subtitles.length > 0) {
        let newSubtitle = '';
        for (const segment of subtitles) {
          const start =
            typeof segment.start === 'number'
              ? segment.start
              : parseFloat(String(segment.start));
          const end =
            typeof segment.end === 'number'
              ? segment.end
              : parseFloat(String(segment.end));

          if (newCurrentTime >= start && newCurrentTime <= end) {
            newSubtitle = segment.text;
            break;
          }
        }
        if (newSubtitle !== activeSubtitle) {
          // When subtitle changes, briefly set visibility to false for transition effect
          if (activeSubtitle) {
            setSubtitleVisible(false);
          }
          setActiveSubtitle(newSubtitle);
        }
      } else {
        if (activeSubtitle) {
          setSubtitleVisible(false);
          setActiveSubtitle('');
        }
      }
    }
  }, [subtitles, activeSubtitle]);

  useEffect(() => {
    // Handle subtitle visibility with small delay for smooth appearance
    if (activeSubtitle) {
      // Small delay to allow for nice fade-in effect
      const timer = setTimeout(() => {
        setSubtitleVisible(true);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSubtitleVisible(false);
    }
  }, [activeSubtitle]);

  // Add back the effect to reset subtitles when the subtitles array changes
  useEffect(() => {
    setActiveSubtitle('');
  }, [subtitles]);

  const subtitleStyles = useCallback(() => {
    let fontSize = '18px';
    if (isFullyExpanded) {
      fontSize = '32px';
    }

    let width = '100%';
    if (isFullyExpanded) width = '90%';

    return { width, fontSize };
  }, [isFullyExpanded]);

  const videoErrorStyles = css`
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: ${colors.light}; // Use theme background
    color: ${colors.danger}; // Use theme danger color
    padding: 10px 15px;
    border-radius: 4px;
    font-size: 0.9rem;
    border: 1px solid ${colors.danger};
    z-index: 10;
  `;

  // Effect to sync isPlaying state and indicator type with video events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      console.log('Video play event');
      setIsPlaying(true);
      setIndicatorType('play'); // Set indicator type on play
    };
    const onPause = () => {
      console.log('Video pause event');
      setIsPlaying(false);
      setIndicatorType('pause'); // Set indicator type on pause
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);

    // Initial check
    setIsPlaying(!video.paused);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      // Clear timeout on unmount
      if (indicatorTimeoutRef.current) {
        clearTimeout(indicatorTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        css`
          position: relative;
          margin: 0 auto;
          width: 100%;
          height: 100%;
          min-height: 180px;
          border-radius: 6px;
          overflow: hidden;
          transform: translateZ(0);
          will-change: transform;
        ` + ' native-video-player-wrapper'
      }
      tabIndex={-1} /* Make container focusable to capture keyboard events */
      onKeyDown={handleKeyDown} /* Add keyboard event handler to container */
    >
      <video
        ref={videoRef}
        style={{
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          display: 'block',
          zIndex: 1,
          visibility: 'visible',
        }}
        playsInline
        preload="auto"
        autoPlay={false}
        muted={false}
        crossOrigin="anonymous"
        controlsList="nodownload"
        disablePictureInPicture
        onClick={handlePlayerClick}
        onEnded={() => console.log('Video ended')}
        onError={() => setErrorMessage('Video playback error')}
      >
        Your browser does not support HTML5 video.
      </video>

      {activeSubtitle && (
        <div
          className={css`
            position: absolute;
            bottom: ${isFullyExpanded ? '50px' : '10px'};
            left: 50%;
            transform: translateX(-50%)
              ${subtitleVisible ? 'translateY(0)' : 'translateY(10px)'};
            background: linear-gradient(
              to top,
              rgba(0, 0, 0, 0.85),
              rgba(0, 0, 0, 0.65)
            );
            color: white;
            border-radius: 8px;
            padding: ${isFullyExpanded ? '12px 18px' : '8px 14px'};
            text-align: center;
            font-weight: 500;
            line-height: 1.6;
            font-family:
              'Inter',
              -apple-system,
              BlinkMacSystemFont,
              'Segoe UI',
              Roboto,
              sans-serif;
            letter-spacing: 0.01em;
            white-space: pre-line;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            min-width: 40%;
            max-width: ${isFullyExpanded ? '80%' : '90%'};
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
            user-select: none;
            opacity: ${subtitleVisible ? 1 : 0};
            transition:
              opacity 0.25s ease,
              transform 0.25s ease;
            border: none;
          `}
          style={{
            width: subtitleStyles().width,
            fontSize: subtitleStyles().fontSize,
          }}
        >
          {activeSubtitle}
        </div>
      )}

      {/* Ephemeral Play/Pause Icon Overlay */}
      {showIndicator && (
        <div
          className={css`
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            animation: fadeOut 0.6s forwards ease-out;
            pointer-events: none; // Don't block clicks on video
            color: rgba(255, 255, 255, 0.8); // White with some transparency
            background-color: rgba(
              0,
              0,
              0,
              0.5
            ); // Dark semi-transparent background
            border-radius: 50%; // Circular background
            padding: 15px; // Padding around the icon
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);

            @keyframes fadeOut {
              0% {
                opacity: 1;
                transform: translate(-50%, -50%) scale(1.05); // Slight pop
              }
              70% {
                // Hold opacity a bit longer
                opacity: 1;
                transform: translate(-50%, -50%) scale(1);
              }
              100% {
                opacity: 0;
                transform: translate(-50%, -50%) scale(0.95);
                visibility: hidden;
              }
            }
          `}
        >
          {indicatorType === 'pause' ? (
            <PauseIcon size="48px" />
          ) : (
            <PlayIcon size="48px" />
          )}
        </div>
      )}

      {errorMessage && <div className={videoErrorStyles}>{errorMessage}</div>}
    </div>
  );
}
