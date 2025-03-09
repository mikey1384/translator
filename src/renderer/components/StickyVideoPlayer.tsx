import React, { useState, useEffect, useRef } from "react";
import { css } from "@emotion/css";
import NativeVideoPlayer, {
  nativePlayer,
} from "./EditSubtitles/NativeVideoPlayer";
import { SrtSegment } from "../App";
import TimestampDisplay from "./TimestampDisplay";
import Button from "./Button";

interface StickyVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
}

// Use fixed position styling with a scrolling threshold
const fixedVideoContainerStyles = (isSticky: boolean) => css`
  position: ${isSticky ? "fixed" : "relative"};
  top: ${isSticky ? "10px" : "auto"};
  left: ${isSticky ? "50%" : "auto"};
  transform: ${isSticky ? "translateX(-50%)" : "none"};
  width: ${isSticky ? "calc(90% - 30px)" : "100%"};
  z-index: 100;
  background-color: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  padding: 15px;
  border-radius: 8px;
  border: 1px solid rgba(238, 238, 238, 0.9);
  margin-bottom: ${isSticky ? "0" : "20px"};
  display: flex;
  flex-direction: column;
  align-items: center;
  max-height: ${isSticky ? "40vh" : "60vh"};
  overflow: visible;
  transition: all 0.2s ease-out;
  box-shadow: ${isSticky
    ? "0 8px 16px rgba(0, 0, 0, 0.15)"
    : "0 4px 8px rgba(0, 0, 0, 0.1)"};
`;

// Create a placeholder for when the player is fixed to prevent layout jumps
const placeholderStyles = (isSticky: boolean, height: number) => css`
  display: ${isSticky ? "block" : "none"};
  height: ${height}px;
  width: 100%;
  margin-bottom: 20px;
`;

// Button gradient styles for play/pause button
const buttonGradientStyles = {
  base: css`
    position: relative;
    font-weight: 500;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
    color: white !important;

    &:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      color: white !important;
    }

    &:active:not(:disabled) {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      color: white !important;
    }

    &:disabled {
      opacity: 0.65;
      cursor: not-allowed;
      color: rgba(255, 255, 255, 0.9) !important;
    }
  `,
  primary: css`
    background: linear-gradient(
      135deg,
      rgba(0, 123, 255, 0.9),
      rgba(0, 80, 188, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(0, 143, 255, 0.95),
        rgba(0, 103, 204, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(0, 123, 255, 0.6),
        rgba(0, 80, 188, 0.6)
      ) !important;
    }
  `,
  danger: css`
    background: linear-gradient(
      135deg,
      rgba(220, 53, 69, 0.9),
      rgba(170, 30, 45, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(230, 73, 89, 0.95),
        rgba(190, 50, 65, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(220, 53, 69, 0.6),
        rgba(170, 30, 45, 0.6)
      ) !important;
    }
  `,
};

const StickyVideoPlayer: React.FC<StickyVideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
  onChangeVideo,
  onChangeSrt,
}) => {
  const [isSticky, setIsSticky] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollThreshold = 50; // px

  useEffect(() => {
    if (!videoUrl) return;

    // Function to check if element should be sticky
    const checkStickyState = () => {
      if (!playerRef.current || !containerRef.current) return;

      // Get positions
      const rect = playerRef.current.getBoundingClientRect();

      // When the component is first mounted, store its height
      if (!isSticky && rect.height > 0) {
        setPlaceholderHeight(rect.height);
      }

      // Check if should be sticky
      if (window.scrollY > scrollThreshold && !isSticky) {
        setIsSticky(true);
      } else if (window.scrollY <= scrollThreshold && isSticky) {
        setIsSticky(false);
      }
    };

    // Set up the scroll listener - using both approaches for compatibility
    window.addEventListener("scroll", checkStickyState);

    // For Electron's WebKit renderer, we might need a different approach too
    const electronScrollHandler = setInterval(checkStickyState, 100);

    // Initial check
    checkStickyState();

    // Clean up
    return () => {
      window.removeEventListener("scroll", checkStickyState);
      clearInterval(electronScrollHandler);
    };
  }, [videoUrl, isSticky, scrollThreshold]);

  // Update isPlaying state when video plays/pauses
  useEffect(() => {
    if (!nativePlayer.instance) return;

    const videoElement = nativePlayer.instance;
    const updatePlayState = () => setIsPlaying(!videoElement.paused);

    videoElement.addEventListener("play", updatePlayState);
    videoElement.addEventListener("pause", updatePlayState);

    return () => {
      videoElement.removeEventListener("play", updatePlayState);
      videoElement.removeEventListener("pause", updatePlayState);
    };
  }, [nativePlayer.instance]);

  if (!videoUrl) return null;

  const handlePlayerReadyWrapper = (player: any) => {
    onPlayerReady(player);
  };

  const handleTogglePlay = () => {
    try {
      if (isPlaying) {
        console.log("Pausing video");
        nativePlayer.pause();
      } else {
        console.log("Playing video");
        nativePlayer.play();
      }
    } catch (err) {
      console.error("Error toggling play state:", err);
    }
  };

  // Custom play button
  const playButton = (
    <Button
      onClick={handleTogglePlay}
      variant={isPlaying ? "danger" : "primary"}
      size="sm"
      className={`${buttonGradientStyles.base} ${
        isPlaying ? buttonGradientStyles.danger : buttonGradientStyles.primary
      } ${css`
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 70px;
      `}`}
    >
      {isPlaying ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5zm5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5z" />
          </svg>
          Pause
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="m11.596 8.697-6.363 3.692c-.54.313-1.233-.066-1.233-.697V4.308c0-.63.692-1.01 1.233-.696l6.363 3.692a.802.802 0 0 1 0 1.393z" />
          </svg>
          Play
        </>
      )}
    </Button>
  );

  return (
    <div ref={containerRef}>
      {/* Placeholder div to prevent layout jumps when player becomes fixed */}
      <div className={placeholderStyles(isSticky, placeholderHeight)} />

      {/* The actual player */}
      <div className={fixedVideoContainerStyles(isSticky)} ref={playerRef}>
        <NativeVideoPlayer
          videoUrl={videoUrl}
          subtitles={subtitles}
          onPlayerReady={handlePlayerReadyWrapper}
        />

        <TimestampDisplay
          videoElement={nativePlayer.instance}
          customPlayButton={playButton}
          onChangeVideo={onChangeVideo}
          onChangeSrt={onChangeSrt}
        />
      </div>
    </div>
  );
};

export default StickyVideoPlayer;
