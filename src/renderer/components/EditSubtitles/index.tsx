import React, { useEffect, useRef, useCallback, useState } from "react";
import NativeVideoPlayer, { nativePlayer } from "./NativeVideoPlayer";
import { css } from "@emotion/css";
import Button from "../Button";
import SubtitleEditor from "./SubtitleEditor";
import { debounce } from "lodash";
import StylizedFileInput from "../StylizedFileInput";
import Section from "../Section";
import { cx } from "@emotion/css";
import { sectionStyles, sectionTitleStyles } from "../../styles";
import { subtitleVideoPlayer } from "../../constants";

// Define SrtSegment interface
export interface SrtSegment {
  index: number;
  start: number;
  end: number;
  text: string;
  originalText?: string;
}

// Add container styles
const containerStyles = css`
  margin-top: 20px;
`;

// Add gradient styles for buttons
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
  success: css`
    background: linear-gradient(
      135deg,
      rgba(40, 167, 69, 0.9),
      rgba(30, 126, 52, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(50, 187, 79, 0.95),
        rgba(40, 146, 62, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(40, 167, 69, 0.6),
        rgba(30, 126, 52, 0.6)
      ) !important;
    }
  `,
  danger: css`
    background: linear-gradient(
      135deg,
      rgba(220, 53, 69, 0.9),
      rgba(189, 33, 48, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(240, 73, 89, 0.95),
        rgba(209, 53, 68, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(220, 53, 69, 0.6),
        rgba(189, 33, 48, 0.6)
      ) !important;
    }
  `,
  purple: css`
    background: linear-gradient(
      135deg,
      rgba(130, 71, 229, 0.9),
      rgba(91, 31, 193, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(150, 91, 249, 0.95),
        rgba(111, 51, 213, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(130, 71, 229, 0.6),
        rgba(91, 31, 193, 0.6)
      ) !important;
    }
  `,
};

// Replace the previous mergeButtonStyles with the new purple gradient style
const mergeButtonStyles = css`
  ${buttonGradientStyles.base}
  ${buttonGradientStyles.purple}
`;

// Additional styles for the SectionWithButton component
const noMarginStyle = css`
  margin-bottom: 0;
`;

const noPaddingStyle = css`
  padding: 0;
`;

const noShadowStyle = css`
  box-shadow: none;

  &:hover {
    box-shadow: none;
  }
`;

const overflowVisibleStyle = css`
  overflow: visible;
`;

// Create a custom section component with a title and a button
const SectionWithButton = ({
  title,
  buttonComponent,
  children,
  ...rest
}: {
  title: string;
  buttonComponent: React.ReactNode;
  children: React.ReactNode;
  [key: string]: any;
}) => {
  return (
    <section
      className={cx(
        sectionStyles,
        rest.noMargin && noMarginStyle,
        rest.noPadding && noPaddingStyle,
        rest.noShadow && noShadowStyle,
        rest.overflowVisible && overflowVisibleStyle,
        rest.className
      )}
    >
      <div
        className={css`
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 2px solid #dee2e6;
          padding-bottom: 0.75rem;
          margin-bottom: 1.25rem;
        `}
      >
        <h2
          className={css`
            font-size: 1.5rem;
            font-weight: 600;
            color: #212529;
            margin: 0;
          `}
        >
          {title}
        </h2>
        {buttonComponent}
      </div>
      <div className={rest.contentClassName}>{children}</div>
    </section>
  );
};

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  targetLanguage: string;
  showOriginalText: boolean;
  onSetVideoFile: (file: File) => void;
  onSetVideoUrl: (url: string | null) => void;
  onSetError: (error: string) => void;
  isPlaying?: boolean;
  editingTimes?: { start: number; end: number } | null;
  onSetEditingTimes?: (times: { start: number; end: number } | null) => void;
  onSetIsPlaying?: (isPlaying: boolean) => void;
  secondsToSrtTime?: (seconds: number) => string;
  parseSrt?: (srtString: string) => SrtSegment[];
  subtitles?: SrtSegment[];
  onSetSubtitles?: (subtitles: SrtSegment[]) => void;
  videoPlayerRef?: any;
  isMergingInProgress?: boolean;
  onSetIsMergingInProgress?: (isMerging: boolean) => void;
  mergeSubtitlesWithVideo: (
    videoFile: File,
    subtitles: SrtSegment[],
    options: { onProgress: (progress: number) => void }
  ) => Promise<{ outputPath: string; error?: string }>;
  editorRef?: React.RefObject<{
    scrollToCurrentSubtitle: () => void;
  }>;
}

// Utility functions
const srtTimeToSeconds = (timeString: string): number => {
  const parts = timeString.split(":");
  if (parts.length !== 3) return 0;

  const [hours, minutes, secondsPart] = parts;
  const [seconds, milliseconds] = secondsPart.replace(",", ".").split(".");

  return (
    parseInt(hours) * 3600 +
    parseInt(minutes) * 60 +
    parseInt(seconds) +
    (milliseconds ? parseInt(milliseconds) / 1000 : 0)
  );
};

const secondsToSrtTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const parseSrt = (srtString: string): SrtSegment[] => {
  if (!srtString) return [];

  const segments: SrtSegment[] = [];
  const blocks = srtString.trim().split(/\r?\n\r?\n/);

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length < 3) return;

    const index = parseInt(lines[0].trim(), 10);
    const timeMatch = lines[1].match(
      /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
    );

    if (!timeMatch) return;

    const startTime = srtTimeToSeconds(timeMatch[1]);
    const endTime = srtTimeToSeconds(timeMatch[2]);

    // Get all text lines and join them
    const text = lines.slice(2).join("\n");

    segments.push({
      index,
      start: startTime,
      end: endTime,
      text,
    });
  });

  return segments;
};

// Add a function to validate subtitle timings
const validateSubtitleTimings = (subtitles: SrtSegment[]): SrtSegment[] => {
  if (!subtitles || subtitles.length === 0) return [];

  // Fix basic timing issues (negative times, end before start)
  const fixedSubtitles = subtitles.map((subtitle) => {
    // Create a new object to avoid mutating the original
    const fixed = { ...subtitle };

    // Fix negative start time
    if (fixed.start < 0) {
      fixed.start = 0;
    }

    // Fix end time before start time
    if (fixed.end <= fixed.start) {
      // Make the subtitle last at least 0.5 seconds
      fixed.end = fixed.start + 0.5;
    }

    return fixed;
  });

  return fixedSubtitles;
};

export default function EditSubtitles({
  videoFile,
  videoUrl,
  targetLanguage,
  showOriginalText,
  isPlaying: isPlayingProp,
  editingTimes: editingTimesProp,
  onSetVideoFile,
  onSetVideoUrl,
  onSetError,
  onSetEditingTimes,
  onSetIsPlaying,
  secondsToSrtTime: secondsToSrtTimeProp,
  parseSrt: parseSrtProp,
  subtitles: subtitlesProp,
  onSetSubtitles,
  videoPlayerRef,
  isMergingInProgress: isMergingInProgressProp,
  onSetIsMergingInProgress,
  mergeSubtitlesWithVideo,
  editorRef,
}: EditSubtitlesProps) {
  // State for the component - use props if available, otherwise use local state
  const [subtitlesState, setSubtitlesState] = useState<SrtSegment[]>(
    subtitlesProp || []
  );
  const [isPlayingState, setIsPlayingState] = useState(isPlayingProp || false);
  const [editingTimesState, setEditingTimesState] = useState<
    Record<string, string>
  >({});
  const [isMergingInProgressState, setIsMergingInProgressState] = useState(
    isMergingInProgressProp || false
  );
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState("");
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  const [fileKey, setFileKey] = useState<number>(Date.now()); // Add back fileKey for file input resets

  // Refs
  const playTimeoutRef = useRef<number | null>(null);
  const debouncedTimeUpdateRef = useRef<Record<string, any>>({});
  const focusedInputRef = useRef<{
    index: number | null;
    field: "start" | "end" | "text" | null;
  }>({
    index: null,
    field: null,
  });

  // Ref to track the subtitle elements
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Use the provided function or fall back to the local implementation
  const parseSrt =
    parseSrtProp ||
    ((srtString: string): SrtSegment[] => {
      if (!srtString) return [];

      const segments: SrtSegment[] = [];
      const blocks = srtString.trim().split(/\r?\n\r?\n/);

      blocks.forEach((block) => {
        const lines = block.split(/\r?\n/);
        if (lines.length < 3) return;

        const index = parseInt(lines[0].trim(), 10);
        const timeMatch = lines[1].match(
          /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
        );

        if (!timeMatch) return;

        const startTime = srtTimeToSeconds(timeMatch[1]);
        const endTime = srtTimeToSeconds(timeMatch[2]);

        // Get all text lines and join them
        const text = lines.slice(2).join("\n");

        segments.push({
          index,
          start: startTime,
          end: endTime,
          text,
        });
      });

      return segments;
    });

  // Use the provided function or fall back to the local implementation
  const secondsToSrtTime =
    secondsToSrtTimeProp ||
    ((seconds: number): string => {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.round((seconds - Math.floor(seconds)) * 1000);

      return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
        2,
        "0"
      )}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
    });

  // Add a useEffect that only runs once to validate initial subtitles
  useEffect(() => {
    if (subtitlesProp && subtitlesProp.length > 0) {
      // Validate subtitles before setting them
      const validatedSubtitles = validateSubtitleTimings(subtitlesProp);
      setSubtitlesState(validatedSubtitles);
    }
    // Only run this effect once on component mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modify the useEffect that syncs with props to prevent infinite loops
  useEffect(() => {
    if (subtitlesProp) {
      // Instead of validating on every update, just set the subtitles directly
      // to avoid potential infinite loops
      setSubtitlesState(subtitlesProp);
    }
  }, [subtitlesProp]);

  useEffect(() => {
    if (isPlayingProp !== undefined) {
      setIsPlayingState(isPlayingProp);
    }
  }, [isPlayingProp]);

  useEffect(() => {
    if (isMergingInProgressProp !== undefined) {
      setIsMergingInProgressState(isMergingInProgressProp);
    }
  }, [isMergingInProgressProp]);

  // Propagate state changes to parent if callback provided
  useEffect(() => {
    if (onSetSubtitles && subtitlesState) {
      onSetSubtitles(subtitlesState);
    }
  }, [subtitlesState, onSetSubtitles]);

  useEffect(() => {
    if (onSetIsPlaying !== undefined) {
      onSetIsPlaying(isPlayingState);
    }
  }, [isPlayingState, onSetIsPlaying]);

  useEffect(() => {
    if (onSetIsMergingInProgress !== undefined) {
      onSetIsMergingInProgress(isMergingInProgressState);
    }
  }, [isMergingInProgressState, onSetIsMergingInProgress]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (playTimeoutRef.current) {
        window.clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }
    };
  }, []);

  const handleTimeInputBlur = useCallback(
    (index: number, field: "start" | "end") => {
      const editKey = `${index}-${field}`;
      const currentEditValue = editingTimesState[editKey];

      if (currentEditValue) {
        let numValue: number;
        if (
          typeof currentEditValue === "string" &&
          currentEditValue.includes(":")
        ) {
          numValue = srtTimeToSeconds(currentEditValue);
        } else {
          numValue = parseFloat(currentEditValue);
        }

        if (!isNaN(numValue) && numValue >= 0) {
          const currentSub = subtitlesState[index];
          const prevSub = index > 0 ? subtitlesState[index - 1] : null;
          let isValid = true;
          let newEnd = currentSub.end;

          if (field === "start") {
            if (prevSub && numValue < prevSub.start) {
              isValid = false;
            }

            if (numValue >= currentSub.end) {
              const originalDuration = currentSub.end - currentSub.start;
              newEnd = numValue + originalDuration;
            }
          }

          if (isValid) {
            if (field === "start" && numValue >= currentSub.end) {
              setSubtitlesState((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, start: numValue, end: newEnd } : sub
                )
              );
            } else {
              setSubtitlesState((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, [field]: numValue } : sub
                )
              );
            }
          }
        }
      }

      // Clear the editing state
      setEditingTimesState((prev) => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    [subtitlesState, editingTimesState]
  );

  const handleRemoveSubtitle = useCallback(
    (index: number) => {
      if (
        !window.confirm("Are you sure you want to remove this subtitle block?")
      ) {
        return;
      }

      const updatedSubtitles = subtitlesState.filter((_, i) => i !== index);
      setSubtitlesState(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1, // Reindex remaining subtitles
        }))
      );
    },
    [subtitlesState]
  );

  const handleInsertSubtitle = useCallback(
    (index: number) => {
      const currentSub = subtitlesState[index];
      const nextSub =
        index < subtitlesState.length - 1 ? subtitlesState[index + 1] : null;

      // Create a new subtitle at midpoint between current and next
      const newStart = currentSub.end;
      const newEnd = nextSub ? nextSub.start : currentSub.end + 2; // Add 2 seconds if last subtitle

      const newSubtitle = {
        index: index + 2, // +2 because it goes after current (which is index+1)
        start: newStart,
        end: newEnd,
        text: "",
      };

      // Create a copy with the new subtitle inserted
      const updatedSubtitles = [
        ...subtitlesState.slice(0, index + 1),
        newSubtitle,
        ...subtitlesState.slice(index + 1),
      ];

      // Reindex all subtitles
      setSubtitlesState(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1,
        }))
      );
    },
    [subtitlesState]
  );

  const handleSeekToSubtitle = useCallback((startTime: number) => {
    try {
      // First ensure any current subtitle display is properly cleared
      if (nativePlayer.instance) {
        const trackElement = nativePlayer.instance.querySelector("track");
        if (trackElement && trackElement.track) {
          // Store current mode
          const currentMode = trackElement.track.mode;

          // Hide track to clear displayed cues
          trackElement.track.mode = "hidden";

          // Perform seek
          nativePlayer.instance.currentTime = startTime;

          // Restore track mode after a short delay
          setTimeout(() => {
            if (trackElement && trackElement.track) {
              trackElement.track.mode = currentMode;
            }
          }, 50);
        } else {
          // Fallback to direct seek if track not found
          nativePlayer.instance.currentTime = startTime;
        }
      } else {
        // Use the nativePlayer.seek method (which should handle track state)
        nativePlayer.seek(startTime);
      }
    } catch (err) {
      console.error("Error seeking to time:", err);
    }
  }, []);

  function handleSrtFileInputChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear input value to ensure onChange triggers even for the same file
    if (event.target) {
      event.target.value = "";
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const srtContent = e.target?.result as string;
      try {
        // Reset states
        setSubtitlesState([]);
        setEditingTimesState({});

        // Parse and set the new content
        const parsed = parseSrt(srtContent);
        setSubtitlesState(parsed);

        // No longer need to update the fileKey as we removed that dependency
      } catch (error) {
        console.error("Error parsing SRT:", error);
        onSetError("Invalid SRT file");
      }
    };
    reader.onerror = function (e) {
      console.error("FileReader error:", e);
      onSetError("Error reading SRT file");
    };
    reader.readAsText(file);
  }

  function handleSaveEditedSrt() {
    try {
      // Generate SRT content from subtitles
      const srtContent = generateSrtContent(subtitlesState);

      // Create a blob and download it
      const blob = new Blob([srtContent], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "edited_subtitles.srt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error saving SRT file:", error);
      onSetError("Error saving SRT file");
    }
  }

  // Function to generate SRT content from subtitles
  function generateSrtContent(
    segments: Array<{ index: number; start: number; end: number; text: string }>
  ) {
    return segments
      .map((segment, i) => {
        const index = i + 1;
        const startTime = secondsToSrtTime(segment.start);
        const endTime = secondsToSrtTime(segment.end);
        return `${index}\n${startTime} --> ${endTime}\n${segment.text}`;
      })
      .join("\n\n");
  }

  // Function to restore focus to the last active input
  function restoreFocus() {
    const { index, field } = focusedInputRef.current;
    if (index === null || field === null) return;

    // Find the element based on its ID
    const inputId = `subtitle-${index}-${field}`;
    const inputToFocus = document.getElementById(inputId);

    if (inputToFocus instanceof HTMLElement) {
      inputToFocus.focus();

      // If it's an input element, move cursor to end
      if (inputToFocus instanceof HTMLInputElement) {
        const length = inputToFocus.value.length;
        inputToFocus.setSelectionRange(length, length);
      }
    }
  }

  // Player ready handler
  function handlePlayerReady(player: HTMLVideoElement) {
    if (!player) {
      console.warn("Invalid player received in handlePlayerReady");
      return;
    }

    // Add event listeners to the native player
    const handlePlay = () => {
      setIsPlayingState(true);
    };

    const handlePause = () => {
      setIsPlayingState(false);
    };

    const handleEnded = () => {
      setIsPlayingState(false);
    };

    // Add proper cleanup for listeners to avoid memory leaks and ensure reliable state
    player.addEventListener("play", handlePlay);
    player.addEventListener("playing", handlePlay); // additional event for more reliability
    player.addEventListener("pause", handlePause);
    player.addEventListener("ended", handleEnded);

    // Set initial state based on player
    setIsPlayingState(!player.paused);

    // Return cleanup function to remove these listeners when component unmounts or when player changes
    return () => {
      player.removeEventListener("play", handlePlay);
      player.removeEventListener("playing", handlePlay);
      player.removeEventListener("pause", handlePause);
      player.removeEventListener("ended", handleEnded);
    };

    // Handle time updates
    player.addEventListener("timeupdate", () => {
      const timeDisplay = document.getElementById("current-timestamp");
      if (timeDisplay && player) {
        try {
          const currentTime = player.currentTime;
          // Display time in SRT format
          if (currentTime !== undefined && !isNaN(currentTime)) {
            timeDisplay.textContent = secondsToSrtTime(currentTime);
          }
        } catch (err) {
          console.error("Error updating timestamp display:", err);
        }
      }
    });

    // Add error handler
    player.addEventListener("error", () => {
      console.error("Video player error:", player.error);
    });
  }

  function handlePlaySubtitle(startTime: number, endTime: number) {
    // Clear any existing timeout
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    // If we're already playing, pause first
    if (isPlayingState) {
      try {
        nativePlayer.pause();
        setIsPlayingState(false);
        return; // Important: return early to prevent attempting play while pausing
      } catch (err) {
        console.error("Error pausing player:", err);
      }
      return;
    }

    try {
      // Ensure startTime is a valid number before using it
      const validStartTime =
        typeof startTime === "number" && !isNaN(startTime) ? startTime : 0;
      const validEndTime =
        typeof endTime === "number" && !isNaN(endTime)
          ? endTime
          : validStartTime + 3;

      // Get current position directly from the player instance
      let currentPosition = 0;
      try {
        if (nativePlayer.instance) {
          currentPosition = nativePlayer.instance.currentTime;
        } else {
          currentPosition = nativePlayer.getCurrentTime();
        }
      } catch (err) {
        console.error("Error getting current time:", err);
      }

      // If we're already within this subtitle's time range, play from current position
      if (currentPosition >= validStartTime && currentPosition < validEndTime) {
        playFromCurrentPosition(currentPosition, validEndTime);
      } else {
        // Only seek if we're not in the subtitle range

        try {
          // Find the track element to reset it before seeking
          if (nativePlayer.instance) {
            const trackElement = nativePlayer.instance.querySelector("track");
            // Temporarily hide track to clear displayed cues
            if (trackElement && trackElement.track) {
              const currentMode = trackElement.track.mode;
              trackElement.track.mode = "hidden";

              // Perform the seek
              nativePlayer.instance.currentTime = validStartTime;

              // Restore track mode after a short delay
              setTimeout(() => {
                if (trackElement && trackElement.track) {
                  trackElement.track.mode = currentMode;
                }

                let actualPosition = nativePlayer.getCurrentTime();
                playFromCurrentPosition(actualPosition, validEndTime);
              }, 200);
            } else {
              // Fallback if track element not found
              nativePlayer.instance.currentTime = validStartTime;

              setTimeout(() => {
                let actualPosition = nativePlayer.getCurrentTime();
                playFromCurrentPosition(actualPosition, validEndTime);
              }, 200);
            }
          } else {
            // Use the nativePlayer.seek method (which includes track handling)
            nativePlayer.seek(validStartTime);

            setTimeout(() => {
              let actualPosition = nativePlayer.getCurrentTime();
              playFromCurrentPosition(actualPosition, validEndTime);
            }, 200);
          }
        } catch (seekErr) {
          console.error("Error during seek:", seekErr);
          // Fall back to playing from start time even if seek fails
          playFromCurrentPosition(validStartTime, validEndTime);
        }
      }
    } catch (err) {
      console.error("Error during subtitle playback:", err);
      setIsPlayingState(false);
    }
  }

  // Helper function to play from current position
  function playFromCurrentPosition(startTime: number, endTime: number) {
    // Get the actual current time directly from the player element
    let actualCurrentTime = startTime;
    try {
      if (nativePlayer.instance) {
        actualCurrentTime = nativePlayer.instance.currentTime;
      } else {
        actualCurrentTime = nativePlayer.getCurrentTime();
      }
    } catch (err) {
      console.error("Error getting current time before play:", err);
    }

    // Play from that position with proper error handling
    try {
      // Try to play using both direct DOM API and the wrapper function
      const playPromise = nativePlayer.instance
        ? nativePlayer.instance.play()
        : nativePlayer.play();

      playPromise
        .then(() => {
          console.log("Successfully started playback");
          setIsPlayingState(true);

          // Recalculate the actual duration based on current position
          const duration = Math.max(0, (endTime - actualCurrentTime) * 1000); // Convert to milliseconds
          console.log(`Will pause after ${duration}ms (at ${endTime}s)`);

          // Set timeout to pause at end time
          if (duration > 0) {
            playTimeoutRef.current = window.setTimeout(() => {
              try {
                // Access player directly if possible for more reliable pausing
                if (nativePlayer.instance) {
                  nativePlayer.instance.pause();
                } else {
                  nativePlayer.pause();
                }
                setIsPlayingState(false);
                console.log("Paused after timeout");
              } catch (err) {
                console.error("Error pausing player after timeout:", err);
              } finally {
                playTimeoutRef.current = null;
              }
            }, duration);
          }
        })
        .catch((err) => {
          console.error("Error starting playback:", err);
          setIsPlayingState(false);

          // Try direct play as fallback if the promise-based approach fails
          try {
            if (nativePlayer.instance) {
              nativePlayer.instance.play();
              setIsPlayingState(true);
              console.log("Fallback play method succeeded");
            }
          } catch (directErr) {
            console.error("Fallback play method also failed:", directErr);
          }
        });
    } catch (err) {
      console.error("Unexpected error during play operation:", err);
      setIsPlayingState(false);

      // Last resort attempt using a timeout to try again
      setTimeout(() => {
        try {
          if (nativePlayer.instance) {
            nativePlayer.instance.play();
            setIsPlayingState(true);
            console.log("Last resort play succeeded");
          }
        } catch (finalErr) {
          console.error("All play attempts failed:", finalErr);
        }
      }, 200);
    }
  }

  function handleEditSubtitle(
    index: number,
    field: "start" | "end" | "text",
    value: number | string
  ) {
    // Track which input is being edited
    focusedInputRef.current = { index, field };

    if (field === "text") {
      // Update text directly
      setSubtitlesState((current) =>
        current.map((sub, i) =>
          i === index ? { ...sub, text: value as string } : sub
        )
      );
      return;
    }

    // Store the intermediate editing value
    setEditingTimesState((prev) => ({
      ...prev,
      [`${index}-${field}`]: value as string,
    }));

    // Create a unique key for this specific field
    const debounceKey = `${index}-${field}`;

    // Create a debounced function if it doesn't exist yet
    if (!debouncedTimeUpdateRef.current[debounceKey]) {
      debouncedTimeUpdateRef.current[debounceKey] = debounce(
        (value: string) => {
          // This is the debounced function that will run after the user stops typing
          // Try to parse the value as SRT time format first
          let numValue: number;
          if (typeof value === "string" && value.includes(":")) {
            numValue = srtTimeToSeconds(value);
          } else {
            numValue = parseFloat(value as string);
          }

          if (isNaN(numValue) || numValue < 0) {
            return;
          }

          // Get the current subtitle and adjacent ones from local state
          const currentSub = subtitlesState[index];
          const prevSub = index > 0 ? subtitlesState[index - 1] : null;

          // For start timestamp, we only validate against previous subtitle
          if (field === "start") {
            // Only validate that it doesn't overlap with previous subtitle
            if (prevSub && numValue < prevSub.start) return;

            // If start time would exceed end time, adjust the end time to maintain original duration
            let newEnd = currentSub.end;
            if (numValue >= currentSub.end) {
              // Calculate the original duration
              const originalDuration = currentSub.end - currentSub.start;
              // Preserve that exact duration when shifting
              newEnd = numValue + originalDuration;
            }

            // Update both start and end if needed
            setSubtitlesState((current) =>
              current.map((sub, i) =>
                i === index ? { ...sub, start: numValue, end: newEnd } : sub
              )
            );
          } else {
            // For end timestamp, no validation
            setSubtitlesState((current) =>
              current.map((sub, i) =>
                i === index ? { ...sub, [field]: numValue } : sub
              )
            );
          }

          // Restore focus after a short delay to ensure React has updated the DOM
          setTimeout(restoreFocus, 50);
        },
        300
      ); // 300ms debounce
    }

    // Call the debounced function
    debouncedTimeUpdateRef.current[debounceKey](value);
  }

  function handleShiftSubtitle(index: number, shiftSeconds: number) {
    if (isShiftingDisabled) return;

    // Disable shifting during processing to prevent rapid clicks
    setIsShiftingDisabled(true);

    try {
      // Get the current subtitle
      const sub = subtitlesState[index];
      if (!sub) {
        console.error("Subtitle not found at index:", index);
        setIsShiftingDisabled(false);
        return;
      }

      // Calculate new start and end times
      const newStart = Math.max(0, sub.start + shiftSeconds);
      const duration = sub.end - sub.start;
      const newEnd = newStart + duration;

      // Update the subtitle
      setSubtitlesState((current) =>
        current.map((s, i) =>
          i === index ? { ...s, start: newStart, end: newEnd } : s
        )
      );

      // If we have a player, seek to the new position to show the change
      try {
        nativePlayer.seek(newStart);
      } catch (err) {
        console.error("Error seeking to new position after shift:", err);
      }

      // Re-enable shifting
      setTimeout(() => {
        setIsShiftingDisabled(false);
      }, 100);
    } catch (err) {
      console.error("Error shifting subtitle:", err);
      setIsShiftingDisabled(false);
    }
  }

  async function handleMergeVideoWithSubtitles() {
    if (!videoFile || subtitlesState.length === 0) {
      onSetError("Please upload a video file and subtitle file first");
      return;
    }

    try {
      // Update UI state
      setIsMergingInProgressState(true);
      setMergeProgress(0);
      setMergeStage("Preparing files");
      onSetError("");

      // Call the merger function
      await mergeSubtitlesWithVideo(videoFile, subtitlesState, {
        onProgress: (progress) => {
          setMergeProgress(progress);
          if (progress >= 99) {
            setMergeStage("Merging complete");
          } else if (progress >= 50) {
            setMergeStage("Merging video with subtitles");
          } else if (progress >= 10) {
            setMergeStage("Processing video");
          }
        },
      });

      setMergeStage("Merging complete");

      // Keep UI showing completion for 2 seconds
      setTimeout(() => {
        setIsMergingInProgressState(false);
      }, 2000);
    } catch (error) {
      console.error("Error merging video with subtitles:", error);
      onSetError(
        error instanceof Error
          ? error.message
          : "An error occurred while merging video with subtitles"
      );
      setIsMergingInProgressState(false);
      setMergeStage("Error occurred");
    }
  }

  // Add an effect to automatically update subtitles whenever they change
  useEffect(() => {
    if (subtitlesState.length > 0) {
      // Use videoPlayerRef from props if available
      if (videoPlayerRef && typeof videoPlayerRef.currentTime === "function") {
        try {
          const currentTime = videoPlayerRef.currentTime();
          videoPlayerRef.currentTime(currentTime);
        } catch (e) {
          console.warn("Error updating player time:", e);
        }
      }
      // Fallback to subtitleVideoPlayer global if available
      else if (
        subtitleVideoPlayer &&
        subtitleVideoPlayer.instance &&
        typeof subtitleVideoPlayer.instance.currentTime === "function"
      ) {
        try {
          const currentTime = subtitleVideoPlayer.instance.currentTime();
          subtitleVideoPlayer.instance.currentTime(currentTime);
        } catch (e) {
          console.warn("Error updating global player time:", e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesState]);

  // Function to find the current subtitle that matches the video's current time
  const findCurrentSubtitle = useCallback(() => {
    if (!subtitlesState.length || !nativePlayer.instance) return null;

    const currentTime = nativePlayer.instance.currentTime;

    // Find the subtitle that contains the current time
    const currentSubtitleIndex = subtitlesState.findIndex(
      (sub) => currentTime >= sub.start && currentTime <= sub.end
    );

    // If no subtitle is currently active, find the next one
    if (currentSubtitleIndex === -1) {
      const nextSubtitleIndex = subtitlesState.findIndex(
        (sub) => currentTime < sub.start
      );

      return nextSubtitleIndex !== -1 ? nextSubtitleIndex : null;
    }

    return currentSubtitleIndex;
  }, [subtitlesState]);

  // Function to scroll to the current subtitle
  const scrollToCurrentSubtitle = useCallback(() => {
    const currentSubtitleIndex = findCurrentSubtitle();

    if (currentSubtitleIndex === null) {
      // If no current subtitle, show a message or alert
      console.log("No subtitle is currently active or coming up next");
      return;
    }

    const subtitleElement = subtitleRefs.current[currentSubtitleIndex];

    if (subtitleElement) {
      // Scroll the subtitle into view with smooth animation
      subtitleElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Add a highlight class temporarily to make it stand out
      subtitleElement.classList.add("highlight-subtitle");

      // Remove the highlight class after a delay
      setTimeout(() => {
        subtitleElement.classList.remove("highlight-subtitle");
      }, 2000);
    }
  }, [findCurrentSubtitle]);

  // Expose methods through ref
  useEffect(() => {
    if (editorRef && editorRef.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
    }
  }, [editorRef, scrollToCurrentSubtitle]);

  return (
    <Section title="Edit Subtitles" overflowVisible={true}>
      {/* File input fields - Show when not in extraction mode or when video is loaded but no subtitles */}
      {(!videoFile || (videoFile && subtitlesState.length === 0)) && (
        <div style={{ marginBottom: 20 }}>
          {!videoFile && (
            <div style={{ marginBottom: 10 }}>
              <StylizedFileInput
                accept="video/*"
                onChange={(e) => {
                  if (e.target.files?.[0]) {
                    onSetVideoFile(e.target.files[0]);
                    // Create a URL for the video file
                    const url = URL.createObjectURL(e.target.files[0]);
                    onSetVideoUrl(url);
                  }
                }}
                label="Load Video:"
                buttonText="Choose Video"
              />
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <StylizedFileInput
              accept=".srt"
              onChange={handleSrtFileInputChange}
              label="Load SRT:"
              buttonText="Choose SRT File"
            />
          </div>
        </div>
      )}

      {/* Video Player Section - Now handled by StickyVideoPlayer */}
      {/* The play button has been moved from the title to the TimestampDisplay inside StickyVideoPlayer */}

      {/* Subtitles editing section */}
      {subtitlesState.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              marginTop: 0,
            }}
          >
            <h3 style={{ margin: 0 }}>Subtitles ({subtitlesState.length})</h3>
          </div>

          <div
            className={`subtitle-editor-container ${css`
              display: flex;
              flex-direction: column;
              gap: 15px;
              margin-bottom: 80px;

              .highlight-subtitle {
                animation: highlight-pulse 2s ease-in-out;
              }

              @keyframes highlight-pulse {
                0%,
                100% {
                  background-color: transparent;
                }
                50% {
                  background-color: rgba(255, 215, 0, 0.3);
                }
              }
            `}`}
          >
            {subtitlesState.map((sub, index) => (
              <div
                key={`subtitle-container-${index}`}
                ref={(el) => {
                  subtitleRefs.current[index] = el;
                }}
              >
                <SubtitleEditor
                  key={`subtitle-${index}-${sub.start}-${sub.end}`}
                  sub={sub}
                  index={index}
                  editingTimes={editingTimesState}
                  isPlaying={isPlayingState}
                  secondsToSrtTime={secondsToSrtTime}
                  onEditSubtitle={handleEditSubtitle}
                  onTimeInputBlur={handleTimeInputBlur}
                  onRemoveSubtitle={handleRemoveSubtitle}
                  onInsertSubtitle={handleInsertSubtitle}
                  onSeekToSubtitle={handleSeekToSubtitle}
                  onPlaySubtitle={handlePlaySubtitle}
                  onShiftSubtitle={handleShiftSubtitle}
                  isShiftingDisabled={isShiftingDisabled}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Fixed Action Bar */}
      {subtitlesState.length > 0 && (
        <div
          className={css`
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 15px 20px;
            background-color: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(8px);
            border-top: 1px solid rgba(238, 238, 238, 0.8);
            display: flex;
            gap: 10px;
            justify-content: center;
            z-index: 100;
            box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.08);
          `}
        >
          <Button
            onClick={handleSaveEditedSrt}
            variant="primary"
            size="lg"
            className={`${buttonGradientStyles.base} ${buttonGradientStyles.primary}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: "8px" }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Save Edited SRT
          </Button>
          <Button
            onClick={handleMergeVideoWithSubtitles}
            variant="secondary"
            size="lg"
            disabled={
              !videoFile ||
              subtitlesState.length === 0 ||
              isMergingInProgressState
            }
            className={mergeButtonStyles}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: "8px" }}
            >
              <path d="M14 3v4a1 1 0 0 0 1 1h4" />
              <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z" />
              <path d="M12 11v6" />
              <path d="M9 14l3 -3l3 3" />
            </svg>
            Merge Video with Subtitles
          </Button>
        </div>
      )}

      {/* Progress display for merging */}
      {isMergingInProgressState && (
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "white",
            borderRadius: "8px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            padding: "20px",
            width: "80%",
            maxWidth: "500px",
            zIndex: 1000,
          }}
        >
          <h3>Merging Video with Subtitles</h3>
          <div>{mergeStage}</div>
          <div
            style={{
              width: "100%",
              height: "20px",
              backgroundColor: "#f0f0f0",
              borderRadius: "10px",
              overflow: "hidden",
              marginTop: "10px",
            }}
          >
            <div
              style={{
                width: `${mergeProgress}%`,
                height: "100%",
                backgroundColor: "#4361ee",
                borderRadius: "10px",
                transition: "width 0.3s ease-in-out",
              }}
            />
          </div>
          <div
            style={{
              textAlign: "right",
              marginTop: "5px",
              fontSize: "14px",
            }}
          >
            {mergeProgress}%
          </div>
        </div>
      )}
    </Section>
  );
}
