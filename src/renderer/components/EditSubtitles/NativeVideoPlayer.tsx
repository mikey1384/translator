import React, { useEffect, useMemo, useRef, useState } from "react";
import { css } from "@emotion/css";

// Global reference to the player for direct access from other components
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
    if (!nativePlayer.instance) {
      console.error("play called but no player instance available");
      return;
    }
    try {
      await nativePlayer.instance.play();
    } catch (error) {
      console.error("Error playing video:", error);
      throw error;
    }
  },

  pause: () => {
    if (!nativePlayer.instance) {
      console.error("pause called but no player instance available");
      return;
    }
    nativePlayer.instance.pause();
  },

  seek: (time: number) => {
    if (!nativePlayer.instance) {
      console.error("seek called but no player instance available");
      return;
    }

    const validTime =
      typeof time === "number" && !isNaN(time) && time >= 0 ? time : 0;

    try {
      // Simply set the current time property - our custom overlay will handle the subtitles
      nativePlayer.instance.currentTime = validTime;

      // After seeking, check if it worked correctly
      setTimeout(() => {
        if (nativePlayer.instance) {
          const actualTime = nativePlayer.instance.currentTime;

          // If the seek didn't work as expected, try again
          if (Math.abs(actualTime - validTime) > 0.5) {
            nativePlayer.instance.currentTime = validTime;
          }
        }
      }, 50);
    } catch (error) {
      console.error("Error during seek operation:", error);
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
  subtitles: any[];
  onPlayerReady: (player: HTMLVideoElement) => void;
  isExpanded?: boolean;
  isFullyExpanded?: boolean;
}

const NativeVideoPlayer: React.FC<NativeVideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
  isExpanded = false,
  isFullyExpanded = false,
}) => {
  // Remove debug log
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [activeSubtitle, setActiveSubtitle] = useState<string>("");
  const [containerWidth, setContainerWidth] = useState(0);

  // Handle video initialization
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // If we already have the same URL loaded, don't reinitialize
    if (videoElement.src === videoUrl) {
      // Still update the global reference if needed
      if (nativePlayer.instance !== videoElement) {
        nativePlayer.instance = videoElement;
        nativePlayer.isReady = true;
      }
      return;
    }

    // Load video
    // In Electron, let's try to explicitly set the src attribute rather than property
    if (videoUrl) {
      // Check if the format is supported
      const videoType = videoUrl.startsWith("blob:")
        ? "video/mp4"
        : videoUrl.endsWith(".mp4")
        ? "video/mp4"
        : videoUrl.endsWith(".webm")
        ? "video/webm"
        : videoUrl.endsWith(".ogg")
        ? "video/ogg"
        : "video/mp4";

      // Set src attribute directly
      videoElement.setAttribute("src", videoUrl);
      videoElement.load();
    }

    // Store the video element in the global reference
    nativePlayer.instance = videoElement;
    nativePlayer.isReady = true;
    nativePlayer.lastAccessed = Date.now();
    nativePlayer.isInitialized = true;

    // Set up event handlers
    const handleError = (e: ErrorEvent) => {
      console.error("Video error:", e);
      console.error("Video error details:", videoElement.error);

      if (videoElement.error) {
        setErrorMessage(
          `Video error: ${
            videoElement.error.message || videoElement.error.code
          }`
        );
      } else {
        setErrorMessage("Unknown video error");
      }
    };

    const handleLoadedMetadata = () => {
      // Video metadata loaded successfully
    };

    const handleCanPlay = () => {
      onPlayerReady(videoElement);
    };

    const handlePlay = () => {
      // Video play event
    };

    const handlePause = () => {
      // Video pause event
    };

    const handleSeeking = () => {
      // With our custom subtitle overlay, we don't need any track-specific cleanup
      // The time update handler will automatically find the correct subtitle
    };

    const handleSeeked = () => {
      // Video seeked completed
    };

    // Set up event handlers
    videoElement.addEventListener("error", handleError);
    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("canplay", handleCanPlay);
    videoElement.addEventListener("play", handlePlay);
    videoElement.addEventListener("pause", handlePause);
    videoElement.addEventListener("seeking", handleSeeking);
    videoElement.addEventListener("seeked", handleSeeked);

    // Clean up event handlers
    return () => {
      videoElement.removeEventListener("error", handleError);
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("canplay", handleCanPlay);
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
      videoElement.removeEventListener("seeking", handleSeeking);
      videoElement.removeEventListener("seeked", handleSeeked);

      // Clean up global reference
      if (nativePlayer.instance === videoElement) {
        nativePlayer.instance = null;
        nativePlayer.isReady = false;
      }
    };
  }, [videoUrl, onPlayerReady]);

  // Ensure the activeSubtitle is properly reset when subtitles change
  useEffect(() => {
    setActiveSubtitle("");

    // Force check for subtitles at current time when subtitles array changes
    if (videoRef.current && subtitles && subtitles.length > 0) {
      const currentTime = videoRef.current.currentTime;

      for (const segment of subtitles) {
        const start =
          typeof segment.start === "number"
            ? segment.start
            : parseFloat(String(segment.start));
        const end =
          typeof segment.end === "number"
            ? segment.end
            : parseFloat(String(segment.end));

        if (currentTime >= start && currentTime <= end) {
          setActiveSubtitle(segment.text);
          break;
        }
      }
    }
  }, [subtitles]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    const handleTimeUpdate = () => {
      // Find the active subtitle for the current time
      if (!videoElement) return;

      const currentTime = videoElement.currentTime;
      let activeText = "";

      // Find the subtitle that should be shown at the current time
      if (subtitles && subtitles.length > 0) {
        // Remove logging to prevent console spam
        for (const segment of subtitles) {
          // Make sure we're using numeric comparison and handle potential null/undefined
          const start =
            typeof segment.start === "number"
              ? segment.start
              : parseFloat(String(segment.start));
          const end =
            typeof segment.end === "number"
              ? segment.end
              : parseFloat(String(segment.end));

          if (currentTime >= start && currentTime <= end) {
            activeText = segment.text;
            break;
          }
        }
      }

      // Update the active subtitle state if it's different
      if (activeText !== activeSubtitle) {
        setActiveSubtitle(activeText);
        // Remove logs about subtitle changes
      }

      // Update other states
      setCurrentTime(currentTime);
      if (videoElement.duration && !isNaN(videoElement.duration)) {
        setDuration(videoElement.duration);
      }
    };

    // Add event listener for time updates
    videoElement.addEventListener("timeupdate", handleTimeUpdate);

    // Cleanup function
    return () => {
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);
    };
    // Only depend on subtitles array, not activeSubtitle to avoid unnecessary re-attaching
  }, [subtitles]);

  // Add a resize observer to adjust subtitle styles based on container size
  useEffect(() => {
    if (!containerRef.current) return;

    const handleResize = () => {
      // The clamp values in the CSS will handle most of the responsive behavior
      // This observer gives us a way to add any additional dynamic adjustments if needed
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        // We can use this width value if we need to make additional adjustments
        // For now, the CSS clamp does the responsive work
        setContainerWidth(width);
      }
    };

    // Initialize resize observer
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Initial call
    handleResize();

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={css`
        position: relative;
        width: 100%;
        margin: 0 auto;
        aspect-ratio: 16/9;
        min-height: 180px;
        background-color: #000;
        border-radius: 6px;
        overflow: hidden;
        transform: translateZ(0); /* Force hardware acceleration */
        will-change: transform; /* Hint for hardware acceleration */
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      `}
    >
      {/* Video element */}
      <video
        ref={videoRef}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
          display: "block",
          zIndex: 1,
          visibility: "visible",
        }}
        // controls removed to hide native interface
        playsInline
        preload="auto"
        autoPlay={false}
        muted={false}
        crossOrigin="anonymous"
        onError={(e) => console.error("Video error event", e)}
      >
        Your browser does not support HTML5 video.
      </video>

      {/* Custom subtitle overlay */}
      {activeSubtitle && (
        <div
          className={css`
            position: absolute;
            bottom: 5px;
            left: 50%;
            transform: translateX(-50%);
            background-color: rgba(0, 0, 0, 0.75);
            color: white;
            border-radius: 4px;
            text-align: center;
            font-weight: 600;
            line-height: 1.4;
            font-family: sans-serif;
            white-space: pre-line;
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.4);
            min-width: 40%;
            text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.9);
            user-select: none;
            opacity: 0.95;
            width: ${isFullyExpanded ? "90%" : isExpanded ? "95%" : "100%"};
            font-size: ${isFullyExpanded
              ? "28px"
              : isExpanded
              ? "22px"
              : "16px"};
            transition: all 0.3s ease;
          `}
        >
          {activeSubtitle}
        </div>
      )}

      {/* Error message if any */}
      {errorMessage && (
        <div
          style={{
            position: "absolute",
            bottom: "10px",
            left: "10px",
            right: "10px",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            color: "white",
            padding: "8px",
            borderRadius: "4px",
            textAlign: "center",
            zIndex: 10,
            fontWeight: "bold",
          }}
        >
          <div style={{ marginBottom: "5px" }}>{errorMessage}</div>
          <div style={{ fontSize: "12px", opacity: 0.8 }}>
            Try a different video format like MP4, WebM, or OGG, or check
            browser compatibility.
          </div>
        </div>
      )}
    </div>
  );
};

export default NativeVideoPlayer;
