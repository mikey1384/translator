import { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../styles';

// Add global type declaration for the Window object
declare global {
  interface Window {
    _videoLastValidTime?: number;
  }
}

export const nativePlayer: {
  instance: HTMLVideoElement | null;
  isReady: boolean;
  lastAccessed: number;
  isInitialized: boolean;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  getCurrentTime: () => number;
  isPlaying: () => boolean;
} = {
  instance: null,
  isReady: false,
  lastAccessed: 0,
  isInitialized: false,

  play: async () => {
    if (!nativePlayer.instance) return;
    try {
      // For file:// URLs, check if we need to restore position first
      const isFileUrl = nativePlayer.instance.src.startsWith('file://');
      if (
        isFileUrl &&
        nativePlayer.instance.currentTime === 0 &&
        window._videoLastValidTime &&
        window._videoLastValidTime > 0
      ) {
        console.log(
          `Restoring position to ${window._videoLastValidTime} before playing`
        );
        nativePlayer.instance.currentTime = window._videoLastValidTime;
        // Small delay to ensure the seek takes effect
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      await nativePlayer.instance.play();
    } catch (error) {
      console.error('Error playing video:', error);
      throw error;
    }
  },

  pause: () => {
    if (!nativePlayer.instance) return;
    nativePlayer.instance.pause();
  },

  seek: (time: number) => {
    if (!nativePlayer.instance) return;

    const validTime =
      typeof time === 'number' && !isNaN(time) && time >= 0 ? time : 0;

    try {
      // For file:// URLs, set a ref that our component can access
      const isFileUrl = nativePlayer.instance.src.startsWith('file://');

      console.log(`Seeking to ${validTime} (file URL: ${isFileUrl})`);

      // Store the intended seek position for later use if needed
      if (window._videoLastValidTime === undefined) {
        window._videoLastValidTime = 0;
      }

      // Only store if it's a meaningful position
      if (validTime > 0) {
        window._videoLastValidTime = validTime;
      }

      // Directly set currentTime
      nativePlayer.instance.currentTime = validTime;

      // Add a more aggressive retry mechanism for videos loaded from URLs
      setTimeout(() => {
        if (!nativePlayer.instance) return;

        const currentTime = nativePlayer.instance.currentTime;
        if (Math.abs(currentTime - validTime) > 0.5) {
          console.log(
            `Correcting seek: Current ${currentTime}, Target ${validTime}`
          );
          nativePlayer.instance.currentTime = validTime;

          // Add a second retry with longer delay for problematic videos
          setTimeout(() => {
            if (!nativePlayer.instance) return;

            const newTime = nativePlayer.instance.currentTime;
            if (Math.abs(newTime - validTime) > 0.5) {
              console.log(
                `Second seek correction: Current ${newTime}, Target ${validTime}`
              );
              nativePlayer.instance.currentTime = validTime;

              // For persistent problems, try an extreme measure - pause then seek then play
              if (isFileUrl && !nativePlayer.instance.paused) {
                console.log('Using pause-seek-play strategy for file:// URL');
                const wasPlaying = !nativePlayer.instance.paused;
                nativePlayer.instance.pause();

                setTimeout(() => {
                  if (!nativePlayer.instance) return;
                  nativePlayer.instance.currentTime = validTime;

                  if (wasPlaying) {
                    setTimeout(() => {
                      if (nativePlayer.instance) {
                        nativePlayer.instance.play().catch(err => {
                          console.error(
                            'Error resuming playback after seek:',
                            err
                          );
                        });
                      }
                    }, 50);
                  }
                }, 50);
              }
            }
          }, 200);
        }
      }, 50);
    } catch (error) {
      console.error('Error during seek operation:', error);
    }
  },

  getCurrentTime: () => {
    if (!nativePlayer.instance) {
      return 0;
    }
    return nativePlayer.instance.currentTime;
  },

  isPlaying: () => {
    if (!nativePlayer.instance) {
      return false;
    }
    return !nativePlayer.instance.paused;
  },
};

interface NativeVideoPlayerProps {
  videoUrl: string;
  subtitles: {
    start: number | string;
    end: number | string;
    text: string;
  }[];
  onPlayerReady: (player: HTMLVideoElement) => void;
  isExpanded?: boolean;
  isFullyExpanded?: boolean;
}

export default function NativeVideoPlayer({
  videoUrl,
  subtitles,
  onPlayerReady,
  isExpanded = false,
  isFullyExpanded = false,
}: NativeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (nativePlayer.instance === videoElement) {
        nativePlayer.isReady = false;
      }
    };

    const handleCanPlay = () => {
      if (isReady) return; // Prevent multiple calls if event fires again
      isReady = true;
      // Update global state as well
      if (nativePlayer.instance !== videoElement) {
        nativePlayer.instance = videoElement;
      }
      nativePlayer.isReady = true;
      nativePlayer.lastAccessed = Date.now();
      nativePlayer.isInitialized = true;
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
      console.log(
        'Video loadedmetadata event, duration:',
        videoElement.duration
      );

      // For file:// URLs: if we were at a valid position before, restore it
      if (
        isFileUrlVideo &&
        lastValidTimeRef.current > 0 &&
        videoElement.readyState >= 2
      ) {
        console.log(
          `Restoring position after metadata loaded to ${lastValidTimeRef.current}`
        );
        // Use setTimeout to ensure the metadata is fully processed
        setTimeout(() => {
          if (!videoElement) return;
          videoElement.currentTime = lastValidTimeRef.current;
          console.log(
            `Position after metadata restoration: ${videoElement.currentTime}`
          );
        }, 100);
      } else {
        // For some URL-loaded videos, this is a good time to check if ready
        if (videoElement.readyState >= 2 && !isReady) {
          console.log('Video has metadata and is ready to play');
          handleCanPlay();
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
      nativePlayer.instance = videoElement;
      nativePlayer.isReady = false;
      nativePlayer.isInitialized = true; // Mark as initialized even if not ready
    } else {
      // If src is the same, check if it can play already, maybe it loaded quickly
      if (videoElement.readyState >= 3) {
        // HAVE_FUTURE_DATA or HAVE_ENOUGH_DATA
        handleCanPlay(); // Manually trigger if already playable
      }
      // Ensure global instance is set if src matches but instance was lost
      else if (nativePlayer.instance !== videoElement) {
        nativePlayer.instance = videoElement;
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
    } else if (isExpanded) {
      fontSize = '24px';
    }

    let width = '100%';
    if (isExpanded) width = '95%';
    if (isFullyExpanded) width = '90%';

    return { width, fontSize };
  }, [isExpanded, isFullyExpanded]);

  // Style for the video error message
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
        onTimeUpdate={e =>
          console.log(
            'Time update:',
            (e.target as HTMLVideoElement).currentTime
          )
        }
        onEnded={() => console.log('Video ended')}
        onError={() => setErrorMessage('Video playback error')}
      >
        Your browser does not support HTML5 video.
      </video>

      {activeSubtitle && (
        <div
          className={css`
            position: absolute;
            bottom: ${isFullyExpanded ? '120px' : '10px'};
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

      {errorMessage && <div className={videoErrorStyles}>{errorMessage}</div>}
    </div>
  );
}
