import { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../../styles.js';
import {
  setNativePlayerInstance,
  getNativePlayerInstance,
} from '../../native-player.js';
import BaseSubtitleDisplay from '../../components/BaseSubtitleDisplay.js';
import { SrtSegment } from '@shared-types/app';
import { SubtitleStylePresetKey } from '../../../shared/constants/subtitle-styles.js';
import { cueText } from '../../../shared/helpers/index.js';
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
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: HTMLVideoElement) => void;
  isFullyExpanded?: boolean;
  parentRef?: React.RefObject<HTMLDivElement | null>;
  baseFontSize: number;
  stylePreset: SubtitleStylePresetKey;
  showOriginalText: boolean;
}

export default function NativeVideoPlayer({
  videoRef,
  videoUrl,
  subtitles,
  onPlayerReady,
  isFullyExpanded = false,
  parentRef,
  baseFontSize,
  showOriginalText,
  stylePreset,
}: NativeVideoPlayerProps) {
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

  const [nativeHeight, setNativeHeight] = useState<number>(0);
  const [displayHeight, setDisplayHeight] = useState<number>(0);

  const onReadyCalledRef = useRef<boolean>(false);

  const handlePlayerClick = useCallback(() => {
    if (!videoRef?.current) return;
    const video = videoRef?.current;

    if (indicatorTimeoutRef?.current) {
      clearTimeout(indicatorTimeoutRef?.current);
    }

    if (video.paused) {
      video.play().catch(err => console.error('Play error:', err));
    } else {
      video.pause();
    }

    setShowIndicator(true);
    indicatorTimeoutRef.current = setTimeout(() => {
      setShowIndicator(false);
    }, 600);

    // Keep existing focus logic
    if (parentRef?.current) {
      parentRef?.current.focus();
      console.log('Video clicked, parent container focused');
    } else if (containerRef?.current) {
      containerRef?.current.focus();
      console.log('Video clicked, local container focused');
    }
  }, [parentRef, videoRef]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!videoRef.current) return;

      const video = videoRef.current;
      const time = video.currentTime;
      const duration = video.duration || 0;

      switch (event.key) {
        case 'ArrowLeft':
          video.currentTime = Math.max(time - 10, 0);
          break;

        case 'ArrowRight':
          video.currentTime = Math.min(time + 10, duration);
          break;

        case ' ':
        case 'Space':
        case 'Spacebar':
          if (video.paused) {
            video.play().catch(console.error);
          } else {
            video.pause();
          }
          break;

        default:
          return;
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [videoRef]
  );

  useEffect(() => {
    setIsFileUrlVideo(videoUrl.startsWith('file://'));
  }, [videoUrl]);

  useEffect(() => {
    const videoElement = videoRef?.current;
    if (!videoElement) return;

    onReadyCalledRef.current = false;

    const handleError = (_e: Event) => {
      if (videoElement.error) {
        setErrorMessage(
          `Video error: ${videoElement.error.message || videoElement.error.code}`
        );
      } else {
        setErrorMessage('Unknown video error');
      }
      if (getNativePlayerInstance() === videoElement) {
        console.error(
          'Native player error encountered, associated instance:',
          videoElement
        );
      }
    };

    const handleCanPlay = () => {
      if (onReadyCalledRef.current) return;
      onReadyCalledRef.current = true;
      if (getNativePlayerInstance() !== videoElement) {
        setNativePlayerInstance(videoElement);
      }
      onPlayerReady(videoElement);

      if (isFileUrlVideo && pendingSeekRef?.current !== null) {
        const targetTime = pendingSeekRef?.current;
        console.log(`Applying pending seek to ${targetTime} after canPlay`);
        videoElement.currentTime = targetTime;
        pendingSeekRef.current = null;
      }
    };

    const handleSeeking = () => {
      const time = videoElement.currentTime;
      isSeekingRef.current = true;

      lastValidTimeRef.current = time;
      timeUpdateCount.current = 0;
    };

    const handleSeeked = () => {
      const time = videoElement.currentTime;
      console.log('Video seeked event, now at time:', time);
      isSeekingRef.current = false;

      // Double-check the currentTime after seeked to ensure it stuck
      if (time > 0) {
        lastValidTimeRef.current = time;
      } else if (isFileUrlVideo && lastValidTimeRef?.current > 0) {
        // If we ended up at 0 but had a valid time, try to restore it
        console.log(
          `Video reset detected after seek, restoring to ${lastValidTimeRef?.current}`
        );
        videoElement.currentTime = lastValidTimeRef?.current;
      }
    };

    // Enhanced timeupdate handler to detect and fix resets
    const handleTimeUpdateExtended = () => {
      const time = videoElement.currentTime;

      // For file:// URLs, detect video reset pattern
      if (isFileUrlVideo && !isSeekingRef?.current) {
        if (time === 0 && lastValidTimeRef?.current > 0) {
          timeUpdateCount.current++;

          // More aggressive correction: fix immediately for file:// URLs
          // This prevents the visible flash of reset to beginning
          console.log(
            `Detected reset to 0, immediately restoring to ${lastValidTimeRef?.current}`
          );
          videoElement.currentTime = lastValidTimeRef?.current;

          // If we've had multiple resets, try a more drastic approach
          if (timeUpdateCount?.current >= 3) {
            console.log('Multiple resets detected, applying emergency fix');
            // This forces a pause-seek-play cycle which can help with stubborn videos
            const wasPlaying = !videoElement.paused;
            if (wasPlaying) {
              videoElement.pause();
              setTimeout(() => {
                if (!videoElement) return;
                videoElement.currentTime = lastValidTimeRef?.current;
                videoElement.play().catch(err => {
                  console.error('Failed to resume after emergency fix:', err);
                });
              }, 50);
            } else {
              videoElement.currentTime = lastValidTimeRef?.current;
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

    const handlePlay = () => {
      console.log('Video play event at time:', videoElement.currentTime);

      // Restore position if we're at 0 but should be elsewhere
      if (
        isFileUrlVideo &&
        videoElement.currentTime === 0 &&
        lastValidTimeRef?.current > 0
      ) {
        console.log(
          `Restoring position on play to ${lastValidTimeRef?.current}`
        );
        // Use a short timeout to ensure the play event fully processes first
        setTimeout(() => {
          if (!videoElement) return;
          videoElement.currentTime = lastValidTimeRef?.current;
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

      if (!onReadyCalledRef.current) {
        onReadyCalledRef.current = true;
        console.log(
          'NativeVideoPlayer: Ready state triggered by loadedmetadata'
        );
        if (getNativePlayerInstance() !== videoElement) {
          setNativePlayerInstance(videoElement);
        }
        onPlayerReady(videoElement);
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
        lastValidTimeRef?.current > 0 &&
        !isSeekingRef?.current
      ) {
        console.log(
          `Restoring position after data loaded to ${lastValidTimeRef?.current}`
        );
        videoElement.currentTime = lastValidTimeRef?.current;
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
        lastValidTimeRef?.current > 0
      ) {
        console.log(
          `Video stalled at beginning, restoring to ${lastValidTimeRef?.current}`
        );
        videoElement.currentTime = lastValidTimeRef?.current;
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

      videoElement.load();
      setNativePlayerInstance(videoElement);
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
  }, [videoUrl, onPlayerReady, isFileUrlVideo, videoRef]);

  useEffect(() => {
    const videoElement = videoRef?.current;
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
          if (
            newCurrentTime >= Number(segment.start) &&
            newCurrentTime <= Number(segment.end)
          ) {
            newSubtitle = cueText(
              segment,
              showOriginalText ? 'dual' : 'translation'
            );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles, activeSubtitle, videoRef]);

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
    const video = videoRef?.current;
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
      if (indicatorTimeoutRef?.current) {
        clearTimeout(indicatorTimeoutRef?.current);
      }
    };
  }, [videoRef]);

  useEffect(() => {
    const videoElement = videoRef?.current;
    if (!videoElement) return;

    const handleMetadata = () => {
      if (videoElement.videoHeight > 0) {
        console.log('Native video height:', videoElement.videoHeight);
        setNativeHeight(videoElement.videoHeight);
      }
      // Also set initial display height
      if (videoElement.clientHeight > 0) {
        console.log('Initial display height:', videoElement.clientHeight);
        setDisplayHeight(videoElement.clientHeight);
      }
    };

    videoElement.addEventListener('loadedmetadata', handleMetadata);
    // Call once in case metadata is already loaded
    if (videoElement.readyState >= 1) {
      // HAVE_METADATA
      handleMetadata();
    }

    return () => {
      videoElement.removeEventListener('loadedmetadata', handleMetadata);
    };
    // Add dependencies that signal video source change or readiness
  }, [videoUrl, videoRef]); // Re-run if video source changes

  useEffect(() => {
    const videoElement = videoRef?.current;
    if (!videoElement) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === videoElement) {
          const newHeight = Math.round(entry.contentRect.height);
          if (newHeight > 0) {
            setDisplayHeight(newHeight);
          }
        }
      }
    });

    resizeObserver.observe(videoElement);

    // Set initial height one more time after observing
    if (videoElement.clientHeight > 0 && displayHeight === 0) {
      setDisplayHeight(videoElement.clientHeight);
    }

    return () => {
      resizeObserver.unobserve(videoElement);
      resizeObserver.disconnect();
    };
  }, [displayHeight, videoRef]); // Re-run if videoRef changes (though unlikely)

  // Calculate the effective display font size
  const calculateDisplayFontSize = () => {
    const safeBaseSize = Math.max(10, baseFontSize || 24); // Use baseFontSize prop

    if (nativeHeight > 0 && displayHeight > 0) {
      const scaleFactor = displayHeight / nativeHeight;
      return Math.max(10, Math.round(safeBaseSize * scaleFactor));
    }
    return isFullyExpanded ? Math.round(safeBaseSize * 1.2) : safeBaseSize;
  };

  const effectiveDisplayFontSize = calculateDisplayFontSize();

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
          &:focus,
          &:focus-visible {
            outline: none;
            box-shadow: none;
          }
        ` + ' native-video-player-wrapper'
      }
      tabIndex={-1} /* Make container focusable to capture keyboard events */
      onKeyDown={handleKeyDown} /* Add keyboard event handler to container */
    >
      <video
        ref={videoRef}
        tabIndex={0}
        className={css`
          &:focus,
          &:focus-visible {
            outline: none;
            box-shadow: none;
          }
        `}
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
        onClick={e => {
          handlePlayerClick();
          (e.currentTarget as HTMLVideoElement).focus();
        }}
        onEnded={() => console.log('Video ended')}
        onError={() => setErrorMessage('Video playback error')}
      >
        Your browser does not support HTML5 video.
      </video>

      <BaseSubtitleDisplay
        text={activeSubtitle}
        isVisible={subtitleVisible}
        displayFontSize={effectiveDisplayFontSize}
        isFullScreen={isFullyExpanded}
        stylePreset={stylePreset}
      />

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
