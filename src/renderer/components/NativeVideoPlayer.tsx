import { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { colors } from '../styles';

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
      nativePlayer.instance.currentTime = validTime;
      setTimeout(() => {
        if (
          nativePlayer.instance &&
          Math.abs(nativePlayer.instance.currentTime - validTime) > 0.5
        ) {
          nativePlayer.instance.currentTime = validTime;
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
    };

    // Always add listeners
    videoElement.addEventListener('error', handleError);
    videoElement.addEventListener('canplay', handleCanPlay);

    // Check if the source needs to be set/reset
    if (videoElement.src !== videoUrl) {
      const isBlob = videoUrl.startsWith('blob:');
      let videoType = 'video/mp4';
      if (!isBlob) {
        if (videoUrl.endsWith('.webm')) videoType = 'video/webm';
        else if (videoUrl.endsWith('.ogg')) videoType = 'video/ogg';
      }
      videoElement.setAttribute('src', videoUrl);
      videoElement.setAttribute('type', videoType);
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
    };
  }, [videoUrl, onPlayerReady]); // Keep dependencies

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
      className={css`
        position: relative;
        margin: 0 auto;
        width: 100%;
        height: 100%;
        min-height: 180px;
        border-radius: 6px;
        overflow: hidden;
        transform: translateZ(0);
        will-change: transform;
      `}
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
