import React, { useEffect, useRef, useCallback, useState } from "react";
import { SrtSegment } from "./VideoPlayerWithSubtitles";
import NativeVideoPlayer, { nativePlayer } from "./NativeVideoPlayer";
import { css } from "@emotion/css";
import Button from "../Button";
import SubtitleEditor from "./SubtitleEditor";
import { debounce } from "lodash";
import StylizedFileInput from "../StylizedFileInput";

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

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  targetLanguage: string;
  showOriginalText: boolean;
  onSetVideoFile: (file: File) => void;
  onSetVideoUrl: (url: string | null) => void;
  onSetError: (error: string) => void;
  mergeSubtitlesWithVideo: (
    videoFile: File,
    subtitles: SrtSegment[],
    options: { onProgress: (progress: number) => void }
  ) => Promise<{ outputPath: string; error?: string }>;
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
  const segments: SrtSegment[] = [];
  const lines = srtString.split(/\r?\n/);

  let currentSegment: Partial<SrtSegment> = {};
  let textLines: string[] = [];
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    lineIndex++;

    // Skip empty lines
    if (line.trim() === "") {
      if (Object.keys(currentSegment).length > 0 && textLines.length > 0) {
        // Finish current segment
        currentSegment.text = textLines.join("\n");
        segments.push(currentSegment as SrtSegment);

        // Reset for next segment
        currentSegment = {};
        textLines = [];
      }
      continue;
    }

    // Parse index number
    if (currentSegment.index === undefined) {
      const index = parseInt(line.trim());
      if (!isNaN(index)) {
        currentSegment.index = index;
        continue;
      }
    }

    // Parse time line
    if (
      currentSegment.start === undefined &&
      currentSegment.end === undefined
    ) {
      const timeMatch = line.match(
        /(\d+:\d+:\d+,\d+)\s*-->\s*(\d+:\d+:\d+,\d+)/
      );
      if (timeMatch) {
        currentSegment.start = srtTimeToSeconds(timeMatch[1]);
        currentSegment.end = srtTimeToSeconds(timeMatch[2]);
        continue;
      }
    }

    // If we're here, this is a text line
    if (currentSegment.index !== undefined) {
      textLines.push(line);
    }
  }

  // Don't forget the last segment if not terminated by an empty line
  if (Object.keys(currentSegment).length > 0 && textLines.length > 0) {
    currentSegment.text = textLines.join("\n");
    segments.push(currentSegment as SrtSegment);
  }

  return segments;
};

export default function EditSubtitles({
  videoFile,
  videoUrl,
  targetLanguage,
  showOriginalText,
  onSetVideoFile,
  onSetVideoUrl,
  onSetError,
  mergeSubtitlesWithVideo,
}: EditSubtitlesProps) {
  // State for the component
  const [subtitles, setSubtitles] = useState<SrtSegment[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editingTimes, setEditingTimes] = useState<Record<string, string>>({});
  const [isMergingInProgress, setIsMergingInProgress] = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState("");
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  // Removed fileKey state that was causing component remounting

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
      const currentEditValue = editingTimes[editKey];

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
          const currentSub = subtitles[index];
          const prevSub = index > 0 ? subtitles[index - 1] : null;
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
              setSubtitles((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, start: numValue, end: newEnd } : sub
                )
              );
            } else {
              setSubtitles((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, [field]: numValue } : sub
                )
              );
            }
          }
        }
      }

      // Clear the editing state
      setEditingTimes((prev) => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    [subtitles, editingTimes]
  );

  const handleRemoveSubtitle = useCallback(
    (index: number) => {
      if (
        !window.confirm("Are you sure you want to remove this subtitle block?")
      ) {
        return;
      }

      const updatedSubtitles = subtitles.filter((_, i) => i !== index);
      setSubtitles(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1, // Reindex remaining subtitles
        }))
      );
    },
    [subtitles]
  );

  const handleInsertSubtitle = useCallback(
    (index: number) => {
      const currentSub = subtitles[index];
      const nextSub =
        index < subtitles.length - 1 ? subtitles[index + 1] : null;

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
        ...subtitles.slice(0, index + 1),
        newSubtitle,
        ...subtitles.slice(index + 1),
      ];

      // Reindex all subtitles
      setSubtitles(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1,
        }))
      );
    },
    [subtitles]
  );

  const handleSeekToSubtitle = useCallback((startTime: number) => {
    console.log("Seeking to:", startTime);
    try {
      nativePlayer.seek(startTime);
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
        setSubtitles([]);
        setEditingTimes({});

        // Parse and set the new content
        const parsed = parseSrt(srtContent);
        setSubtitles(parsed);
        
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
      const srtContent = generateSrtContent(subtitles);

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

    console.log("Player ready, configuring event handlers");

    // Add event listeners to the native player
    const handlePlay = () => {
      console.log("Video playing event fired");
      setIsPlaying(true);
    };

    const handlePause = () => {
      console.log("Video paused event fired");
      setIsPlaying(false);
    };

    const handleEnded = () => {
      console.log("Video ended event fired");
      setIsPlaying(false);
    };

    // Add proper cleanup for listeners to avoid memory leaks and ensure reliable state
    player.addEventListener("play", handlePlay);
    player.addEventListener("playing", handlePlay); // additional event for more reliability
    player.addEventListener("pause", handlePause);
    player.addEventListener("ended", handleEnded);

    // Set initial state based on player
    setIsPlaying(!player.paused);
    
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
    console.log("Play subtitle called with:", startTime, endTime);

    // Clear any existing timeout
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    // If we're already playing, pause first
    if (isPlaying) {
      try {
        nativePlayer.pause();
        setIsPlaying(false);
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

      console.log("Play with start time:", validStartTime, "end time:", validEndTime);
      
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
      
      console.log("Current position before play:", currentPosition);

      // If we're already within this subtitle's time range, play from current position
      if (currentPosition >= validStartTime && currentPosition < validEndTime) {
        console.log("Within subtitle range, playing from current position");
        playFromCurrentPosition(currentPosition, validEndTime);
      } else {
        // Only seek if we're not in the subtitle range
        console.log(`Seeking to position ${validStartTime} before play`);
        
        try {
          // Direct property access for more reliable seeking
          if (nativePlayer.instance) {
            nativePlayer.instance.currentTime = validStartTime;
            console.log("Direct seek completed, now at:", nativePlayer.instance.currentTime);
          } else {
            nativePlayer.seek(validStartTime);
          }
          
          // Wait a bit longer to ensure seek completes before playing
          setTimeout(() => {
            let actualPosition = nativePlayer.getCurrentTime();
            console.log("Position after seek timeout:", actualPosition);
            playFromCurrentPosition(actualPosition, validEndTime);
          }, 200); // Increased timeout for more reliable seek completion
        } catch (seekErr) {
          console.error("Error during seek:", seekErr);
          // Fall back to playing from start time even if seek fails
          playFromCurrentPosition(validStartTime, validEndTime);
        }
      }
    } catch (err) {
      console.error("Error during subtitle playback:", err);
      setIsPlaying(false);
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
    
    console.log(`Now playing from position ${actualCurrentTime}`);

    // Play from that position with proper error handling
    try {
      // Try to play using both direct DOM API and the wrapper function
      const playPromise = nativePlayer.instance 
        ? nativePlayer.instance.play() 
        : nativePlayer.play();
      
      playPromise
        .then(() => {
          console.log("Successfully started playback");
          setIsPlaying(true);

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
                setIsPlaying(false);
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
          setIsPlaying(false);
          
          // Try direct play as fallback if the promise-based approach fails
          try {
            if (nativePlayer.instance) {
              nativePlayer.instance.play();
              setIsPlaying(true);
              console.log("Fallback play method succeeded");
            }
          } catch (directErr) {
            console.error("Fallback play method also failed:", directErr);
          }
        });
    } catch (err) {
      console.error("Unexpected error during play operation:", err);
      setIsPlaying(false);
      
      // Last resort attempt using a timeout to try again
      setTimeout(() => {
        try {
          if (nativePlayer.instance) {
            nativePlayer.instance.play();
            setIsPlaying(true);
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
      setSubtitles((current) =>
        current.map((sub, i) =>
          i === index ? { ...sub, text: value as string } : sub
        )
      );
      return;
    }

    // Store the intermediate editing value
    setEditingTimes((prev) => ({
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
          const currentSub = subtitles[index];
          const prevSub = index > 0 ? subtitles[index - 1] : null;

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
            setSubtitles((current) =>
              current.map((sub, i) =>
                i === index ? { ...sub, start: numValue, end: newEnd } : sub
              )
            );
          } else {
            // For end timestamp, no validation
            setSubtitles((current) =>
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
      const sub = subtitles[index];
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
      setSubtitles((current) =>
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
    if (!videoFile || subtitles.length === 0) {
      onSetError("Please upload a video file and subtitle file first");
      return;
    }

    try {
      // Update UI state
      setIsMergingInProgress(true);
      setMergeProgress(0);
      setMergeStage("Preparing files");
      onSetError("");

      // Call the merger function
      await mergeSubtitlesWithVideo(videoFile, subtitles, {
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
        setIsMergingInProgress(false);
      }, 2000);
    } catch (error) {
      console.error("Error merging video with subtitles:", error);
      onSetError(
        error instanceof Error
          ? error.message
          : "An error occurred while merging video with subtitles"
      );
      setIsMergingInProgress(false);
      setMergeStage("Error occurred");
    }
  }

  return (
    <div className={containerStyles} id="subtitle-editor-section">
      {/* File input fields - Show when not in extraction mode or when video is loaded but no subtitles */}
      {(!videoFile || (videoFile && subtitles.length === 0)) && (
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

      {/* Video Player Section */}
      {videoUrl && (
        <div
          className={css`
            position: sticky;
            top: 10px;
            z-index: 100;
            background-color: rgba(255, 255, 255, 0.85);
            backdrop-filter: blur(5px);
            padding: 15px;
            border-radius: 8px;
            border-bottom: 1px solid rgba(238, 238, 238, 0.8);
            margin-bottom: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
            max-height: 50vh;
            overflow: visible;
            transition: max-height 0.3s ease;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
          `}
        >
          <NativeVideoPlayer
            // Remove the key that forces remounting when props change
            videoUrl={videoUrl}
            subtitles={subtitles}
            onPlayerReady={handlePlayerReady}
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

          <div
            style={{
              marginTop: 15,
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <StylizedFileInput
              accept="video/*"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  // First clear any previous errors
                  onSetError("");

                  // If we have an existing video URL, revoke it
                  if (videoUrl && videoUrl.startsWith("blob:")) {
                    try {
                      URL.revokeObjectURL(videoUrl);
                    } catch (err) {
                      console.error("Error revoking URL:", err);
                    }
                    onSetVideoUrl(null);
                  }

                  // Set the new video file
                  const file = files[0];
                  console.log(
                    "Selected video file:",
                    file.name,
                    file.type,
                    file.size
                  );

                  onSetVideoFile(file);

                  // Create object URL with a slight delay to ensure DOM is ready
                  setTimeout(() => {
                    try {
                      // Create a blob URL for the file
                      const blobUrl = URL.createObjectURL(file);
                      console.log("Created blob URL for video:", blobUrl);

                      // Log detailed file information for debugging
                      console.log("Video file details:", {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        lastModified: new Date(file.lastModified).toISOString(),
                      });

                      // Set the URL to trigger video loading
                      onSetVideoUrl(blobUrl);

                      // Reset the file input to allow selecting the same file again if needed
                      setFileKey(Date.now());
                    } catch (err) {
                      console.error("Error creating object URL:", err);
                      onSetError(
                        "Failed to load video file. Please try another format."
                      );
                    }
                  }, 200);
                }
              }}
              buttonText="Change Video"
            />
            <StylizedFileInput
              accept=".srt"
              onChange={handleSrtFileInputChange}
              buttonText="Change SRT"
            />
            <Button
              onClick={() => {
                try {
                  if (isPlaying) {
                    console.log("Pausing video (main button)");
                    nativePlayer.pause();
                  } else {
                    console.log("Playing video (main button)");
                    nativePlayer.play();
                  }
                } catch (err) {
                  console.error("Error controlling playback:", err);
                }
              }}
              variant={isPlaying ? "danger" : "primary"}
              size="md"
              className={`${buttonGradientStyles.base} ${
                isPlaying ? buttonGradientStyles.danger : buttonGradientStyles.primary
              } ${css`
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 40px;
                min-width: 80px;
                transition: all 0.2s ease;
              `}`}
            >
              {isPlaying ? "Pause" : "Play"}
            </Button>
          </div>
        </div>
      )}

      {/* Subtitles editing section */}
      {subtitles.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 15,
            }}
          >
            <h3 style={{ margin: 0 }}>Subtitles ({subtitles.length})</h3>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 15,
              marginBottom: 80,
            }}
          >
            {subtitles.map((sub, index) => (
              <SubtitleEditor
                key={`subtitle-${index}-${sub.start}-${sub.end}`}
                sub={sub}
                index={index}
                editingTimes={editingTimes}
                isPlaying={isPlaying}
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
            ))}
          </div>
        </>
      )}

      {/* Fixed Action Bar */}
      {subtitles.length > 0 && (
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
            Save Edited SRT
          </Button>
          <Button
            onClick={handleMergeVideoWithSubtitles}
            variant="secondary"
            size="lg"
            disabled={
              !videoFile || subtitles.length === 0 || isMergingInProgress
            }
            className={mergeButtonStyles}
          >
            Merge Video with Subtitles
          </Button>
        </div>
      )}

      {/* Progress display for merging */}
      {isMergingInProgress && (
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
    </div>
  );
}
