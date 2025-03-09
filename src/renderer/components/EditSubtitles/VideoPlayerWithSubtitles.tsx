import React, { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";

// Create a comprehensive mock for the history object
// This needs to be done before videojs is initialized
(() => {
  try {
    // Create a more complete array-like history object that videojs expects
    const mockHistory = window.history || {};

    // Create an array to store history entries
    const entries: any[] = [];

    // Define necessary array methods
    const methods = {
      push: (...args: any[]) => {
        console.log("Mock history.push called with:", args);
        return entries.push(...args);
      },
      splice: (...args: any[]) => {
        console.log("Mock history.splice called with:", args);
        // Ensure we have the required parameters for splice
        if (
          args.length >= 2 &&
          typeof args[0] === "number" &&
          typeof args[1] === "number"
        ) {
          return Array.prototype.splice.apply(
            entries,
            args as [number, number, ...any[]]
          );
        }
        return [];
      },
      forEach: (callback: Function) => {
        return entries.forEach((item, index) => callback(item, index, entries));
      },
      map: (callback: Function) => {
        return entries.map((item, index) => callback(item, index, entries));
      },
      filter: (callback: Function) => {
        return entries.filter((item, index) => callback(item, index, entries));
      },
      indexOf: (item: any) => {
        return entries.indexOf(item);
      },
    };

    // Apply all methods to history object
    Object.keys(methods).forEach((method) => {
      if (typeof (mockHistory as any)[method] !== "function") {
        Object.defineProperty(mockHistory, method, {
          configurable: true,
          enumerable: true,
          writable: true,
          value: (methods as any)[method],
        });
      }
    });

    // Set length property
    if (!("length" in mockHistory)) {
      Object.defineProperty(mockHistory, "length", {
        get: () => entries.length,
        configurable: true,
        enumerable: true,
      });
    }

    // Make the history object array-like (accessible by index)
    const handler = {
      get: (target: any, prop: string | symbol) => {
        if (typeof prop === "string" && !isNaN(parseInt(prop))) {
          return entries[parseInt(prop)];
        }
        return target[prop];
      },
      set: (target: any, prop: string | symbol, value: any) => {
        if (typeof prop === "string" && !isNaN(parseInt(prop))) {
          entries[parseInt(prop)] = value;
          return true;
        }
        target[prop] = value;
        return true;
      },
    };

    // Apply the proxy if possible
    if (typeof Proxy !== "undefined") {
      window.history = new Proxy(mockHistory, handler);
    } else {
      // Fallback for older browsers
      window.history = mockHistory as History;
    }

    console.log("Successfully patched history for video.js");
  } catch (e) {
    console.error("Failed to patch history object:", e);
  }
})();

// Define types based on videojs
type VideoJsPlayer = ReturnType<typeof videojs>;
interface VideoJsPlayerOptions {
  controls?: boolean;
  fluid?: boolean;
  responsive?: boolean;
  autoplay?: boolean;
  playbackRates?: number[];
  sources?: { src: string; type: string }[];
  controlBar?: {
    children?: string[];
  };
  html5?: {
    vhs?: {
      overrideNative?: boolean;
    };
    nativeAudioTracks?: boolean;
    nativeVideoTracks?: boolean;
    hls?: {
      overrideNative?: boolean;
    };
  };
  techOrder?: string[];
  preload?: string;
  volume?: number;
}

// Interface for SRT segments
export interface SrtSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

// Global state for video player (simplified from website version)
export const subtitleVideoPlayer = {
  instance: null as VideoJsPlayer | null,
  isReady: false,
  lastAccessed: 0,
};

interface VideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: VideoJsPlayer) => void;
}

const VideoPlayerWithSubtitles: React.FC<VideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<VideoJsPlayer | null>(null);
  const videoUrlRef = useRef<string>(videoUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;
  const [currentVideoType, setCurrentVideoType] = useState<string>("");

  // Update videoUrlRef when videoUrl changes
  useEffect(() => {
    videoUrlRef.current = videoUrl;

    // If player exists and URL changes, update the source
    if (playerRef.current && videoUrl) {
      const videoType = detectVideoType(videoUrl);
      playerRef.current.src({ src: videoUrl, type: videoType });
      setCurrentVideoType(videoType);
    }
  }, [videoUrl]);

  // Initialize player
  useEffect(() => {
    if (!videoRef.current) return;

    // Always ensure we clean up the global instance
    if (subtitleVideoPlayer.instance) {
      try {
        subtitleVideoPlayer.instance.dispose();
      } catch (e) {
        console.error("Error disposing existing global player:", e);
      }
      subtitleVideoPlayer.instance = null;
      subtitleVideoPlayer.isReady = false;
    }

    // Then clean up our local player ref
    if (playerRef.current) {
      try {
        playerRef.current.dispose();
      } catch (e) {
        console.error("Error disposing existing player:", e);
      }
      playerRef.current = null;
    }

    // Clear any error state
    setErrorMessage(null);
    setRetryCount(0);

    // Log to help with debugging
    console.log("Initializing video player with URL:", videoUrl);

    // Detect video type outside
    const detectedVideoType = videoUrl
      ? detectVideoType(videoUrl)
      : "video/mp4";
    console.log("Detected video type:", detectedVideoType);
    setCurrentVideoType(detectedVideoType);

    const options: VideoJsPlayerOptions = {
      controls: true,
      fluid: false,
      responsive: true,
      autoplay: false,
      volume: 1.0, // Maximum volume by default
      playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      sources: videoUrl ? [{ src: videoUrl, type: detectedVideoType }] : [],
      controlBar: {
        children: [
          "playToggle",
          "volumePanel",
          "currentTimeDisplay",
          "timeDivider",
          "durationDisplay",
          "progressControl",
          "playbackRateMenuButton",
          "fullscreenToggle",
        ],
      },
      html5: {
        vhs: {
          overrideNative: false,
        },
        nativeAudioTracks: true,
        nativeVideoTracks: true,
        hls: {
          overrideNative: false,
        },
      },
      // Use 'html5' first, then fall back to other tech if needed
      techOrder: ["html5"],
      preload: "auto",
    };

    let player: VideoJsPlayer;
    try {
      player = videojs(videoRef.current, options);
      playerRef.current = player;

      // Make sure time display is visible
      try {
        // Use type assertion to access controlBar components
        const playerAny = player as any;
        if (playerAny.controlBar) {
          if (playerAny.controlBar.currentTimeDisplay)
            playerAny.controlBar.currentTimeDisplay.show();
          if (playerAny.controlBar.durationDisplay)
            playerAny.controlBar.durationDisplay.show();
          if (playerAny.controlBar.timeDivider)
            playerAny.controlBar.timeDivider.show();
        }
      } catch (e) {
        console.error("Error configuring time display:", e);
      }

      player.ready(() => {
        // Store player in global state
        subtitleVideoPlayer.instance = player;
        subtitleVideoPlayer.isReady = true;
        subtitleVideoPlayer.lastAccessed = Date.now();

        console.log("Video player ready with source:", videoUrl);
        console.log("Using video type:", detectedVideoType);

        // Call the onPlayerReady callback
        onPlayerReady(player);

        // Add error handler with more detailed logging
        player.on("error", (e: Event) => {
          const error = player.error();
          console.error("Video playback error:", error);

          // Log additional details about the error
          if (error) {
            console.error(
              `Error code: ${error.code}, message: ${error.message}`
            );
            setErrorMessage(`Video error: ${error.message || "Unknown error"}`);

            // Try to recover from error by checking if the format might be the issue
            if (error.code === 4) {
              // MEDIA_ERR_SRC_NOT_SUPPORTED
              console.log(
                "Attempting to recover from unsupported media format..."
              );

              // Try with a different video type if we're still under max retries
              if (retryCount < maxRetries) {
                const newRetryCount = retryCount + 1;
                setRetryCount(newRetryCount);

                // Try with a generic video type
                const fallbackType = "video/mp4";
                if (detectedVideoType !== fallbackType && videoUrl) {
                  console.log(`Retrying with video type: ${fallbackType}`);
                  setCurrentVideoType(fallbackType);
                  try {
                    if (player) {
                      player.src({ src: videoUrl, type: fallbackType });
                      player.load();
                      // Use optional chaining for safety
                      player
                        .play?.()
                        ?.catch?.((e) =>
                          console.error("Error playing after recovery:", e)
                        );
                    }
                  } catch (error) {
                    console.error("Error during recovery playback:", error);
                  }
                }
              }
            }
          }
        });
      });

      // Handle source changes
      player.on("sourceset", () => {
        if (subtitles && subtitles.length > 0) {
          updateSubtitles(player, subtitles);
        }
      });
    } catch (err) {
      console.error("Error initializing video.js player:", err);
      subtitleVideoPlayer.isReady = false;
    }

    return () => {
      if (playerRef.current) {
        try {
          // Don't clear the global reference here, just dispose the player
          // We'll keep the global reference for when the component remounts
          playerRef.current.dispose();
        } catch (e) {
          console.error("Error disposing video player:", e);
        }
        playerRef.current = null;
      }
    };
  }, [videoUrl]); // Only re-run on videoUrl changes

  // Handle subtitle changes
  useEffect(() => {
    let vttUrl: string | null = null;
    if (playerRef.current && subtitles && subtitles.length > 0) {
      vttUrl = updateSubtitles(playerRef.current, subtitles);
    }

    // Clean up the URL when component unmounts or subtitles changes
    return () => {
      if (vttUrl) {
        try {
          URL.revokeObjectURL(vttUrl);
        } catch (e) {
          console.error("Error revoking URL:", e);
        }
      }
    };
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
      }}
    >
      <div
        data-vjs-player
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          overflow: "hidden",
          backgroundColor: "#000",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <video
          ref={videoRef}
          className="video-js vjs-default-skin vjs-big-play-centered"
          playsInline
          preload="auto"
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            top: 0,
            left: 0,
            objectFit: "contain",
            backgroundColor: "#000",
            display: "block",
            zIndex: 1,
          }}
          controls
          webkit-playsinline="true"
          x-webkit-airplay="allow"
          data-setup='{"techOrder": ["html5"], "nativeControlsForTouch": false}'
        />
      </div>

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

// Helper function to detect video type based on URL
function detectVideoType(url: string): string {
  if (!url) return "video/mp4";

  // For blob URLs, use a more specific detection based on the original file
  if (url.startsWith("blob:")) {
    // In Electron, blob URLs need special handling
    return "video/mp4"; // Default to MP4 for maximum compatibility
  }

  // For non-blob URLs, try to extract the file extension
  const extension = url.split(".").pop()?.toLowerCase();

  if (!extension) return "video/mp4";

  switch (extension) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    case "avi":
      return "video/x-msvideo";
    case "flv":
      return "video/x-flv";
    case "m3u8":
      return "application/x-mpegURL";
    case "ts":
      return "video/MP2T";
    case "mp3":
      return "audio/mp3";
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    case "mkv":
      return "video/x-matroska";
    default:
      // If we can't determine the type, try MP4 as a safe default
      return "video/mp4";
  }
}

// Format time for VTT (WebVTT uses periods instead of commas)
function formatTimeForVtt(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

// Generate VTT content directly from subtitle segments
function generateVttFromSegments(segments: SrtSegment[]): string {
  if (!segments || segments.length === 0) {
    return "WEBVTT\n\n";
  }

  // Sort segments by start time
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
}

function updateSubtitles(
  player: VideoJsPlayer,
  subtitleSegments: SrtSegment[]
) {
  let vttUrl: string | null = null;

  try {
    // Use type assertion to access remoteTextTracks
    const tracks = (player as any).remoteTextTracks();
    for (let i = tracks.length - 1; i >= 0; i--) {
      player.removeRemoteTextTrack(tracks[i]);
    }

    // Generate VTT directly from subtitle segments
    const vttContent = generateVttFromSegments(subtitleSegments);

    const vttBlob = new Blob([vttContent], { type: "text/vtt" });
    vttUrl = URL.createObjectURL(vttBlob);

    // Add the track with showing mode
    const newTrack = player.addRemoteTextTrack(
      {
        kind: "subtitles",
        label: "Subtitles",
        srclang: "en",
        src: vttUrl,
        default: true,
        mode: "showing",
      },
      false
    );

    // Force the track to be shown
    if (newTrack) {
      // Use type assertion since TypeScript doesn't know about track property
      (newTrack as any).track.mode = "showing";
    }

    // Return the URL for cleanup later
    return vttUrl;
  } catch (err) {
    console.error("Error updating subtitles:", err);
    return vttUrl;
  }
}

export default VideoPlayerWithSubtitles;
