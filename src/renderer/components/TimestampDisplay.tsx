import React, { useEffect, useState } from "react";
import { css } from "@emotion/css";
import { colors } from "../constants";
import ButtonGroup from "./ButtonGroup";
import StylizedFileInput from "./StylizedFileInput";
import Button from "./Button";
import { SrtSegment } from "./EditSubtitles";
import {
  loadSrtFile,
  parseSrt,
  openSubtitleWithElectron,
} from "../helpers/subtitle-utils";
import ElectronFileButton from "./ElectronFileButton";

interface TimestampDisplayProps {
  videoElement: HTMLVideoElement | null;
  customPlayButton?: React.ReactNode;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
  hasSubtitles?: boolean;
  subtitles?: SrtSegment[];
  onScrollToCurrentSubtitle?: () => void;
}

const timestampContainerStyles = css`
  font-family: "system-ui", -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  width: 100%;
`;

const timeInfoStyles = css`
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
  color: #555;
  margin-top: 8px;
  width: 100%;
`;

const controlsContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const progressBarContainerStyles = css`
  width: 100%;
  padding: 8px 0 0;
  position: relative;
`;

const progressBarStyles = css`
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 8px;
  border-radius: 4px;
  background: #e1e1e1;
  outline: none;
  cursor: pointer;
  position: relative;
  z-index: 1;
  margin: 8px 0;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: ${colors.primary};
    cursor: pointer;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    position: relative;
    z-index: 10;
    margin-top: -5px;
    transition: transform 0.1s ease;
  }

  &::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: ${colors.primary};
    cursor: pointer;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    position: relative;
    z-index: 10;
    transition: transform 0.1s ease;
  }

  &::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 4px;
    background: #e1e1e1;
    cursor: pointer;
  }

  &::-moz-range-track {
    height: 8px;
    border-radius: 4px;
    background: #e1e1e1;
    cursor: pointer;
  }

  &:hover::-webkit-slider-thumb {
    background: ${colors.primaryDark || "#0056b3"};
    transform: scale(1.2);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  &:hover::-moz-range-thumb {
    background: ${colors.primaryDark || "#0056b3"};
    transform: scale(1.2);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.4);
  }

  &:active::-webkit-slider-thumb {
    transform: scale(1.3);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }

  &:active::-moz-range-thumb {
    transform: scale(1.3);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
`;

const progressBarBufferedStyles = css`
  position: absolute;
  top: 16px;
  left: 0;
  height: 8px;
  background-color: #ccc;
  border-radius: 4px;
  pointer-events: none;
  z-index: 0;
`;

const modernTimestampStyles = css`
  display: flex;
  gap: 8px;
  align-items: center;
  font-family: monospace;
`;

const timeValueStyles = css`
  font-weight: 500;
  color: #333;
`;

const TimestampDisplay: React.FC<TimestampDisplayProps> = ({
  videoElement,
  customPlayButton,
  onChangeVideo,
  onChangeSrt,
  hasSubtitles = false,
  subtitles,
  onScrollToCurrentSubtitle,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [bufferedWidth, setBufferedWidth] = useState("0%");

  useEffect(() => {
    if (!videoElement) return;

    // Function to update the buffered progress bar
    const updateBufferedWidth = () => {
      if (videoElement.buffered.length > 0) {
        const bufferedEnd = videoElement.buffered.end(
          videoElement.buffered.length - 1
        );
        const bufferedPercent = (bufferedEnd / videoElement.duration) * 100;
        setBufferedWidth(`${bufferedPercent}%`);
      }
    };

    // Set initial values
    setCurrentTime(videoElement.currentTime || 0);
    setDuration(videoElement.duration || 0);
    setIsPlaying(!videoElement.paused);
    updateBufferedWidth();

    // Event handlers
    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
      updateBufferedWidth();
    };

    const handleDurationChange = () => {
      setDuration(videoElement.duration);
    };

    const handlePlayStateChange = () => {
      setIsPlaying(!videoElement.paused);
    };

    const handleProgress = () => {
      updateBufferedWidth();
    };

    // Add event listeners
    videoElement.addEventListener("timeupdate", handleTimeUpdate);
    videoElement.addEventListener("durationchange", handleDurationChange);
    videoElement.addEventListener("play", handlePlayStateChange);
    videoElement.addEventListener("pause", handlePlayStateChange);
    videoElement.addEventListener("progress", handleProgress);

    // Clean up
    return () => {
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);
      videoElement.removeEventListener("durationchange", handleDurationChange);
      videoElement.removeEventListener("play", handlePlayStateChange);
      videoElement.removeEventListener("pause", handlePlayStateChange);
      videoElement.removeEventListener("progress", handleProgress);
    };
  }, [videoElement]);

  // Format time in a concise format (HH:MM:SS)
  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return "00:00:00";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
        2,
        "0"
      )}:${String(secs).padStart(2, "0")}`;
    } else {
      return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(
        2,
        "0"
      )}`;
    }
  };

  // Format time in SRT format (for proper seeking) (00:00:00,000)
  const formatSrtTime = (seconds: number): string => {
    if (isNaN(seconds)) return "00:00:00,000";

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.round((seconds - Math.floor(seconds)) * 1000);

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
      2,
      "0"
    )}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(
      3,
      "0"
    )}`;
  };

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && onChangeVideo) {
      onChangeVideo(e.target.files[0]);
    }
  };

  const handleSrtChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Prevent default browser file input behavior
    e.preventDefault();

    // Use the centralized helper
    await openSubtitleWithElectron(
      (file, content, segments, filePath) => {
        // Success callback - Pass the file to parent component
        if (onChangeSrt) {
          onChangeSrt(file);
        }
      },
      (error) => {
        console.error("TimestampDisplay: Error opening subtitle:", error);
      }
    );
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (videoElement) {
      const seekTime = parseFloat(e.target.value);
      videoElement.currentTime = seekTime;
    }
  };

  return (
    <div className={timestampContainerStyles}>
      {/* Progress bar / time slider */}
      <div className={progressBarContainerStyles}>
        <div
          className={progressBarBufferedStyles}
          style={{ width: bufferedWidth }}
        />
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          step="0.1"
          className={progressBarStyles}
          onChange={handleSeek}
          disabled={!videoElement}
        />
      </div>

      {/* Time display */}
      <div className={timeInfoStyles}>
        <div className={modernTimestampStyles}>
          <span className={timeValueStyles}>{formatTime(currentTime)}</span>
          <span>/</span>
          <span className={timeValueStyles}>{formatTime(duration)}</span>
        </div>
      </div>

      <div className={controlsContainerStyles}>
        <ButtonGroup spacing="sm" mobileStack={false}>
          {onChangeVideo && (
            <StylizedFileInput
              accept="video/*"
              onChange={handleVideoChange}
              buttonText="Change Video"
              showSelectedFile={false}
            />
          )}

          {onChangeSrt && (
            <ElectronFileButton
              buttonText={hasSubtitles ? "Change SRT" : "Add SRT"}
              onClick={async () => {
                await openSubtitleWithElectron(
                  (file) => {
                    if (onChangeSrt) {
                      onChangeSrt(file);
                    }
                  },
                  (error) => {
                    console.error(
                      "TimestampDisplay: Error opening subtitle:",
                      error
                    );
                  }
                );
              }}
            />
          )}

          {hasSubtitles && onScrollToCurrentSubtitle && (
            <Button
              onClick={onScrollToCurrentSubtitle}
              variant="secondary"
              size="sm"
              title="Scroll to the subtitle currently being shown in the video"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginRight: "6px" }}
              >
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <polyline points="19 12 12 19 5 12"></polyline>
              </svg>
              Find Current
            </Button>
          )}

          {customPlayButton}
        </ButtonGroup>
      </div>
    </div>
  );
};

export default TimestampDisplay;
