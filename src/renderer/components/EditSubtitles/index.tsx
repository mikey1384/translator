import React, { useEffect, useRef, useCallback, useState } from 'react';
import NativeVideoPlayer, { nativePlayer } from './NativeVideoPlayer';
import { css, cx } from '@emotion/css';
import Button from '../Button';
import SubtitleEditor from './SubtitleEditor';
import { debounce } from 'lodash';
import StylizedFileInput from '../StylizedFileInput';
import Section from '../Section';
import { sectionStyles } from '../../styles';
import { subtitleVideoPlayer } from '../../constants';
import { openSubtitleWithElectron } from '../../helpers/subtitle-utils';
import { saveFileWithRetry } from '../../helpers/electron-ipc';
import ElectronFileButton from '../ElectronFileButton';

// New consolidated imports from helper files
import {
  SrtSegment,
  srtTimeToSeconds,
  validateSubtitleTimings,
  secondsToSrtTime,
  parseSrt,
  generateSrtContent,
} from './utils';
import {
  handleInsertSubtitle,
  handleRemoveSubtitle,
  handleSaveSrt,
  handleSeekToSubtitle,
  processSrtContent,
} from './helpers';
import { useSubtitleNavigation, useRestoreFocus } from './hooks';
import { buttonGradientStyles, mergeButtonStyles } from './styles';
import { DEBOUNCE_DELAY_MS, DEFAULT_FILENAME } from './constants';

export interface EditSubtitlesProps {
  translationProgress: number;
  videoFile: File | null;
  videoUrl: string | null;
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

export default function EditSubtitles({
  translationProgress,
  videoFile,
  isPlaying: isPlayingProp,
  editingTimes: editingTimesProp,
  onSetVideoFile,
  onSetVideoUrl,
  onSetError,
  onSetIsPlaying,
  secondsToSrtTime: secondsToSrtTimeProp,
  parseSrt: parseSrtProp,
  subtitles: subtitlesProp,
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
  const [editingTimesState, setEditingTimesState] = useState<
    Record<string, string>
  >(editingTimesProp ? {} : {});
  const [isPlayingState, setIsPlayingState] = useState<boolean>(
    isPlayingProp || false
  );
  const [isMergingInProgressState, setIsMergingInProgressState] =
    useState<boolean>(isMergingInProgressProp || false);
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  // Track the original SRT file path for direct saving
  const [originalSrtFile, setOriginalSrtFile] = useState<File | null>(null);
  const [originalSrtPath, setOriginalSrtPath] = useState<string | null>(null);
  const [originalLoadPath, setOriginalLoadPath] = useState<string | null>(null);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergeStage, setMergeStage] = useState('');
  const [fileKey, setFileKey] = useState<number>(Date.now()); // Add back fileKey for file input resets

  const playTimeoutRef = useRef<number | null>(null);
  const debouncedTimeUpdateRef = useRef<Record<string, any>>({});
  const focusedInputRef = useRef<{
    index: number | null;
    field: 'start' | 'end' | 'text' | null;
  }>({
    index: null,
    field: null,
  });

  // Ref to track the subtitle elements
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Use imported fallback functions if props not provided
  const parseSrtFn = parseSrtProp || parseSrt;
  const srtTimeToSecondsFn = srtTimeToSeconds; // used in utils if needed
  const secondsToSrtTimeFn = secondsToSrtTimeProp || secondsToSrtTime;

  useEffect(() => {
    if (translationProgress) {
      setSubtitlesState(subtitlesProp);
    }
  }, [translationProgress]);

  // useEffect to validate and set subtitles on mount
  useEffect(() => {
    if (subtitlesProp && subtitlesProp.length > 0) {
      const validatedSubtitles = validateSubtitleTimings(subtitlesProp);
      setSubtitlesState(validatedSubtitles);
    }
  }, []);

  // Other useEffects remain unchanged
  useEffect(() => {
    if (subtitlesProp) {
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

  // Cleanup effect remains unchanged
  useEffect(() => {
    return () => {
      if (playTimeoutRef.current) {
        window.clearTimeout(playTimeoutRef.current);
        playTimeoutRef.current = null;
      }
    };
  }, []);

  // Check localStorage for originalSrtPath
  useEffect(() => {
    const savedPath = localStorage.getItem('originalSrtPath');
    if (savedPath && !originalSrtPath) {
      setOriginalSrtPath(savedPath);
    }
  }, []);

  // Updated handleTimeInputBlur, using DEBOUNCE_DELAY_MS in debounce
  const handleTimeInputBlur = useCallback(
    (index: number, field: 'start' | 'end') => {
      const editKey = `${index}-${field}`;
      const currentEditValue = editingTimesState[editKey];
      if (currentEditValue) {
        let numValue: number;
        if (
          typeof currentEditValue === 'string' &&
          currentEditValue.includes(':')
        ) {
          numValue = srtTimeToSecondsFn(currentEditValue);
        } else {
          numValue = parseFloat(currentEditValue);
        }
        if (!isNaN(numValue) && numValue >= 0) {
          const currentSub = subtitlesState[index];
          const prevSub = index > 0 ? subtitlesState[index - 1] : null;
          let isValid = true;
          let newEnd = currentSub.end;
          if (field === 'start') {
            if (prevSub && numValue < prevSub.start) {
              isValid = false;
            }
            if (numValue >= currentSub.end) {
              const originalDuration = currentSub.end - currentSub.start;
              newEnd = numValue + originalDuration;
            }
          }
          if (isValid) {
            if (field === 'start' && numValue >= currentSub.end) {
              setSubtitlesState(current =>
                current.map((sub, i) =>
                  i === index ? { ...sub, start: numValue, end: newEnd } : sub
                )
              );
            } else {
              setSubtitlesState(current =>
                current.map((sub, i) =>
                  i === index ? { ...sub, [field]: numValue } : sub
                )
              );
            }
          }
        }
      }
      setEditingTimesState(prev => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    [subtitlesState, editingTimesState, srtTimeToSecondsFn]
  );

  // Updated handleEditSubtitle to use useRestoreFocus hook
  const restoreFocus = useRestoreFocus(focusedInputRef);
  const handleEditSubtitle = useCallback(
    (
      index: number,
      field: 'start' | 'end' | 'text',
      value: number | string
    ) => {
      focusedInputRef.current = { index, field };
      if (field === 'text') {
        setSubtitlesState(current =>
          current.map((sub, i) =>
            i === index ? { ...sub, text: value as string } : sub
          )
        );
        return;
      }
      setEditingTimesState(prev => ({
        ...prev,
        [`${index}-${field}`]: value as string,
      }));
      const debounceKey = `${index}-${field}`;
      if (!debouncedTimeUpdateRef.current[debounceKey]) {
        debouncedTimeUpdateRef.current[debounceKey] = debounce(
          (value: string) => {
            let numValue: number;
            if (typeof value === 'string' && value.includes(':')) {
              numValue = srtTimeToSecondsFn(value);
            } else {
              numValue = parseFloat(value as string);
            }
            if (isNaN(numValue) || numValue < 0) {
              return;
            }
            const currentSub = subtitlesState[index];
            const prevSub = index > 0 ? subtitlesState[index - 1] : null;
            if (field === 'start') {
              if (prevSub && numValue < prevSub.start) return;
              let newEnd = currentSub.end;
              if (numValue >= currentSub.end) {
                const originalDuration = currentSub.end - currentSub.start;
                newEnd = numValue + originalDuration;
              }
              setSubtitlesState(current =>
                current.map((sub, i) =>
                  i === index ? { ...sub, start: numValue, end: newEnd } : sub
                )
              );
            } else {
              setSubtitlesState(current =>
                current.map((sub, i) =>
                  i === index ? { ...sub, [field]: numValue } : sub
                )
              );
            }
            setTimeout(restoreFocus, 50);
          },
          DEBOUNCE_DELAY_MS
        );
      }
      debouncedTimeUpdateRef.current[debounceKey](value);
    },
    [subtitlesState, srtTimeToSecondsFn, restoreFocus]
  );

  // Remove inline definitions of findCurrentSubtitle and scrollToCurrentSubtitle and use the hook instead
  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    subtitlesState,
    subtitleRefs
  );

  useEffect(() => {
    if (editorRef && editorRef.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
    }
  }, [editorRef, scrollToCurrentSubtitle]);

  // In handleSaveEditedSrtAs, replace hardcoded filename with DEFAULT_FILENAME
  async function handleSaveEditedSrtAs(
    event?: React.MouseEvent,
    customFilename?: string
  ) {
    try {
      const suggestedName =
        customFilename || originalSrtFile?.name || DEFAULT_FILENAME;
      const srtContent = generateSrtContent(subtitlesState);
      const saveOptions = {
        title: 'Save SRT File As',
        defaultPath: suggestedName,
        filters: [{ name: 'SRT Files', extensions: ['srt'] }],
        content: srtContent,
        forceDialog: true,
      };
      try {
        const result = await saveFileWithRetry(saveOptions);
        if (result?.filePath) {
          setOriginalSrtPath(result.filePath);
          localStorage.setItem('originalSrtPath', result.filePath);
          localStorage.setItem('originalLoadPath', result.filePath);
          localStorage.setItem('targetPath', result.filePath);
          alert(`File saved successfully to:\n${result.filePath}`);
          if (originalSrtFile) {
            setOriginalSrtFile(null);
          }
        } else if (result.error && !result.error.includes('canceled')) {
          onSetError(`Save failed: ${result.error}`);
        }
      } catch (saveError: any) {
        onSetError(`Save failed: ${saveError.message || String(saveError)}`);
      }
      return;
    } catch (error: any) {
      onSetError(`Error saving SRT file: ${error.message || String(error)}`);
    }
  }

  // Player ready handler
  function handlePlayerReady(player: HTMLVideoElement) {
    if (!player) {
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
    player.addEventListener('play', handlePlay);
    player.addEventListener('playing', handlePlay); // additional event for more reliability
    player.addEventListener('pause', handlePause);
    player.addEventListener('ended', handleEnded);

    // Set initial state based on player
    setIsPlayingState(!player.paused);

    // Return cleanup function to remove these listeners when component unmounts or when player changes
    return () => {
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('playing', handlePlay);
      player.removeEventListener('pause', handlePause);
      player.removeEventListener('ended', handleEnded);
    };

    // Handle time updates
    player.addEventListener('timeupdate', () => {
      const timeDisplay = document.getElementById('current-timestamp');
      if (timeDisplay && player) {
        try {
          const currentTime = player.currentTime;
          // Display time in SRT format
          if (currentTime !== undefined && !isNaN(currentTime)) {
            timeDisplay.textContent = secondsToSrtTimeFn(currentTime);
          }
        } catch (err) {
          console.error('Error updating timestamp display:', err);
        }
      }
    });

    // Add error handler
    player.addEventListener('error', () => {
      console.error('Video player error:', player.error);
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
        console.error('Error pausing player:', err);
      }
      return;
    }

    try {
      // Ensure startTime is a valid number before using it
      const validStartTime =
        typeof startTime === 'number' && !isNaN(startTime) ? startTime : 0;
      const validEndTime =
        typeof endTime === 'number' && !isNaN(endTime)
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
        console.error('Error getting current time:', err);
      }

      // If we're already within this subtitle's time range, play from current position
      if (currentPosition >= validStartTime && currentPosition < validEndTime) {
        playFromCurrentPosition(currentPosition, validEndTime);
      } else {
        // Only seek if we're not in the subtitle range

        try {
          // Find the track element to reset it before seeking
          if (nativePlayer.instance) {
            const trackElement = nativePlayer.instance.querySelector('track');
            // Temporarily hide track to clear displayed cues
            if (trackElement && trackElement.track) {
              const currentMode = trackElement.track.mode;
              trackElement.track.mode = 'hidden';

              // Perform the seek
              nativePlayer.instance.currentTime = validStartTime;

              // Restore track mode after a short delay
              setTimeout(() => {
                if (trackElement && trackElement.track) {
                  trackElement.track.mode = currentMode;
                }

                const actualPosition = nativePlayer.getCurrentTime();
                playFromCurrentPosition(actualPosition, validEndTime);
              }, 200);
            } else {
              // Fallback if track element not found
              nativePlayer.instance.currentTime = validStartTime;

              setTimeout(() => {
                const actualPosition = nativePlayer.getCurrentTime();
                playFromCurrentPosition(actualPosition, validEndTime);
              }, 200);
            }
          } else {
            // Use the nativePlayer.seek method (which includes track handling)
            nativePlayer.seek(validStartTime);

            setTimeout(() => {
              const actualPosition = nativePlayer.getCurrentTime();
              playFromCurrentPosition(actualPosition, validEndTime);
            }, 200);
          }
        } catch (seekErr) {
          console.error('Error during seek:', seekErr);
          // Fall back to playing from start time even if seek fails
          playFromCurrentPosition(validStartTime, validEndTime);
        }
      }
    } catch (err) {
      console.error('Error during subtitle playback:', err);
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
      console.error('Error getting current time before play:', err);
    }

    // Play from that position with proper error handling
    try {
      // Try to play using both direct DOM API and the wrapper function
      const playPromise = nativePlayer.instance
        ? nativePlayer.instance.play()
        : nativePlayer.play();

      playPromise
        .then(() => {
          setIsPlayingState(true);

          // Recalculate the actual duration based on current position
          const duration = Math.max(0, (endTime - actualCurrentTime) * 1000); //

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
              } catch (err) {
                console.error('Error pausing player after timeout:', err);
              } finally {
                playTimeoutRef.current = null;
              }
            }, duration);
          }
        })
        .catch(err => {
          console.error('Error starting playback:', err);
          setIsPlayingState(false);

          // Try direct play as fallback if the promise-based approach fails
          try {
            if (nativePlayer.instance) {
              nativePlayer.instance.play();
              setIsPlayingState(true);
            }
          } catch (directErr) {
            console.error('Fallback play method also failed:', directErr);
          }
        });
    } catch (err) {
      console.error('Unexpected error during play operation:', err);
      setIsPlayingState(false);

      // Last resort attempt using a timeout to try again
      setTimeout(() => {
        try {
          if (nativePlayer.instance) {
            nativePlayer.instance.play();
            setIsPlayingState(true);
          }
        } catch (finalErr) {
          console.error('All play attempts failed:', finalErr);
        }
      }, 200);
    }
  }

  function handleShiftSubtitle(index: number, shiftSeconds: number) {
    if (isShiftingDisabled) return;

    // Disable shifting during processing to prevent rapid clicks
    setIsShiftingDisabled(true);

    try {
      // Get the current subtitle
      const sub = subtitlesState[index];
      if (!sub) {
        console.error('Subtitle not found at index:', index);
        setIsShiftingDisabled(false);
        return;
      }

      // Calculate new start and end times
      const newStart = Math.max(0, sub.start + shiftSeconds);
      const duration = sub.end - sub.start;
      const newEnd = newStart + duration;

      // Update the subtitle
      setSubtitlesState(current =>
        current.map((s, i) =>
          i === index ? { ...s, start: newStart, end: newEnd } : s
        )
      );

      // If we have a player, seek to the new position to show the change
      try {
        nativePlayer.seek(newStart);
      } catch (err) {
        console.error('Error seeking to new position after shift:', err);
      }

      // Re-enable shifting
      setTimeout(() => {
        setIsShiftingDisabled(false);
      }, 100);
    } catch (err) {
      console.error('Error shifting subtitle:', err);
      setIsShiftingDisabled(false);
    }
  }

  async function handleMergeVideoWithSubtitles() {
    if (!videoFile || subtitlesState.length === 0) {
      onSetError('Please upload a video file and subtitle file first');
      return;
    }

    try {
      // Update UI state
      setIsMergingInProgressState(true);
      setMergeProgress(0);
      setMergeStage('Preparing files');
      onSetError('');

      // Call the merger function
      await mergeSubtitlesWithVideo(videoFile, subtitlesState, {
        onProgress: progress => {
          setMergeProgress(progress);
          if (progress >= 99) {
            setMergeStage('Merging complete');
          } else if (progress >= 50) {
            setMergeStage('Merging video with subtitles');
          } else if (progress >= 10) {
            setMergeStage('Processing video');
          }
        },
      });

      setMergeStage('Merging complete');

      // Keep UI showing completion for 2 seconds
      setTimeout(() => {
        setIsMergingInProgressState(false);
      }, 2000);
    } catch (error) {
      console.error('Error merging video with subtitles:', error);
      onSetError(
        error instanceof Error
          ? error.message
          : 'An error occurred while merging video with subtitles'
      );
      setIsMergingInProgressState(false);
      setMergeStage('Error occurred');
    }
  }

  // Add an effect to automatically update subtitles whenever they change
  useEffect(() => {
    if (subtitlesState.length > 0) {
      // Use videoPlayerRef from props if available
      if (videoPlayerRef && typeof videoPlayerRef.currentTime === 'function') {
        try {
          const currentTime = videoPlayerRef.currentTime();
          videoPlayerRef.currentTime(currentTime);
        } catch (e) {
          console.warn('Error updating player time:', e);
        }
      }
      // Fallback to subtitleVideoPlayer global if available
      else if (
        subtitleVideoPlayer &&
        subtitleVideoPlayer.instance &&
        typeof subtitleVideoPlayer.instance.currentTime === 'function'
      ) {
        try {
          const currentTime = subtitleVideoPlayer.instance.currentTime();
          subtitleVideoPlayer.instance.currentTime(currentTime);
        } catch (e) {
          console.warn('Error updating global player time:', e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesState]);

  return (
    <Section title="Edit Subtitles" overflowVisible={true}>
      {/* File input fields - Show when not in extraction mode or when video is loaded but no subtitles */}
      {(!videoFile || (videoFile && subtitlesState.length === 0)) && (
        <div style={{ marginBottom: 20 }}>
          {!videoFile && (
            <div style={{ marginBottom: 10 }}>
              <StylizedFileInput
                accept="video/*"
                onChange={e => {
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
            <ElectronFileButton
              label="Load SRT:"
              buttonText="Choose SRT File"
              onClick={async () => {
                await openSubtitleWithElectron(
                  (_, content, segments, filePath) => {
                    setSubtitlesState(segments);
                    setOriginalLoadPath(filePath);

                    // Process the content directly
                    processSrtContent(
                      content,
                      parseSrtFn,
                      setSubtitlesState,
                      setEditingTimesState,
                      onSetError
                    );
                  },
                  error => {
                    console.error(
                      'EditSubtitles: Error opening subtitle:',
                      error
                    );
                    onSetError(`Failed to open SRT file: ${error}`);
                  }
                );
              }}
            />
          </div>
        </div>
      )}

      {subtitlesState.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
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
                ref={el => {
                  subtitleRefs.current[index] = el;
                }}
              >
                <SubtitleEditor
                  key={`subtitle-${index}-${sub.start}-${sub.end}`}
                  sub={sub}
                  index={index}
                  editingTimes={editingTimesState}
                  isPlaying={isPlayingState}
                  secondsToSrtTime={secondsToSrtTimeFn}
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
            onClick={handleSaveSrt}
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
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
            Save
          </Button>

          <Button onClick={handleSaveEditedSrtAs} variant="secondary" size="lg">
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
            Save As
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

      {/* Progress display for merging */}
      {isMergingInProgressState && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            padding: '20px',
            width: '80%',
            maxWidth: '500px',
            zIndex: 1000,
          }}
        >
          <h3>Merging Video with Subtitles</h3>
          <div>{mergeStage}</div>
          <div
            style={{
              width: '100%',
              height: '20px',
              backgroundColor: '#f0f0f0',
              borderRadius: '10px',
              overflow: 'hidden',
              marginTop: '10px',
            }}
          >
            <div
              style={{
                width: `${mergeProgress}%`,
                height: '100%',
                backgroundColor: '#4361ee',
                borderRadius: '10px',
                transition: 'width 0.3s ease-in-out',
              }}
            />
          </div>
          <div
            style={{
              textAlign: 'right',
              marginTop: '5px',
              fontSize: '14px',
            }}
          >
            {mergeProgress}%
          </div>
        </div>
      )}
    </Section>
  );
}
