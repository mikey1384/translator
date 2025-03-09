import React, { useState, useEffect, useRef } from "react";
import { css } from "@emotion/css";
import NativeVideoPlayer from "./EditSubtitles/NativeVideoPlayer";
import { SrtSegment } from "../App";

interface StickyVideoPlayerProps {
  videoUrl: string;
  subtitles: SrtSegment[];
  onPlayerReady: (player: any) => void;
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

const StickyVideoPlayer: React.FC<StickyVideoPlayerProps> = ({
  videoUrl,
  subtitles,
  onPlayerReady,
}) => {
  const [isSticky, setIsSticky] = useState(false);
  const [placeholderHeight, setPlaceholderHeight] = useState(0);
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

  if (!videoUrl) return null;

  const handlePlayerReadyWrapper = (player: any) => {
    onPlayerReady(player);
  };

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

        <div
          className={css`
            margin-top: 10px;
            font-size: 14px;
            font-family: monospace;
            background-color: rgba(248, 249, 250, 0.9);
            padding: 6px 10px;
            border-radius: 4px;
            border: 1px solid rgba(222, 226, 230, 0.7);
            display: inline-block;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          `}
        >
          Current time: <span id="current-timestamp">00:00:00,000</span>
        </div>
      </div>
    </div>
  );
};

export default StickyVideoPlayer;
