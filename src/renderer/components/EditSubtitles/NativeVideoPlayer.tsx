import React, { useEffect, useRef, useState } from "react";
import { SrtSegment } from "./VideoPlayerWithSubtitles";

// Subtitle utilities
const formatTimeForVtt = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};

// Generate WebVTT content from SRT segments
const generateVttFromSegments = (segments: SrtSegment[]): string => {
  if (!segments || segments.length === 0) {
    return "WEBVTT\n\n";
  }

  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);
  const lines = ["WEBVTT", ""];

  sortedSegments.forEach((segment) => {
    const startTime = formatTimeForVtt(segment.start);
    const endTime = formatTimeForVtt(segment.end);
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(segment.text);
    lines.push("");
  });

  return lines.join("\n");
};

// Global state for player access from other components
export const nativePlayer = {
  instance: null as HTMLVideoElement | null,
  isReady: false,
  lastAccessed: 0,
  // Flag to prevent re-initialization
  isInitialized: false,

  // Helper methods for controlling the player
  play: async () => {
    if (!nativePlayer.instance) {
      console.error("Play called but no player instance available");
      return Promise.reject("No player instance");
    }
    console.log("Playing video...");
    try {
      return nativePlayer.instance.play();
    } catch (error) {
      console.error("Error during play:", error);
      return Promise.reject(error);
    }
  },

  pause: () => {
    if (!nativePlayer.instance) {
      console.error("Pause called but no player instance available");
      return;
    }
    console.log("Pausing video...");
    try {
      nativePlayer.instance.pause();
    } catch (error) {
      console.error("Error during pause:", error);
    }
  },

  seek: (time: number) => {
    if (!nativePlayer.instance) {
      console.error("Seek called but no player instance available");
      return;
    }

    // Ensure time is valid
    const validTime =
      typeof time === "number" && !isNaN(time) && time >= 0 ? time : 0;

    console.log(`Seeking to ${validTime}s`);
    try {
      // Set the currentTime property
      nativePlayer.instance.currentTime = validTime;

      // Double check if it worked
      setTimeout(() => {
        if (nativePlayer.instance) {
          const actualTime = nativePlayer.instance.currentTime;
          console.log(`After seek, actual time is: ${actualTime}s`);

          // If the seek didn't work as expected, try again
          if (Math.abs(actualTime - validTime) > 0.5) {
            console.log("Seek may not have completed correctly, trying again");
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
      console.error("getCurrentTime called but no player instance available");
      return 0;
    }
    return nativePlayer.instance.currentTime;
  },

  isPlaying: () => {
    if (!nativePlayer.instance) {
      console.error("isPlaying called but no player instance available");
      return false;
    }
    return !nativePlayer.instance.paused;
  },
};

interface NativeVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: HTMLVideoElement) => void;
}

const NativeVideoPlayer: React.FC<NativeVideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [subtitleUrl, setSubtitleUrl] = useState<string | null>(null);

  // Handle video initialization
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;

    // Only initialize if not already initialized with the same URL
    if (nativePlayer.isInitialized && nativePlayer.instance === videoElement) {
      console.log("Video player already initialized, skipping initialization");
      return;
    }

    console.log("Initializing native video player with URL:", videoUrl);

    // Load video with more diagnostics
    // In Electron, let's try to explicitly set the src attribute rather than property
    if (videoUrl) {
      console.log(`Setting video source to: ${videoUrl}`);

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

      const canPlay = videoElement.canPlayType(videoType);
      console.log(`Browser support for ${videoType}: "${canPlay}"`);

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
      console.log("Video metadata loaded:", {
        videoWidth: videoElement.videoWidth,
        videoHeight: videoElement.videoHeight,
        duration: videoElement.duration,
        readyState: videoElement.readyState,
      });
    };

    const handleCanPlay = () => {
      console.log("Video can play event fired");
      onPlayerReady(videoElement);
    };

    const handlePlay = () => {
      console.log(
        "Video play event fired, currentTime:",
        videoElement.currentTime
      );
    };

    const handlePause = () => {
      console.log(
        "Video pause event fired, currentTime:",
        videoElement.currentTime
      );
    };

    const handleSeeking = () => {
      console.log(
        "Video seeking event fired, target time:",
        videoElement.currentTime
      );
    };

    const handleSeeked = () => {
      console.log(
        "Video seeked event completed, now at time:",
        videoElement.currentTime
      );
    };

    const handleTimeUpdate = () => {
      // Don't log every time update as it would be too verbose
      // But we can use this if needed
    };

    // Add event listeners
    videoElement.addEventListener("error", handleError as EventListener);
    videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
    videoElement.addEventListener("canplay", handleCanPlay);
    videoElement.addEventListener("play", handlePlay);
    videoElement.addEventListener("pause", handlePause);
    videoElement.addEventListener("seeking", handleSeeking);
    videoElement.addEventListener("seeked", handleSeeked);
    videoElement.addEventListener("timeupdate", handleTimeUpdate);

    // Clean up event listeners
    return () => {
      videoElement.removeEventListener("error", handleError as EventListener);
      videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
      videoElement.removeEventListener("canplay", handleCanPlay);
      videoElement.removeEventListener("play", handlePlay);
      videoElement.removeEventListener("pause", handlePause);
      videoElement.removeEventListener("seeking", handleSeeking);
      videoElement.removeEventListener("seeked", handleSeeked);
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);

      // Clean up global reference
      if (nativePlayer.instance === videoElement) {
        nativePlayer.instance = null;
        nativePlayer.isReady = false;
      }

      // Clean up subtitle URL
      if (subtitleUrl) {
        URL.revokeObjectURL(subtitleUrl);
      }
    };
  }, [videoUrl, onPlayerReady, subtitleUrl]);

  // Handle subtitle changes
  useEffect(() => {
    if (!videoRef.current || !trackRef.current) return;

    // Clean up previous subtitle URL
    if (subtitleUrl) {
      URL.revokeObjectURL(subtitleUrl);
      setSubtitleUrl(null);
    }

    if (subtitles && subtitles.length > 0) {
      try {
        // Generate VTT content
        const vttContent = generateVttFromSegments(subtitles);

        // Create blob and URL
        const vttBlob = new Blob([vttContent], { type: "text/vtt" });
        const url = URL.createObjectURL(vttBlob);

        // Set the URL and make sure track is showing
        trackRef.current.src = url;
        trackRef.current.track.mode = "showing";
        setSubtitleUrl(url);

        console.log("Subtitles updated with", subtitles.length, "segments");
      } catch (error) {
        console.error("Error updating subtitles:", error);
      }
    }
  }, [subtitles]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        margin: "0 auto",
        aspectRatio: "16/9",
        minHeight: "180px",
        backgroundColor: "#000",
        position: "relative",
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
        borderRadius: "6px",
        overflow: "hidden",
        transform: "translateZ(0)", // Force hardware acceleration
        willChange: "transform", // Hint for hardware acceleration
      }}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
          display: "block",
          zIndex: 1,
          visibility: "visible",
        }}
        controls
        playsInline
        preload="auto"
        autoPlay={false}
        muted={false}
        crossOrigin="anonymous"
        onSeeking={() => console.log("Video seeking event")}
        onSeeked={() => console.log("Video seeked event")}
        onLoadedMetadata={() => console.log("Video metadata loaded")}
        onCanPlay={() => console.log("Video can play event")}
        onPlay={() => console.log("Video play event")}
        onPause={() => console.log("Video pause event")}
        onWaiting={() => console.log("Video waiting event")}
        onError={(e) => console.error("Video error event", e)}
      >
        <track
          ref={trackRef}
          kind="subtitles"
          label="Subtitles"
          srcLang="en"
          default
        />
        Your browser does not support HTML5 video.
      </video>

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

      {!videoUrl && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "white",
            textAlign: "center",
            padding: "20px",
          }}
        >
          Please select a video file to load
        </div>
      )}
    </div>
  );
};

export default NativeVideoPlayer;
