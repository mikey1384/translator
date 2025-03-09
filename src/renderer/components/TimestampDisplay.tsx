import React, { useEffect, useState } from "react";
import { css } from "@emotion/css";
import { colors } from "../constants";
import ButtonGroup from "./ButtonGroup";
import StylizedFileInput from "./StylizedFileInput";

interface TimestampDisplayProps {
  videoElement: HTMLVideoElement | null;
  customPlayButton?: React.ReactNode;
  onChangeVideo?: (file: File) => void;
  onChangeSrt?: (file: File) => void;
}

const timestampContainerStyles = css`
  font-family: monospace;
  background-color: ${colors.grayLight};
  color: ${colors.dark};
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 14px;
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  width: 100%;
`;

const timeInfoStyles = css`
  flex: 1;
  text-align: center;
`;

const controlsContainerStyles = css`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const TimestampDisplay: React.FC<TimestampDisplayProps> = ({
  videoElement,
  customPlayButton,
  onChangeVideo,
  onChangeSrt,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!videoElement) return;

    // Set initial values
    setCurrentTime(videoElement.currentTime || 0);
    setDuration(videoElement.duration || 0);
    setIsPlaying(!videoElement.paused);

    // Event handlers
    const handleTimeUpdate = () => {
      setCurrentTime(videoElement.currentTime);
    };

    const handleDurationChange = () => {
      setDuration(videoElement.duration);
    };

    const handlePlayStateChange = () => {
      setIsPlaying(!videoElement.paused);
    };

    // Add event listeners
    videoElement.addEventListener("timeupdate", handleTimeUpdate);
    videoElement.addEventListener("durationchange", handleDurationChange);
    videoElement.addEventListener("play", handlePlayStateChange);
    videoElement.addEventListener("pause", handlePlayStateChange);

    // Clean up
    return () => {
      videoElement.removeEventListener("timeupdate", handleTimeUpdate);
      videoElement.removeEventListener("durationchange", handleDurationChange);
      videoElement.removeEventListener("play", handlePlayStateChange);
      videoElement.removeEventListener("pause", handlePlayStateChange);
    };
  }, [videoElement]);

  // Format time in SRT format (00:00:00,000)
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

  const handleSrtChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0] && onChangeSrt) {
      onChangeSrt(e.target.files[0]);
    }
  };

  return (
    <div className={timestampContainerStyles}>
      <div className={timeInfoStyles}>
        <span>
          <strong>Position:</strong> {formatSrtTime(currentTime)} /{" "}
          <strong>Duration:</strong> {formatSrtTime(duration)}
        </span>
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
            <StylizedFileInput
              accept=".srt"
              onChange={handleSrtChange}
              buttonText="Change SRT"
              showSelectedFile={false}
            />
          )}

          {customPlayButton}
        </ButtonGroup>
      </div>
    </div>
  );
};

export default TimestampDisplay;
