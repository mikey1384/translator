import React, { useEffect, useRef, useState } from 'react';
import videojs from 'video.js';
import 'video.js/dist/video-js.css';
import { subtitleVideoPlayer } from '~/constants/state';
import { SrtSegment } from '~/types';

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
  onPlayerReady
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<VideoJsPlayer | null>(null);
  const videoUrlRef = useRef<string>(videoUrl);
  const containerRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 2;
  const [currentVideoType, setCurrentVideoType] = useState<string>('');

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
        console.error('Error disposing existing global player:', e);
      }
      subtitleVideoPlayer.instance = null;
      subtitleVideoPlayer.isReady = false;
    }

    // Then clean up our local player ref
    if (playerRef.current) {
      try {
        playerRef.current.dispose();
      } catch (e) {
        console.error('Error disposing existing player:', e);
      }
      playerRef.current = null;
    }

    // Clear any error state
    setErrorMessage(null);
    setRetryCount(0);

    const videoType = detectVideoType(videoUrl);
    setCurrentVideoType(videoType);

    const options: VideoJsPlayerOptions = {
      controls: true,
      fluid: false,
      responsive: true,
      playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2],
      sources: videoUrl ? [{ src: videoUrl, type: videoType }] : [],
      controlBar: {
        children: [
          'playToggle',
          'volumePanel',
          'currentTimeDisplay',
          'timeDivider',
          'durationDisplay',
          'progressControl',
          'playbackRateMenuButton',
          'fullscreenToggle'
        ]
      },
      html5: {
        vhs: {
          overrideNative: true
        },
        nativeAudioTracks: false,
        nativeVideoTracks: false,
        hls: {
          overrideNative: true
        }
      },
      techOrder: ['html5'],
      preload: 'auto'
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
        console.error('Error configuring time display:', e);
      }

      player.ready(() => {
        // Store player in global state
        subtitleVideoPlayer.instance = player;
        subtitleVideoPlayer.isReady = true;
        subtitleVideoPlayer.lastAccessed = Date.now();

        // Force reload the source to ensure proper loading
        if (videoUrl) {
          player.src({ src: videoUrl, type: currentVideoType });
        }

        // Then notify parent component
        onPlayerReady(player);
      });

      // Handle source changes
      player.on('sourceset', () => {
        if (subtitles && subtitles.length > 0) {
          updateSubtitles(player, subtitles);
        }
      });

      // Handle errors
      player.on('error', (_e: any) => {
        const error = player.error();
        console.error('Video.js error:', error);

        // Set user-friendly error message based on error code
        if (error) {
          let message = 'An error occurred while playing the video.';

          switch (error.code) {
            case 1: // MEDIA_ERR_ABORTED
              message = 'The video playback was aborted.';
              break;
            case 2: // MEDIA_ERR_NETWORK
              message =
                'A network error occurred. Please check your connection and try again.';
              break;
            case 3: // MEDIA_ERR_DECODE
              message =
                'The video could not be decoded. This might be due to a corrupted file.';
              break;
            case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
              message =
                `The video format (${currentVideoType}) is not supported by your browser. ` +
                'Trying alternative formats...';

              // Try to recover with alternative formats if we haven't exceeded max retries
              if (retryCount < maxRetries && videoUrl) {
                setRetryCount((prev) => prev + 1);

                // Try different formats based on retry count
                const formats = ['video/mp4', 'video/webm', 'video/ogg'];
                const nextFormat = formats[retryCount % formats.length];

                setTimeout(() => {
                  if (playerRef.current && videoUrl) {
                    playerRef.current.src({ src: videoUrl, type: nextFormat });
                    setCurrentVideoType(nextFormat);
                  }
                }, 1000);
                return; // Early return as we're retrying
              } else {
                message = `The video format could not be played after multiple attempts. Please try converting the video to a different format.`;
              }
              break;
            default:
              message = `Video playback error (${error.code}): ${error.message}`;
          }

          setErrorMessage(message);

          // Mark global state as not ready
          subtitleVideoPlayer.isReady = false;
        }
      });
    } catch (err) {
      console.error('Error initializing video.js player:', err);
      subtitleVideoPlayer.isReady = false;
    }

    return () => {
      if (playerRef.current) {
        try {
          // Don't clear the global reference here, just dispose the player
          // We'll keep the global reference for when the component remounts
          playerRef.current.dispose();
        } catch (e) {
          console.error('Error disposing video player:', e);
        }
        playerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]); // Only re-run on videoUrl changes

  // Handle video source updates
  useEffect(() => {
    if (playerRef.current && videoUrl !== videoUrlRef.current) {
      try {
        // Reset error message and retry count when changing source
        setErrorMessage(null);
        setRetryCount(0);

        // Pause the player before changing source
        if (playerRef.current && !playerRef.current.paused()) {
          try {
            playerRef.current.pause();
          } catch (err) {
            console.error('Error pausing player:', err);
          }
        }

        // Clear any previous errors
        try {
          if (playerRef.current) {
            playerRef.current.error(null as any);
          }
        } catch (err) {
          console.error('Error clearing player error state:', err);
        }

        // Update the source with a small delay to ensure clean state
        setTimeout(() => {
          if (playerRef.current) {
            // Detect video type based on URL
            const videoType = detectVideoType(videoUrl);
            setCurrentVideoType(videoType);

            playerRef.current.src({
              src: videoUrl,
              type: videoType
            });
            playerRef.current.load();
            videoUrlRef.current = videoUrl;
          }
        }, 100);
      } catch (e) {
        console.error('Error updating video source:', e);
        setErrorMessage('Error loading video. Please try again.');
      }
    } else if (playerRef.current && !videoUrl) {
      // Handle case when videoUrl is null/empty
      try {
        if (playerRef.current) {
          playerRef.current.pause();
          playerRef.current.src([]);
        }
        setErrorMessage('No video selected.');
      } catch (e) {
        console.error('Error clearing video source:', e);
      }
    }
  }, [videoUrl]);

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
          console.error('Error revoking URL:', e);
        }
      }
    };
  }, [subtitles]);

  // Add another effect with more comprehensive cleanup when component unmounts
  useEffect(() => {
    return () => {
      // Clean up the player on unmount
      if (playerRef.current) {
        try {
          // Make sure to pause before disposal to avoid any race conditions
          if (!playerRef.current.paused()) {
            try {
              playerRef.current.pause();
            } catch (err) {
              console.error('Error pausing player during cleanup:', err);
            }
          }

          playerRef.current.dispose();
        } catch (e) {
          console.error('Error disposing video player on unmount:', e);
        }
        // Make sure to set to null after disposal
        playerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '40%',
        margin: '0 auto',
        aspectRatio: '16/9',
        minHeight: '180px',
        backgroundColor: '#000',
        position: 'relative',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        borderRadius: '6px',
        overflow: 'hidden'
      }}
    >
      <div
        data-vjs-player
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden'
        }}
      >
        <video
          ref={videoRef}
          className="video-js vjs-default-skin vjs-big-play-centered"
          playsInline
          preload="auto"
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'contain'
          }}
        />
      </div>

      {errorMessage && (
        <div
          style={{
            position: 'absolute',
            bottom: '10px',
            left: '10px',
            right: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '8px',
            borderRadius: '4px',
            fontSize: '14px',
            textAlign: 'center',
            zIndex: 10
          }}
        >
          {errorMessage}
          {retryCount > 0 && retryCount <= maxRetries && (
            <div style={{ marginTop: '5px', fontSize: '12px' }}>
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
  if (!url) return 'video/mp4';

  // Default MIME type
  const defaultType = 'video/mp4';

  // Check for type hints added via URL hash (format: blob:url#type=video/mp4&ext=mp4)
  if (url.includes('#type=')) {
    try {
      // Extract the MIME type from our custom hint
      const typeMatch = url.match(/#type=([^&]+)/);
      if (typeMatch && typeMatch[1]) {
        const mimeType = decodeURIComponent(typeMatch[1]);
        return mimeType || defaultType;
      }
    } catch (e) {
      console.error('Error extracting type hint from URL:', e);
    }
  }

  // For blob URLs without hints, we'll try to infer from any patterns
  if (url.startsWith('blob:')) {
    // Try to extract extension information from URL
    const extMatch = url.match(/#.*?ext=([^&]+)/);
    if (extMatch && extMatch[1]) {
      const ext = decodeURIComponent(extMatch[1]).toLowerCase();
      switch (ext) {
        case 'mp4':
          return 'video/mp4';
        case 'webm':
          return 'video/webm';
        case 'ogg':
        case 'ogv':
          return 'video/ogg';
        case 'mov':
          return 'video/quicktime';
        case 'avi':
          return 'video/x-msvideo';
        case 'flv':
          return 'video/x-flv';
        case 'm3u8':
          return 'application/x-mpegURL';
        case 'ts':
          return 'video/MP2T';
        case 'mp3':
          return 'audio/mp3';
        case 'wav':
          return 'audio/wav';
        case 'aac':
          return 'audio/aac';
        default:
          return `video/${ext}`;
      }
    }

    return defaultType;
  }

  // For non-blob URLs, try to extract the file extension
  const extension = url.split('.').pop()?.toLowerCase();

  if (!extension) return defaultType;

  switch (extension) {
    case 'mp4':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'ogg':
    case 'ogv':
      return 'video/ogg';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'flv':
      return 'video/x-flv';
    case 'm3u8':
      return 'application/x-mpegURL';
    case 'ts':
      return 'video/MP2T';
    case 'mp3':
      return 'audio/mp3';
    case 'wav':
      return 'audio/wav';
    case 'aac':
      return 'audio/aac';
    default:
      return `video/${extension}`;
  }
}

// Format time for VTT (WebVTT uses periods instead of commas)
function formatTimeForVtt(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0'
  )}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// Generate VTT content directly from subtitle segments
function generateVttFromSegments(segments: SrtSegment[]): string {
  if (!segments || segments.length === 0) {
    return 'WEBVTT\n\n';
  }

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => a.start - b.start);

  const lines = ['WEBVTT', ''];

  sortedSegments.forEach((segment) => {
    const startTime = formatTimeForVtt(segment.start);
    const endTime = formatTimeForVtt(segment.end);
    lines.push(`${startTime} --> ${endTime}`);
    lines.push(segment.text);
    lines.push('');
  });

  return lines.join('\n');
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

    const vttBlob = new Blob([vttContent], { type: 'text/vtt' });
    vttUrl = URL.createObjectURL(vttBlob);

    // Add the track with showing mode
    const newTrack = player.addRemoteTextTrack(
      {
        kind: 'subtitles',
        label: 'Subtitles',
        srclang: 'en',
        src: vttUrl,
        default: true,
        mode: 'showing'
      },
      false
    );

    // Force the track to be shown
    if (newTrack) {
      // Use type assertion since TypeScript doesn't know about track property
      (newTrack as any).track.mode = 'showing';
    }

    // Refresh the player to ensure subtitles are shown
    const currentTime = player.currentTime();
    player.currentTime(currentTime);

    // Return the URL for cleanup later
    return vttUrl;
  } catch (err) {
    console.error('Error updating subtitles:', err);
    return vttUrl;
  }
}

export default VideoPlayerWithSubtitles;
