import React, { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import "video.js/dist/video-js.css";
import { subtitleVideoPlayer } from "~/constants/state";
import { SrtSegment } from "~/types";

// WebVTT interface declaration
declare global {
  interface Window {
    WebVTT: any;
  }
}

// Define types based on videojs
type VideoJsPlayer = ReturnType<typeof videojs>;
interface VideoJsPlayerOptions {
  controls?: boolean;
  fluid?: boolean;
  responsive?: boolean;
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
}

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
  const [isVideoLoaded, setIsVideoLoaded] = useState<boolean>(false);

  // Update videoUrlRef when videoUrl changes
  useEffect(() => {
    videoUrlRef.current = videoUrl;

    if (playerRef.current && videoUrl) {
      const videoType = detectVideoType(videoUrl);
      playerRef.current.src({ src: videoUrl, type: videoType });
      setCurrentVideoType(videoType);
    }
  }, [videoUrl]);

  // Initialize player
  useEffect(() => {
    if (!videoRef.current) return;

    // Clean up global instance
    if (subtitleVideoPlayer.instance) {
      try {
        subtitleVideoPlayer.instance.dispose();
      } catch (e) {
        // Error handling preserved
      }
      subtitleVideoPlayer.instance = null;
      subtitleVideoPlayer.isReady = false;
    }

    // Clean up local player ref
    if (playerRef.current) {
      try {
        playerRef.current.dispose();
      } catch (e) {
        // Error handling preserved
      }
      playerRef.current = null;
    }

    setErrorMessage(null);
    setRetryCount(0);

    if (!videoUrl) {
      setIsVideoLoaded(false);
      setCurrentVideoType("");
      setErrorMessage("No video selected. Please select a video file.");
      return;
    }

    setIsVideoLoaded(true);

    let videoType = detectVideoType(videoUrl);
    if (videoUrl?.startsWith("blob:")) {
      videoType = "video/mp4";
    }

    setCurrentVideoType(videoType);

    const options: VideoJsPlayerOptions = {
      controls: true,
      fluid: false,
      responsive: true,
      playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      sources: videoUrl ? [{ src: videoUrl, type: videoType }] : [],
      poster: videoUrl
        ? ""
        : "data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 width%3D%22640%22 height%3D%22360%22 viewBox%3D%220 0 640 360%22%3E%3Ctext x%3D%22320%22 y%3D%22180%22 fill%3D%22%23888%22 font-family%3D%22sans-serif%22 font-size%3D%2224px%22 text-anchor%3D%22middle%22%3ENo video selected%3C%2Ftext%3E%3C%2Fsvg%3E",
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
        vhs: { overrideNative: false },
        nativeAudioTracks: true,
        nativeVideoTracks: true,
        hls: { overrideNative: false },
      },
      techOrder: ["html5"],
      preload: "auto",
    };

    let player: VideoJsPlayer;
    try {
      player = videojs(videoRef.current, options);
      playerRef.current = player;

      // Ensure time display is visible
      try {
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
        // Error handling preserved
      }

      player.ready(() => {
        subtitleVideoPlayer.instance = player;
        subtitleVideoPlayer.isReady = true;
        subtitleVideoPlayer.lastAccessed = Date.now();

        if (videoUrl) {
          if (videoUrl.startsWith("blob:")) {
            try {
              const videoElement = player.tech().el() as HTMLVideoElement;
              if (videoElement) {
                videoElement.src = videoUrl;
              }
            } catch (err) {
              player.src({ src: videoUrl, type: currentVideoType });
            }
          } else {
            player.src({ src: videoUrl, type: currentVideoType });
          }
        }

        onPlayerReady(player);
      });

      player.on("sourceset", () => {
        if (subtitles && subtitles.length > 0) {
          updateSubtitles(player, subtitles);
        }
      });

      player.on("error", (e: any) => {
        const error = player.error();
        if (error) {
          let message = "An error occurred while playing the video.";

          switch (error.code) {
            case 1:
              message = "The video playback was aborted.";
              break;
            case 2:
              message =
                "A network error occurred. Please check your connection and try again.";
              break;
            case 3:
              message =
                "The video could not be decoded. This might be due to a corrupted file.";
              break;
            case 4:
              message = `The video format (${currentVideoType}) is not supported by your browser. Trying alternative formats...`;

              if (retryCount < maxRetries && videoUrl) {
                setRetryCount((prev) => prev + 1);
                const formats = [
                  "video/mp4",
                  "video/webm",
                  "video/ogg",
                  "video/quicktime",
                ];
                const nextFormat = formats[retryCount % formats.length];

                setTimeout(() => {
                  if (playerRef.current && videoUrl) {
                    try {
                      if (videoUrl.startsWith("blob:") && retryCount === 1) {
                        const videoElement = playerRef.current
                          .tech()
                          .el() as HTMLVideoElement;
                        if (videoElement) {
                          videoElement.src = videoUrl;
                          return;
                        }
                      }
                    } catch (err) {
                      // Error handling preserved
                    }
                    playerRef.current.src({ src: videoUrl, type: nextFormat });
                    setCurrentVideoType(nextFormat);
                  }
                }, 1000);
                return;
              } else {
                message = `The video format could not be played after multiple attempts. Please try converting the video to a different format.`;
              }
              break;
            default:
              message = `Video playback error (${error.code}): ${error.message}`;
          }

          setErrorMessage(message);
          subtitleVideoPlayer.isReady = false;
        }
      });
    } catch (err) {
      subtitleVideoPlayer.isReady = false;
    }

    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.dispose();
        } catch (e) {
          // Error handling preserved
        }
        playerRef.current = null;
      }
    };
  }, [videoUrl]);

  // Handle video source updates
  useEffect(() => {
    if (playerRef.current && videoUrl !== videoUrlRef.current) {
      try {
        setErrorMessage(null);
        setRetryCount(0);

        if (playerRef.current && !playerRef.current.paused()) {
          try {
            playerRef.current.pause();
          } catch (err) {
            // Error handling preserved
          }
        }

        try {
          if (playerRef.current) {
            playerRef.current.error(null as any);
          }
        } catch (err) {
          // Error handling preserved
        }

        setTimeout(() => {
          if (playerRef.current) {
            const videoType = detectVideoType(videoUrl);
            setCurrentVideoType(videoType);
            playerRef.current.src({ src: videoUrl, type: videoType });
            playerRef.current.load();
            videoUrlRef.current = videoUrl;
          }
        }, 100);
      } catch (e) {
        setErrorMessage("Error loading video. Please try again.");
      }
    } else if (playerRef.current && !videoUrl) {
      try {
        if (playerRef.current) {
          playerRef.current.pause();
          playerRef.current.src([]);
        }
        setErrorMessage("No video selected.");
      } catch (e) {
        // Error handling preserved
      }
    }
  }, [videoUrl]);

  // Handle subtitle changes
  useEffect(() => {
    let vttUrl: string | null = null;
    if (playerRef.current && subtitles && subtitles.length > 0) {
      vttUrl = updateSubtitles(playerRef.current, subtitles);
    }

    return () => {
      if (vttUrl) {
        try {
          URL.revokeObjectURL(vttUrl);
        } catch (e) {
          // Error handling preserved
        }
      }
    };
  }, [subtitles]);

  // Comprehensive cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          if (!playerRef.current.paused()) {
            try {
              playerRef.current.pause();
            } catch (err) {
              // Error handling preserved
            }
          }
          playerRef.current.dispose();
        } catch (e) {
          // Error handling preserved
        }
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "40%",
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
      {!videoUrl ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#222",
            color: "#888",
            fontSize: "16px",
            fontFamily: "sans-serif",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: "10px" }}>No video selected</div>
            <div style={{ fontSize: "13px" }}>
              Please select a video file to begin
            </div>
          </div>
        </div>
      ) : (
        <div
          data-vjs-player
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden",
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
            }}
          />
        </div>
      )}

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
            fontSize: "14px",
            textAlign: "center",
            zIndex: 10,
          }}
        >
          {errorMessage}
          {retryCount > 0 && retryCount <= maxRetries && (
            <div style={{ marginTop: "5px", fontSize: "12px" }}>
              Retrying with alternative format... ({retryCount}/{maxRetries})
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Helper function to detect video type based on URL
function detectVideoType(url: string): string {
  if (!url) return "video/mp4";

  const defaultType = "video/mp4";

  if (url.includes("#type=")) {
    try {
      const typeMatch = url.match(/#type=([^&]+)/);
      if (typeMatch && typeMatch[1]) {
        const mimeType = decodeURIComponent(typeMatch[1]);
        return mimeType || defaultType;
      }
    } catch (e) {
      // Error handling preserved
    }
  }

  if (url.startsWith("blob:")) {
    const extMatch = url.match(/#.*?ext=([^&]+)/);
    if (extMatch && extMatch[1]) {
      const ext = decodeURIComponent(extMatch[1]).toLowerCase();
      switch (ext) {
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
        default:
          return `video/${ext}`;
      }
    }
    return defaultType;
  }

  const extension = url.split(".").pop()?.toLowerCase();
  if (!extension) return defaultType;

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
    default:
      return `video/${extension}`;
  }
}

// Format time for VTT
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

// Parse VTT time string to seconds
function parseVttTime(timeString: string): number {
  try {
    const normalizedTimeStr = timeString.replace(",", ".");
    const parts = normalizedTimeStr.split(":");

    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10);
      const minutes = parseInt(parts[1], 10);
      const secondParts = parts[2].split(".");
      const seconds = parseInt(secondParts[0], 10);
      const milliseconds =
        secondParts.length > 1
          ? parseInt(secondParts[1].padEnd(3, "0").substring(0, 3), 10)
          : 0;
      return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    } else if (parts.length === 2) {
      const minutes = parseInt(parts[0], 10);
      const secondParts = parts[1].split(".");
      const seconds = parseInt(secondParts[0], 10);
      const milliseconds =
        secondParts.length > 1
          ? parseInt(secondParts[1].padEnd(3, "0").substring(0, 3), 10)
          : 0;
      return minutes * 60 + seconds + milliseconds / 1000;
    }
    return 0;
  } catch (e) {
    return 0;
  }
}

// Generate VTT content from subtitle segments
function generateVttFromSegments(segments: SrtSegment[]): string {
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
}

// Update subtitles
function updateSubtitles(
  player: VideoJsPlayer,
  subtitleSegments: SrtSegment[]
) {
  let vttUrl: string | null = null;

  try {
    const tracks = (player as any).remoteTextTracks();
    for (let i = tracks.length - 1; i >= 0; i--) {
      player.removeRemoteTextTrack(tracks[i]);
    }

    const vttContent = generateVttFromSegments(subtitleSegments);
    const vttBlob = new Blob([vttContent], { type: "text/vtt" });
    vttUrl = URL.createObjectURL(vttBlob);

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

    if (newTrack) {
      (newTrack as any).track.mode = "showing";

      try {
        const videoElement = player.tech().el() as HTMLVideoElement;
        if (videoElement && videoElement.textTracks.length === 0) {
          const track = videoElement.addTextTrack(
            "subtitles",
            "Subtitles",
            "en"
          );
          const lines = vttContent.split("\n");
          let i = 0;

          while (i < lines.length && !lines[i].includes("-->")) i++;

          while (i < lines.length) {
            if (lines[i].includes("-->")) {
              const timeParts = lines[i].split("-->");
              if (timeParts.length === 2) {
                const startTime = parseVttTime(timeParts[0].trim());
                const endTime = parseVttTime(timeParts[1].trim());
                let text = "";
                i++;
                while (i < lines.length && lines[i].trim() !== "") {
                  text += lines[i] + "\n";
                  i++;
                }
                if (text.trim() && !isNaN(startTime) && !isNaN(endTime)) {
                  try {
                    const cue = new VTTCue(startTime, endTime, text.trim());
                    track.addCue(cue);
                  } catch (e) {
                    // Error handling preserved
                  }
                }
              }
            } else {
              i++;
            }
          }
          track.mode = "showing";
        }
      } catch (err) {
        // Error handling preserved
      }
    }

    const currentTime = player.currentTime();
    player.currentTime(currentTime);

    return vttUrl;
  } catch (err) {
    return vttUrl;
  }
}

export default VideoPlayerWithSubtitles;
