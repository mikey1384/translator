import React, { useEffect, useRef, useCallback, useState } from 'react';
import VideoPlayerWithSubtitles from './VideoPlayerWithSubtitles';
import { useAppContext } from '~/contexts/hooks';
import { srtTimeToSeconds } from '../utils';
import { css } from '@emotion/css';
import Button from '../Button';
import StylizedFileInput from '../StylizedFileInput';
import ButtonGroup from '../ButtonGroup';
import SubtitleEditor from './SubtitleEditor';
import {
  mergeStates,
  subtitleVideoPlayer,
  subtitlesState
} from '~/constants/state';
import { debounce } from 'lodash';

// Add container styles - removing borders and making it minimal
const containerStyles = css`
  margin-top: 20px;
`;

// Add a distinct style for the merge button to make it stand out
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
  secondary: css`
    background: linear-gradient(
      135deg,
      rgba(108, 117, 125, 0.9),
      rgba(84, 91, 98, 0.9)
    ) !important;

    &:hover:not(:disabled) {
      background: linear-gradient(
        135deg,
        rgba(128, 137, 145, 0.95),
        rgba(104, 111, 118, 0.95)
      ) !important;
    }

    &:disabled {
      background: linear-gradient(
        135deg,
        rgba(108, 117, 125, 0.6),
        rgba(84, 91, 98, 0.6)
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
  `
};

// Replace the previous mergeButtonStyles with the new purple gradient style
const mergeButtonStyles = css`
  ${buttonGradientStyles.base}
  ${buttonGradientStyles.purple}
`;

interface SrtSegment {
  index: number;
  start: number;
  end: number;
  text: string;
}

interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  isPlaying: boolean;
  editingTimes: Record<string, string>;
  targetLanguage: string;
  showOriginalText: boolean;
  isMergingInProgress: boolean;
  onSetEditingTimes: any;
  onSetVideoFile: (file: File) => void;
  onSetVideoUrl: (url: string | null) => void;
  onSetError: (error: string) => void;
  secondsToSrtTime: (seconds: number) => string;
  parseSrt: (
    srtString: string,
    targetLanguage: string,
    showOriginalText: boolean
  ) => SrtSegment[];
  onSetIsMergingInProgress: (inProgress: boolean) => void;
  onSetMergeProgress: (progress: number) => void;
  onSetMergeStage: (stage: string) => void;
  onSetIsPlaying: (isPlaying: boolean) => void;
  subtitles: SrtSegment[];
  onSetSubtitles: (
    subtitles: SrtSegment[] | ((current: SrtSegment[]) => SrtSegment[])
  ) => void;
}

export default function EditSubtitles({
  videoFile,
  videoUrl,
  isPlaying,
  editingTimes,
  targetLanguage,
  showOriginalText,
  isMergingInProgress,
  onSetEditingTimes,
  onSetVideoFile,
  onSetVideoUrl,
  onSetError,
  secondsToSrtTime,
  parseSrt,
  onSetIsMergingInProgress,
  onSetMergeProgress,
  onSetMergeStage,
  onSetIsPlaying,
  subtitles,
  onSetSubtitles
}: EditSubtitlesProps) {
  const playTimeoutRef = useRef<number | null>(null);
  const mergeVideoWithSubtitles = useAppContext(
    (v) => v.requestHelpers.mergeVideoWithSubtitles
  );

  // Create a session ID for this component instance
  const sessionIdRef = useRef<string>(`merge-${Date.now()}`);

  const [fileKey, setFileKey] = useState<number>(Date.now()); // Add state for file input key

  // Need to create a ref to store our debounced functions
  const debouncedTimeUpdateRef = useRef<Record<string, any>>({});

  // Simple state for disabling shift buttons
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);

  // Ref to track the currently focused input
  const focusedInputRef = useRef<{
    index: number | null;
    field: 'start' | 'end' | 'text' | null;
  }>({
    index: null,
    field: null
  });

  // Manage global merge state during mount/unmount
  useEffect(() => {
    // On mount, check if there are stale merge states showing in the UI
    if (isMergingInProgress) {
      // Reset UI state if it doesn't correspond to an active merge
      if (
        !mergeStates[sessionIdRef.current] ||
        !mergeStates[sessionIdRef.current].inProgress
      ) {
        onSetIsMergingInProgress(false);
        onSetMergeProgress(0);
        onSetMergeStage('');
      }
    }

    // Setup merge state if it doesn't exist
    if (!mergeStates[sessionIdRef.current]) {
      mergeStates[sessionIdRef.current] = {
        inProgress: false,
        progress: 0,
        stage: '',
        completedTimestamp: 0
      };
    }

    const playTimeout = playTimeoutRef.current;
    const sessionId = sessionIdRef.current;
    return () => {
      if (playTimeout) {
        window.clearTimeout(playTimeout);
      }

      if (mergeStates[sessionId]) {
        if (
          mergeStates[sessionId].progress >= 100 ||
          mergeStates[sessionId].stage === 'Merging complete'
        ) {
          mergeStates[sessionId].inProgress = false;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMergingInProgress]);

  // Initialize editingTimes if needed
  useEffect(() => {
    if (
      Object.keys(editingTimes).length > 0 &&
      Object.keys(subtitlesState.editingTimes).length === 0
    ) {
      subtitlesState.editingTimes = { ...editingTimes };
    }
  }, [editingTimes]);

  // Add a cleanup effect for navigation
  useEffect(() => {
    return () => {
      if (playTimeoutRef.current) {
        window.clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }
    };
  }, [subtitles]); // Add subtitles to the dependency array

  // Add an effect to handle subtitle changes and reset editing state
  useEffect(() => {
    if (subtitles.length > 0) {
      // Force clear the editing times if they don't match the current subtitles
      const currentEditingKeys = Object.keys(subtitlesState.editingTimes || {});
      const validIndices = subtitles.map((_, idx) => idx);

      const hasInvalidEdits = currentEditingKeys.some((key) => {
        const parts = key.split('-');
        const index = parseInt(parts[0], 10);
        return isNaN(index) || !validIndices.includes(index);
      });

      if (hasInvalidEdits) {
        subtitlesState.editingTimes = {};
        onSetEditingTimes({});
      }
    }
  }, [subtitles, onSetEditingTimes]);

  const handleTimeInputBlur = useCallback(
    (index: number, field: 'start' | 'end') => {
      const editKey = `${index}-${field}`;

      // Get the current editing value
      const currentEditValue = subtitlesState.editingTimes[editKey];

      if (currentEditValue) {
        // Try to parse the value as SRT time format first
        let numValue: number;
        if (
          typeof currentEditValue === 'string' &&
          currentEditValue.includes(':')
        ) {
          // This looks like an SRT timestamp, try to parse it
          numValue = srtTimeToSeconds(currentEditValue);
        } else {
          // Try to parse as a plain number
          numValue = parseFloat(currentEditValue);
        }

        if (!isNaN(numValue) && numValue >= 0) {
          // Get the current subtitle and adjacent ones
          const currentSub = subtitles[index];
          const prevSub = index > 0 ? subtitles[index - 1] : null;

          // Validate only for start field
          let isValid = true;
          let newEnd = currentSub.end;

          if (field === 'start') {
            // Check only for overlap with previous subtitle
            if (prevSub && numValue < prevSub.start) {
              isValid = false;
            }

            // If start time would exceed end time, adjust end time
            if (numValue >= currentSub.end) {
              // Calculate the original duration and preserve it
              const originalDuration = currentSub.end - currentSub.start;
              // Maintain the same duration when shifting
              newEnd = numValue + originalDuration;
            }
          }
          // No validation for end timestamp - let users set any values

          // If valid, commit the change to the actual subtitles
          if (isValid) {
            if (field === 'start' && numValue >= currentSub.end) {
              // Update both start and end
              onSetSubtitles((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, start: numValue, end: newEnd } : sub
                )
              );
            } else {
              // Just update the field that was changed
              onSetSubtitles((current) =>
                current.map((sub, i) =>
                  i === index ? { ...sub, [field]: numValue } : sub
                )
              );
            }
            subtitlesState.lastEdited = Date.now();
          }
        }
      }

      // Update subtitlesState
      const newEditingTimes = { ...subtitlesState.editingTimes };
      delete newEditingTimes[editKey];
      subtitlesState.editingTimes = newEditingTimes;

      // Also update context state for compatibility
      onSetEditingTimes((prev: any) => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subtitles, onSetSubtitles] // Add the dependencies
  );

  const handleRemoveSubtitle = useCallback(
    (index: number) => {
      if (
        !window.confirm('Are you sure you want to remove this subtitle block?')
      ) {
        return;
      }

      // Update subtitles through the parent
      const updatedSubtitles = subtitles.filter((_, i) => i !== index);
      onSetSubtitles(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1 // Reindex remaining subtitles
        }))
      );
      subtitlesState.lastEdited = Date.now();
    },
    [subtitles, onSetSubtitles]
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
        text: ''
      };

      // Create a copy with the new subtitle inserted
      const updatedSubtitles = [
        ...subtitles.slice(0, index + 1),
        newSubtitle,
        ...subtitles.slice(index + 1)
      ];

      // Reindex all subtitles
      onSetSubtitles(
        updatedSubtitles.map((sub, i) => ({
          ...sub,
          index: i + 1
        }))
      );
      subtitlesState.lastEdited = Date.now();
    },
    [subtitles, onSetSubtitles]
  );

  const handleSeekToSubtitle = useCallback(
    (startTime: number) => {
      if (!subtitleVideoPlayer.instance) {
        console.warn('Cannot seek - player not available in global state');
        return;
      }

      // Use global player instance
      const player = subtitleVideoPlayer.instance;

      try {
        if (typeof player.currentTime !== 'function') {
          console.error('Player currentTime method not available');
          return;
        }

        player.currentTime(startTime);
      } catch (err: unknown) {
        console.error('Error seeking to time:', err);
      }
    },
    [] // No dependencies needed since we're using global state
  );

  function handleSrtFileInputChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Clear input value to ensure onChange triggers even for the same file
    if (event.target) {
      event.target.value = '';
    }

    const reader = new FileReader();
    reader.onload = function (e) {
      const srtContent = e.target?.result as string;
      try {
        // STEP 1: First reset global state used by the editor
        subtitlesState.segments = [];
        subtitlesState.editingTimes = {};
        subtitlesState.lastEdited = Date.now();

        // STEP 2: Reset the React component state
        // This ensures the parent component's state is cleared
        onSetSubtitles([]);
        onSetEditingTimes({});

        // STEP 3: Now parse and set the new content
        const parsed = parseSrt(srtContent, targetLanguage, showOriginalText);

        // Small delay to ensure previous state changes have propagated
        setTimeout(() => {
          // STEP 4: Update React state with new data
          onSetSubtitles(parsed);

          // STEP 5: Update global state
          subtitlesState.segments = [...parsed]; // Use a new array to ensure reference changes

          // Force update fileKey to reset the file input
          setFileKey(Date.now());
        }, 50);
      } catch (error) {
        console.error('Error parsing SRT:', error);
        onSetError('Invalid SRT file');
      }
    };
    reader.onerror = function (e) {
      console.error('FileReader error:', e);
      onSetError('Error reading SRT file');
    };
    reader.readAsText(file);
  }

  function handleSaveEditedSrt() {
    try {
      // Generate SRT content from subtitles
      const srtContent = generateSrtContent(subtitles);

      // Create a blob and download it
      const blob = new Blob([srtContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited_subtitles.srt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error saving SRT file:', error);
      onSetError('Error saving SRT file');
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
      .join('\n\n');
  }

  // Add an effect to automatically update subtitles whenever they change
  useEffect(() => {
    if (subtitles.length > 0) {
      if (
        subtitleVideoPlayer.instance &&
        typeof subtitleVideoPlayer.instance.currentTime === 'function'
      ) {
        try {
          const currentTime = subtitleVideoPlayer.instance.currentTime();
          subtitleVideoPlayer.instance.currentTime(currentTime);
        } catch (e) {
          console.warn('Error updating player time:', e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitles, subtitleVideoPlayer.instance]);

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
                  }
                }}
                label="Load Video:"
                buttonText="Choose Video"
                selectedFile={null}
              />
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <StylizedFileInput
              key={fileKey}
              accept=".srt"
              onChange={handleSrtFileInputChange}
              label="Load SRT:"
              buttonText="Choose SRT File"
              selectedFile={null}
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
          <VideoPlayerWithSubtitles
            key={`video-player-${videoUrl}`}
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

          <ButtonGroup
            align="center"
            className={css`
              margin-top: 15px;
            `}
          >
            <StylizedFileInput
              accept="video/*"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  // First clear any previous errors
                  onSetError('');

                  // If we have an existing video URL, revoke it
                  if (videoUrl) {
                    URL.revokeObjectURL(videoUrl);
                    onSetVideoUrl(null);
                  }

                  // Then set the new video file after a short delay
                  setTimeout(() => {
                    onSetVideoFile(files[0]);
                  }, 200);
                }
              }}
              buttonText="Change Video"
              selectedFile={null}
            />
            <StylizedFileInput
              key={fileKey}
              accept=".srt"
              onChange={handleSrtFileInputChange}
              buttonText="Change SRT"
              selectedFile={null}
            />
            <Button
              onClick={() => {
                if (subtitleVideoPlayer.instance) {
                  if (isPlaying) {
                    subtitleVideoPlayer.instance.pause();
                    onSetIsPlaying(false);
                  } else {
                    subtitleVideoPlayer.instance.play();
                    onSetIsPlaying(true);
                  }
                }
              }}
              variant="primary"
              size="md"
              className={`${buttonGradientStyles.base} ${
                buttonGradientStyles.primary
              } ${css`
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 40px;
                min-width: 80px;
                transition: all 0.2s ease;

                svg {
                  margin-right: 6px;
                }
              `}`}
            >
              {isPlaying ? (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                  Pause
                </>
              ) : (
                <>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Play
                </>
              )}
            </Button>
          </ButtonGroup>
        </div>
      )}

      {/* Subtitles editing section - directly integrated into the main container */}
      {subtitles.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 15
            }}
          >
            <h3 style={{ margin: 0 }}>Subtitles ({subtitles.length})</h3>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 15,
              marginBottom: 80
            }}
          >
            {subtitles.map((sub, index) => (
              <React.Fragment
                key={`subtitle-${index}-${sub.start}-${sub.end}-${fileKey}`}
              >
                <SubtitleEditor
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
              </React.Fragment>
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: '8px' }}
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Save Edited SRT
          </Button>
          <Button
            onClick={handleOpenMergeModal}
            variant="secondary"
            size="lg"
            disabled={
              !videoFile || subtitles.length === 0 || isMergingInProgress
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
              style={{ marginRight: '8px' }}
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
    </div>
  );

  function handlePlayerReady(player: any) {
    if (!player) {
      console.warn('Invalid player received in handlePlayerReady');
      return;
    }

    // Verify player has required methods
    if (
      typeof player.currentTime !== 'function' ||
      typeof player.play !== 'function' ||
      typeof player.pause !== 'function'
    ) {
      console.error('Player is missing required methods');
      return;
    }

    player.on('play', () => {
      onSetIsPlaying(true);
    });

    player.on('pause', () => {
      onSetIsPlaying(false);
    });

    player.on('ended', () => {
      onSetIsPlaying(false);
    });

    // Add time update listener
    player.on('timeupdate', () => {
      const timeDisplay = document.getElementById('current-timestamp');
      if (timeDisplay && player) {
        try {
          const currentTime = player.currentTime();
          // Display time in SRT format
          timeDisplay.textContent = secondsToSrtTime(currentTime);
        } catch (err: unknown) {
          console.error('Error updating timestamp display:', err);
        }
      }
    });

    // Add error handler
    player.on('error', (e: any) => {
      console.error('Video player error:', e, player.error());
    });
  }

  function handleOpenMergeModal() {
    if (!videoFile || subtitles.length === 0) {
      onSetError('Please upload a video file and subtitle file first');
      return;
    }
    // Instead of showing the modal, directly merge with default settings
    handleMergeVideoWithSubtitles();
  }

  function handlePlaySubtitle(startTime: number, endTime: number) {
    if (!subtitleVideoPlayer.instance) {
      console.warn('No player instance available in global state');
      return;
    }

    // Access the player directly from global state
    const player = subtitleVideoPlayer.instance;

    // Check if player is still valid and has required methods
    try {
      // Test if the player is still valid by checking its methods
      if (
        typeof player.currentTime !== 'function' ||
        typeof player.play !== 'function' ||
        typeof player.pause !== 'function'
      ) {
        console.error(
          'Player methods not available - invalid player reference'
        );
        return;
      }
    } catch (err: unknown) {
      console.error('Error accessing player methods:', err);
      return;
    }

    // Clear any existing timeout
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    // If we're already playing, pause first
    if (isPlaying) {
      try {
        player.pause();
        onSetIsPlaying(false);
      } catch (err: unknown) {
        console.error('Error pausing player:', err);
      }
      return;
    }

    try {
      // Seek to start time and play
      player.currentTime(startTime);
      const playPromise = player.play();

      // Handle play() promise for modern browsers
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            onSetIsPlaying(true);
          })
          .catch((err: unknown) => {
            console.error('Error starting playback:', err);
            onSetIsPlaying(false);
          });
      } else {
        onSetIsPlaying(true);
      }

      // Set timeout to pause at end time
      const duration = (endTime - startTime) * 1000; // Convert to milliseconds

      playTimeoutRef.current = window.setTimeout(() => {
        try {
          if (player && typeof player.pause === 'function') {
            player.pause();
          } else {
            console.warn('Cannot pause - player not available in timeout');
          }
          onSetIsPlaying(false);
        } catch (err: unknown) {
          console.error('Error pausing player after timeout:', err);
        }
        playTimeoutRef.current = null;
      }, duration);
    } catch (err: unknown) {
      console.error('Error during subtitle playback:', err);
      onSetIsPlaying(false);
    }
  }

  function handleEditSubtitle(
    index: number,
    field: 'start' | 'end' | 'text',
    value: number | string
  ) {
    // Track which input is being edited
    focusedInputRef.current = { index, field };

    if (field === 'text') {
      // Update text using onSetSubtitles
      onSetSubtitles((current) =>
        current.map((sub, i) =>
          i === index ? { ...sub, text: value as string } : sub
        )
      );
      subtitlesState.lastEdited = Date.now();
      return;
    }

    // Store the intermediate editing value in subtitlesState only
    const editKey = `${index}-${field}`;
    subtitlesState.editingTimes[editKey] = value as string;

    // Also update context editingTimes state
    onSetEditingTimes((prev: any) => ({
      ...prev,
      [editKey]: value as string
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
          if (typeof value === 'string' && value.includes(':')) {
            // This looks like an SRT timestamp, try to parse it
            numValue = srtTimeToSeconds(value);
          } else {
            // Try to parse as a plain number
            numValue = parseFloat(value as string);
          }

          if (isNaN(numValue) || numValue < 0) {
            return;
          }

          // Get the current subtitle and adjacent ones from local state
          const currentSub = subtitles[index];
          const prevSub = index > 0 ? subtitles[index - 1] : null;

          // For start timestamp, we only validate against previous subtitle
          if (field === 'start') {
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
            onSetSubtitles((current) =>
              current.map((sub, i) =>
                i === index ? { ...sub, start: numValue, end: newEnd } : sub
              )
            );
          } else {
            // For end timestamp, no validation
            onSetSubtitles((current) =>
              current.map((sub, i) =>
                i === index ? { ...sub, [field]: numValue } : sub
              )
            );
          }

          subtitlesState.lastEdited = Date.now();

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
    // If shifting is already in progress, don't allow another one
    if (isShiftingDisabled) return;

    // Disable the shift buttons
    setIsShiftingDisabled(true);

    try {
      // Get the current subtitle
      const currentSub = subtitles[index];

      // Calculate the new start and end times
      const newStart = Math.max(0, currentSub.start + shiftSeconds);
      const newEnd = currentSub.end + shiftSeconds;

      // Only proceed if start time is still valid (not negative)
      if (newStart < 0) {
        setIsShiftingDisabled(false);
        return;
      }

      // Update both start and end times simultaneously
      onSetSubtitles((current) =>
        current.map((sub, i) =>
          i === index ? { ...sub, start: newStart, end: newEnd } : sub
        )
      );

      // Update the global state timestamp and segments
      subtitlesState.lastEdited = Date.now();
      subtitlesState.segments = subtitles.map((sub, i) =>
        i === index ? { ...sub, start: newStart, end: newEnd } : sub
      );

      // If we have a player, seek to the new position to show the change
      if (subtitleVideoPlayer.instance) {
        // Use method call syntax instead of property assignment
        if (typeof subtitleVideoPlayer.instance.currentTime !== 'function') {
          console.error('Player currentTime method not available');
          setIsShiftingDisabled(false);
          return;
        }

        // Call the currentTime method
        subtitleVideoPlayer.instance.currentTime(newStart);

        // Update timestamp display
        const timeDisplay = document.getElementById('current-timestamp');
        if (timeDisplay) {
          timeDisplay.textContent = secondsToSrtTime(newStart);
        }
      }
    } catch (err) {
      console.error('Error during subtitle shift:', err);
      setIsShiftingDisabled(false);
      return;
    }

    // Re-enable the shift buttons after a short delay
    // This is the key part - giving React time to process the state updates
    setTimeout(() => {
      setIsShiftingDisabled(false);
    }, 50);
  }

  async function handleMergeVideoWithSubtitles() {
    try {
      // Update global merge state
      mergeStates[sessionIdRef.current] = {
        inProgress: true,
        progress: 0,
        stage: 'Preparing files',
        completedTimestamp: 0
      };

      // Update UI state
      onSetIsMergingInProgress(true);
      onSetMergeProgress(0);
      onSetMergeStage('Preparing files');
      onSetError('');

      if (!videoFile) {
        onSetError('Video file is required for merging');
        mergeStates[sessionIdRef.current].inProgress = false;
        onSetIsMergingInProgress(false);
        return;
      }

      // Generate SRT from current subtitles
      const generatedSrt = generateSrtContent(subtitles);

      // Chunking logic for large files
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB, same as handleFileUpload
      const totalChunks = Math.ceil(videoFile.size / CHUNK_SIZE);
      const sessionId = `${Date.now()}-${videoFile.name.replace(
        /[^a-zA-Z0-9]/g,
        '_'
      )}`;
      const uploadedChunkIndexes = new Set(); // Track uploaded chunks

      // Function to upload a chunk with retries
      const uploadChunkWithRetry = async (
        chunk: Blob,
        chunkIndex: number,
        isLastChunk: boolean,
        generatedSrt: string,
        maxRetries = 3
      ) => {
        let retries = 0;
        while (retries < maxRetries) {
          try {
            const reader = new FileReader();
            const chunkArrayBuffer = await new Promise<ArrayBuffer>(
              (resolve, reject) => {
                const timeout = setTimeout(
                  () => reject(new Error('File read timed out')),
                  30000
                );
                reader.onload = () => {
                  clearTimeout(timeout);
                  resolve(reader.result as ArrayBuffer);
                };
                reader.onerror = () => {
                  clearTimeout(timeout);
                  reject(new Error('File read error'));
                };
                reader.readAsArrayBuffer(chunk);
              }
            );

            // Convert chunk to base64
            let binary = '';
            const bytes = new Uint8Array(chunkArrayBuffer);
            for (let i = 0; i < bytes.length; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            const chunkBase64 = `data:${videoFile.type};base64,${base64}`;

            // Call the chunk-handling merge endpoint
            const response = await mergeVideoWithSubtitles({
              chunk: chunkBase64,
              srtContent: isLastChunk ? generatedSrt : undefined, // Send SRT with last chunk
              sessionId,
              chunkIndex,
              totalChunks,
              contentType: videoFile.type,
              processVideo: isLastChunk, // Trigger merge on last chunk
              onProgress: (progress: number) => {
                const chunkProgress = progress / 100;
                const overallProgress = Math.round(
                  ((chunkIndex + chunkProgress) / totalChunks) * 100
                );

                // Update both UI and global state
                onSetMergeProgress(overallProgress);
                if (mergeStates[sessionIdRef.current]) {
                  mergeStates[sessionIdRef.current].progress = overallProgress;
                }

                if (isLastChunk && progress >= 99) {
                  const stageText = 'Merging video with subtitles';
                  onSetMergeStage(stageText);
                  if (mergeStates[sessionIdRef.current]) {
                    mergeStates[sessionIdRef.current].stage = stageText;
                  }
                  onSetMergeProgress(100);
                  if (mergeStates[sessionIdRef.current]) {
                    mergeStates[sessionIdRef.current].progress = 100;
                  }
                }
              }
            });

            if (!response || response.error) {
              throw new Error(response?.error || 'Chunk upload failed');
            }

            return response;
          } catch (error) {
            retries++;
            console.error(
              `Chunk ${chunkIndex} failed (attempt ${retries}/${maxRetries}):`,
              error
            );
            if (retries >= maxRetries) throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * Math.pow(2, retries))
            );

            const retryStage = `Retrying chunk ${
              chunkIndex + 1
            }/${totalChunks} (attempt ${retries + 1})`;
            onSetMergeStage(retryStage);
            if (mergeStates[sessionIdRef.current]) {
              mergeStates[sessionIdRef.current].stage = retryStage;
            }
          }
        }
      };

      // Upload each chunk
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, videoFile.size);
        const chunk = videoFile.slice(start, end);
        const isLastChunk = chunkIndex === totalChunks - 1;

        const uploadStage = `Uploading chunk ${
          chunkIndex + 1
        } of ${totalChunks}`;
        onSetMergeStage(uploadStage);
        if (mergeStates[sessionIdRef.current]) {
          mergeStates[sessionIdRef.current].stage = uploadStage;
        }

        const response = await uploadChunkWithRetry(
          chunk,
          chunkIndex,
          isLastChunk,
          generatedSrt
        );
        uploadedChunkIndexes.add(chunkIndex);

        if (isLastChunk && response.videoUrl) {
          // Verify all chunks uploaded
          if (uploadedChunkIndexes.size !== totalChunks) {
            const missing = Array.from(
              { length: totalChunks },
              (_, i) => i
            ).filter((i) => !uploadedChunkIndexes.has(i));
            throw new Error(`Missing chunks: ${missing.join(', ')}`);
          }

          const completeStage = 'Merging complete';
          onSetMergeStage(completeStage);

          // Mark as completed in global state - IMMEDIATELY set inProgress to false
          if (mergeStates[sessionIdRef.current]) {
            mergeStates[sessionIdRef.current].stage = completeStage;
            mergeStates[sessionIdRef.current].completedTimestamp = Date.now();
            mergeStates[sessionIdRef.current].progress = 100;
            mergeStates[sessionIdRef.current].inProgress = false; // Mark as not in progress immediately
          }

          // Just keep the UI showing for 2 seconds before hiding it
          setTimeout(() => {
            onSetIsMergingInProgress(false);
          }, 2000);
        }
      }
    } catch (error) {
      console.error('Error merging video with subtitles:', error);
      onSetError(
        error instanceof Error
          ? error.message
          : 'An error occurred while merging video with subtitles'
      );

      // Update both UI and global state to show error
      onSetIsMergingInProgress(false);
      if (mergeStates[sessionIdRef.current]) {
        mergeStates[sessionIdRef.current].inProgress = false;
        mergeStates[sessionIdRef.current].stage = 'Error occurred';
      }
    }
  }
}
