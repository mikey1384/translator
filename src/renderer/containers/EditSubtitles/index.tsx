import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  SetStateAction,
  Dispatch,
} from 'react';
import { css } from '@emotion/css';
import Button from '../../components/Button';
import Section from '../../components/Section';
import StylizedFileInput from '../../components/StylizedFileInput';
import ElectronFileButton from '../../components/ElectronFileButton';

import SubtitleEditor from './SubtitleEditor';
import { nativePlayer } from '../../components/NativeVideoPlayer';
import { subtitleVideoPlayer } from '../../constants';

import { debounce } from 'lodash';
import { saveFileWithRetry } from '../../helpers/electron-ipc';
import {
  openSubtitleWithElectron,
  buildSrt,
  fixOverlappingSegments,
} from '../../helpers/subtitle-utils';

import {
  srtTimeToSeconds,
  secondsToSrtTime,
  generateSrtContent,
} from './utils';
import {
  handleInsertSubtitle,
  handleRemoveSubtitle,
  handleSaveSrt,
} from './helpers';
import { useSubtitleNavigation, useRestoreFocus } from './hooks';
import {
  buttonGradientStyles,
  mergeButtonStyles as mergeButtonClass,
} from './styles';
import { DEBOUNCE_DELAY_MS, DEFAULT_FILENAME } from './constants';
import { colors } from '../../constants';

import { SrtSegment } from '../../../types/interface';
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../../constants/subtitle-styles';

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  onSetVideoFile: (file: File) => void;
  onSetVideoUrl: (url: string | null) => void;
  isPlaying?: boolean;
  editingTimes?: { start: number; end: number } | null;
  onSetIsPlaying?: (isPlaying: boolean) => void;
  secondsToSrtTime?: (seconds: number) => string;
  parseSrt?: (srtString: string) => SrtSegment[];
  subtitles?: SrtSegment[];
  videoPlayerRef?: any;
  isMergingInProgress?: boolean;
  setMergeProgress: React.Dispatch<React.SetStateAction<number>>;
  setMergeStage: React.Dispatch<React.SetStateAction<string>>;
  setIsMergingInProgress: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef?: React.RefObject<{ scrollToCurrentSubtitle: () => void }>;
  onSetSubtitlesDirectly?: Dispatch<SetStateAction<SrtSegment[]>>;
}

const mergeOptionsStyles = css`
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
`;

const fontSizeInputStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.grayLight};
  border-radius: 4px;
  font-size: 1rem;
  width: 80px;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px ${colors.primaryLight};
  }
`;

const fontSizeLabelStyles = css`
  font-weight: 500;
  color: ${colors.grayDark};
`;

// Add style for the select dropdown
const styleSelectStyles = css`
  padding: 0.5rem 0.75rem;
  border: 1px solid ${colors.grayLight};
  border-radius: 4px;
  font-size: 1rem;
  background-color: white;
  cursor: pointer;
  &:focus {
    outline: none;
    border-color: ${colors.primary};
    box-shadow: 0 0 0 2px ${colors.primaryLight};
  }
`;

// --- Local Styles Definition --- END

export function EditSubtitles({
  videoFile,
  onSetVideoFile,
  onSetVideoUrl,
  isPlaying: isPlayingProp,
  secondsToSrtTime: secondsToSrtTimeProp,
  subtitles: subtitlesProp,
  videoPlayerRef,
  isMergingInProgress: isMergingInProgressProp,
  setMergeProgress,
  setMergeStage,
  setIsMergingInProgress,
  editorRef,
  onSetSubtitlesDirectly,
}: EditSubtitlesProps) {
  /**
   * ------------------------------------------------------
   * State Management
   * ------------------------------------------------------
   */
  const [subtitlesState, setSubtitlesState] = useState<SrtSegment[]>(
    subtitlesProp || []
  );
  const [editingTimesState, setEditingTimesState] = useState<
    Record<string, string>
  >({});
  const [isPlayingState, setIsPlayingState] = useState<boolean>(
    isPlayingProp || false
  );
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  const [originalSrtFile, setOriginalSrtFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const [mergeFontSize, setMergeFontSize] = useState<number>(24);
  const [mergeStylePreset, setMergeStylePreset] =
    useState<AssStylePresetKey>('Default');

  // For controlling a timed auto‐pause
  const playTimeoutRef = useRef<number | null>(null);

  // Debounced references
  const debouncedTimeUpdateRef = useRef<
    Record<string, ReturnType<typeof debounce>>
  >({});

  // Used to restore focus after editing
  const focusedInputRef = useRef<{
    index: number | null;
    field: 'start' | 'end' | 'text' | null;
  }>({ index: null, field: null });

  // Subtitle DOM references
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);

  // If the user passed in a custom `secondsToSrtTime`, use that; otherwise fallback
  const secondsToSrtTimeFn = secondsToSrtTimeProp || secondsToSrtTime;

  // New ref for current merge operation ID
  const currentMergeOperationIdRef = useRef<string | null>(null);

  // State to track if original path exists for enabling/disabling Save button
  const [canSaveDirectly, setCanSaveDirectly] = useState(false);

  /**
   * ------------------------------------------------------
   * Initialization & Updates
   * ------------------------------------------------------
   */
  // Check localStorage for original path on mount and when subtitles change
  useEffect(() => {
    const path = localStorage.getItem('originalSrtPath');
    setCanSaveDirectly(!!path);
  }, [subtitlesState]); // Re-check if subtitles change, might indicate a 'Save As' happened

  // Keep local subtitlesState in sync when the prop changes
  useEffect(() => {
    if (subtitlesProp) {
      setSubtitlesState(subtitlesProp);
    }
  }, [subtitlesProp]);

  // Keep local isPlayingState in sync
  useEffect(() => {
    if (typeof isPlayingProp !== 'undefined') {
      setIsPlayingState(isPlayingProp);
    }
  }, [isPlayingProp]);

  /**
   *  For dynamic sub updates, attempt to keep the external
   *  or global player in sync
   */
  useEffect(() => {
    if (subtitlesState.length > 0) {
      // Use the videoPlayerRef from props if available
      if (videoPlayerRef && typeof videoPlayerRef.currentTime === 'function') {
        try {
          const currentTime = videoPlayerRef.currentTime();
          videoPlayerRef.currentTime(currentTime);
        } catch (e) {
          // console.warn('Error updating player time via videoPlayerRef:', e);
        }
      }
      // Otherwise use the global reference from subtitleVideoPlayer
      else if (
        subtitleVideoPlayer &&
        subtitleVideoPlayer.instance &&
        typeof subtitleVideoPlayer.instance.currentTime === 'function'
      ) {
        try {
          const currentTime = subtitleVideoPlayer.instance.currentTime();
          subtitleVideoPlayer.instance.currentTime(currentTime);
        } catch (e) {
          // console.warn('Error updating global player time:', e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesState]);

  /**
   * ------------------------------------------------------
   * Subtitle Editing Logic
   * ------------------------------------------------------
   */
  const restoreFocus = useRestoreFocus(focusedInputRef);

  const handleTimeInputBlur = useCallback(
    (index: number, field: 'start' | 'end') => {
      const editKey = `${index}-${field}`;
      const currentEditValue = editingTimesState[editKey];
      if (!currentEditValue) {
        // If there's no stored time string, do nothing
        return;
      }

      let numValue: number;
      // Support HH:MM:SS or numeric
      if (currentEditValue.includes(':')) {
        numValue = srtTimeToSeconds(currentEditValue);
      } else {
        numValue = parseFloat(currentEditValue);
      }

      if (isNaN(numValue) || numValue < 0) {
        // If invalid or negative, revert
        setEditingTimesState(prev => {
          const newTimes = { ...prev };
          delete newTimes[editKey];
          return newTimes;
        });
        return;
      }

      const currentSub = subtitlesState[index];
      if (!currentSub) return;

      const prevSub = index > 0 ? subtitlesState[index - 1] : null;
      let newEnd = currentSub.end;

      // If editing start, check special conditions
      if (field === 'start') {
        // If user typed something smaller than the previous sub's start
        if (prevSub && numValue < prevSub.start) {
          // Not strictly an error, but you can handle it if you want
        }
        // If the new start is beyond or equal to the old end, shift the end
        if (numValue >= currentSub.end) {
          const originalDuration = currentSub.end - currentSub.start;
          newEnd = numValue + originalDuration;
        }
      }

      setSubtitlesState(current =>
        current.map((sub, i) => {
          if (i !== index) return sub;
          return field === 'start'
            ? { ...sub, start: numValue, end: newEnd }
            : { ...sub, end: numValue };
        })
      );

      // Clean up the "editingTimesState" for this field
      setEditingTimesState(prev => {
        const newTimes = { ...prev };
        delete newTimes[editKey];
        return newTimes;
      });
    },
    [editingTimesState, subtitlesState]
  );

  const handleEditSubtitle = useCallback(
    (
      index: number,
      field: 'start' | 'end' | 'text',
      value: number | string
    ) => {
      // Save the current input for potential re-focus after updates
      focusedInputRef.current = { index, field };

      // If editing the text, just set immediately
      if (field === 'text') {
        setSubtitlesState(current =>
          current.map((sub, i) =>
            i === index ? { ...sub, text: value as string } : sub
          )
        );
        return;
      }

      // Otherwise, we are editing start/end
      setEditingTimesState(prev => ({
        ...prev,
        [`${index}-${field}`]: String(value),
      }));

      const debounceKey = `${index}-${field}`;
      if (!debouncedTimeUpdateRef.current[debounceKey]) {
        debouncedTimeUpdateRef.current[debounceKey] = debounce(
          (val: string) => {
            let numValue: number;
            if (val.includes(':')) {
              numValue = srtTimeToSeconds(val);
            } else {
              numValue = parseFloat(val);
            }
            if (isNaN(numValue) || numValue < 0) return;

            const currentSub = subtitlesState[index];
            if (!currentSub) return;

            const prevSub = index > 0 ? subtitlesState[index - 1] : null;
            let newEnd = currentSub.end;

            // If we're editing start time
            if (field === 'start') {
              if (prevSub && numValue < prevSub.start) {
                // Could handle overlap or do nothing
              }
              // If user moves start beyond end, shift end
              if (numValue >= currentSub.end) {
                const duration = currentSub.end - currentSub.start;
                newEnd = numValue + duration;
              }
              setSubtitlesState(curr =>
                curr.map((sub, i) => {
                  if (i !== index) return sub;
                  return { ...sub, start: numValue, end: newEnd };
                })
              );
            }
            // If we're editing end time
            else {
              setSubtitlesState(curr =>
                curr.map((sub, i) =>
                  i === index ? { ...sub, end: numValue } : sub
                )
              );
            }

            // Attempt to restore cursor/focus after a tiny delay
            setTimeout(() => restoreFocus(), 50);
          },
          DEBOUNCE_DELAY_MS
        );
      }

      // Trigger the debounced function
      debouncedTimeUpdateRef.current[debounceKey](String(value));
    },
    [subtitlesState, restoreFocus]
  );

  /**
   * ------------------------------------------------------
   * Navigation: highlight or scroll to current subtitle
   * ------------------------------------------------------
   */
  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    subtitlesState,
    subtitleRefs,
    videoPlayerRef
  );

  // If an external editorRef is provided, expose `scrollToCurrentSubtitle`
  useEffect(() => {
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
    }
  }, [editorRef, scrollToCurrentSubtitle]);

  // --- NEW Seek Handler ---
  const seekPlayerToTime = useCallback(
    (time: number) => {
      if (videoPlayerRef && typeof videoPlayerRef.seek === 'function') {
        try {
          videoPlayerRef.seek(time);
        } catch (error) {
          console.error('Error seeking player via ref:', error);
        }
      } else if (
        nativePlayer &&
        nativePlayer.instance &&
        typeof nativePlayer.seek === 'function'
      ) {
        // Fallback just in case, though should prioritize ref
        try {
          nativePlayer.seek(time);
        } catch (error) {
          console.error('Error seeking player via global nativePlayer:', error);
        }
      }
    },
    [videoPlayerRef] // Depend on videoPlayerRef state
  );

  /**
   * ------------------------------------------------------
   * Save & Merge Functionality
   * ------------------------------------------------------
   */
  return (
    <Section title="Edit Subtitles" overflowVisible>
      {/* Error display */}
      {error && (
        <div
          className={css`
            color: #dc3545;
            background-color: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 4px;
            padding: 12px;
            margin-bottom: 16px;
            font-size: 14px;
          `}
        >
          {error}
        </div>
      )}

      {/* If no video or no subtitles loaded yet, show these inputs */}
      {(!videoFile || (videoFile && subtitlesState.length === 0)) && (
        <div style={{ marginBottom: 20 }}>
          {!videoFile && (
            <div style={{ marginBottom: 10 }}>
              <StylizedFileInput
                accept="video/*"
                onChange={e => {
                  if (e.target.files?.[0]) {
                    onSetVideoFile(e.target.files[0]);
                    // Create an object URL for the new file
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
                const result = await openSubtitleWithElectron();
                if (result.error) {
                  setError(`Error loading SRT: ${result.error}`);
                  if (result.error.includes('canceled')) {
                    // Optional: Clear error if user just canceled
                    setError('');
                  }
                } else if (result.segments && onSetSubtitlesDirectly) {
                  // Call the new prop to update App.tsx state
                  onSetSubtitlesDirectly(result.segments);
                  // Optionally also update local state if needed, though App.tsx should propagate
                  setError(''); // Clear any previous error
                }
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
                key={sub.index}
                ref={el => {
                  subtitleRefs.current[index] = el;
                }}
              >
                <SubtitleEditor
                  key={sub.index}
                  sub={sub}
                  index={index}
                  editingTimes={editingTimesState}
                  isPlaying={isPlayingState}
                  secondsToSrtTime={secondsToSrtTimeFn}
                  onEditSubtitle={handleEditSubtitle}
                  onTimeInputBlur={handleTimeInputBlur}
                  onRemoveSubtitle={handleRemoveSubtitleLocal}
                  onInsertSubtitle={handleInsertSubtitleLocal}
                  onSeekToSubtitle={seekPlayerToTime}
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
            align-items: center;
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
            disabled={!canSaveDirectly}
            title={
              !canSaveDirectly
                ? 'Save As first to enable direct save'
                : 'Save changes to original file'
            }
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

          {/* --- Merge Section --- */}
          <div className={mergeOptionsStyles}>
            {/* Font Size Input */}
            <label className={fontSizeLabelStyles} htmlFor="mergeFontSizeInput">
              Font Size:
            </label>
            <input
              id="mergeFontSizeInput"
              type="number"
              className={fontSizeInputStyles}
              value={mergeFontSize}
              onChange={e =>
                setMergeFontSize(parseInt(e.target.value, 10) || 0)
              }
              min="10"
              max="72"
            />

            {/* Style Preset Select */}
            <label
              className={fontSizeLabelStyles}
              htmlFor="mergeStylePresetSelect"
            >
              Style:
            </label>
            <select
              id="mergeStylePresetSelect"
              className={styleSelectStyles}
              value={mergeStylePreset}
              onChange={e =>
                setMergeStylePreset(e.target.value as AssStylePresetKey)
              }
              disabled={isMergingInProgressProp}
            >
              {(Object.keys(ASS_STYLE_PRESETS) as AssStylePresetKey[]).map(
                key => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                )
              )}
            </select>

            {/* Merge Button (Keep existing button logic here) */}
            <Button
              className={mergeButtonClass}
              onClick={() => {
                if (videoFile && subtitlesState.length > 0) {
                  handleMergeVideoWithSubtitles(videoFile, subtitlesState);
                } else {
                  setError('Video file and subtitles are required to merge.');
                }
              }}
              disabled={
                !videoFile ||
                subtitlesState.length === 0 ||
                isMergingInProgressProp
              }
              isLoading={isMergingInProgressProp}
            >
              {isMergingInProgressProp
                ? 'Merging...'
                : 'Merge Subtitles to Video'}
            </Button>
          </div>
        </div>
      )}
    </Section>
  );

  // --- Helper Functions ---

  async function handleSaveEditedSrtAs() {
    try {
      const suggestedName = originalSrtFile?.name || DEFAULT_FILENAME;
      const srtContent = generateSrtContent(subtitlesState);

      const saveOptions = {
        title: 'Save SRT File As',
        defaultPath: suggestedName,
        filters: [{ name: 'SRT Files', extensions: ['srt'] }],
        content: srtContent,
        forceDialog: true,
      };

      const result = await saveFileWithRetry(saveOptions);
      if (result?.filePath) {
        localStorage.setItem('originalSrtPath', result.filePath);
        localStorage.setItem('originalLoadPath', result.filePath);
        localStorage.setItem('targetPath', result.filePath);
        setCanSaveDirectly(true);

        alert(`File saved successfully to:\n${result.filePath}`);

        if (originalSrtFile) {
          setOriginalSrtFile(null);
        }
      } else if (result.error && !result.error.includes('canceled')) {
        setError(`Save failed: ${result.error}`);
      }
    } catch (error: any) {
      setError(`Error saving SRT file: ${error.message || String(error)}`);
    }
  }

  function handlePlaySubtitle(startTime: number, endTime: number) {
    if (playTimeoutRef.current) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }

    if (isPlayingState) {
      try {
        nativePlayer.pause();
      } catch (err) {
        // console.error('Error pausing player:', err);
      }
      setIsPlayingState(false);
      return;
    }

    try {
      const validStartTime = isNaN(startTime) ? 0 : startTime;
      const validEndTime = isNaN(endTime) ? validStartTime + 3 : endTime;

      let currentPosition = 0;
      if (nativePlayer.instance) {
        currentPosition = nativePlayer.instance.currentTime;
      } else {
        currentPosition = nativePlayer.getCurrentTime();
      }

      if (currentPosition >= validStartTime && currentPosition < validEndTime) {
        playFromCurrentPosition(currentPosition, validEndTime);
      } else {
        if (nativePlayer.instance) {
          const trackElement = nativePlayer.instance.querySelector('track');
          if (trackElement && trackElement.track) {
            const oldMode = trackElement.track.mode;
            trackElement.track.mode = 'hidden';

            nativePlayer.instance.currentTime = validStartTime;

            setTimeout(() => {
              trackElement.track.mode = oldMode;
              playFromCurrentPosition(
                nativePlayer.instance!.currentTime,
                validEndTime
              );
            }, 200);
          } else {
            nativePlayer.instance.currentTime = validStartTime;
            setTimeout(() => {
              playFromCurrentPosition(
                nativePlayer.instance!.currentTime,
                validEndTime
              );
            }, 200);
          }
        } else {
          nativePlayer.seek(validStartTime);
          setTimeout(() => {
            playFromCurrentPosition(
              nativePlayer.getCurrentTime(),
              validEndTime
            );
          }, 200);
        }
      }
    } catch (err) {
      // console.error('Error during subtitle playback:', err);
      setIsPlayingState(false);
    }
  }

  function playFromCurrentPosition(startTime: number, endTime: number) {
    let actualTime = startTime;
    try {
      if (nativePlayer.instance) {
        actualTime = nativePlayer.instance.currentTime;
      } else {
        actualTime = nativePlayer.getCurrentTime();
      }
    } catch (err) {
      // console.error('Error retrieving current time:', err);
    }

    try {
      const playPromise = nativePlayer.instance
        ? nativePlayer.instance.play()
        : nativePlayer.play();
      playPromise
        .then(() => {
          setIsPlayingState(true);

          const durationMs = (endTime - actualTime) * 1000;
          if (durationMs > 0) {
            playTimeoutRef.current = window.setTimeout(() => {
              try {
                if (nativePlayer.instance) {
                  nativePlayer.instance.pause();
                } else {
                  nativePlayer.pause();
                }
              } catch (err) {
                // console.error('Error pausing after snippet playback:', err);
              }
              setIsPlayingState(false);
              playTimeoutRef.current = null;
            }, durationMs);
          }
        })
        .catch(_error => {
          // console.error('Error starting playback:', _error);
          setIsPlayingState(false);
        });
    } catch (err) {
      // console.error('Unexpected error in playFromCurrentPosition:', err);
      setIsPlayingState(false);
    }
  }

  function handleShiftSubtitle(index: number, shiftSeconds: number) {
    if (isShiftingDisabled) return;

    setIsShiftingDisabled(true);
    try {
      const sub = subtitlesState[index];
      if (!sub) {
        // console.error(`No subtitle found at index ${index}`);
        setIsShiftingDisabled(false);
        return;
      }
      const newStart = Math.max(0, sub.start + shiftSeconds);
      const duration = sub.end - sub.start;
      const newEnd = newStart + duration;

      setSubtitlesState(current =>
        current.map((s, i) =>
          i === index ? { ...s, start: newStart, end: newEnd } : s
        )
      );

      try {
        nativePlayer.seek(newStart);
      } catch (seekError) {
        // console.error('Error seeking after shiftSubtitle:', seekError);
      }

      setTimeout(() => {
        setIsShiftingDisabled(false);
      }, 100);
    } catch (err) {
      // console.error('Error shifting subtitle:', err);
      setIsShiftingDisabled(false);
    }
  }

  async function handleMergeVideoWithSubtitles(
    videoFile: File,
    subtitles: SrtSegment[]
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    // Generate operationId here
    const operationId = `merge-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    currentMergeOperationIdRef.current = operationId; // Set the ref immediately

    setIsMergingInProgress(true);
    setMergeProgress(0);
    setMergeStage('Preparing subtitle file...');
    let tempMergedFilePath: string | null = null; // Keep track of the temp file
    let cleanupMergeListener: (() => void) | null = null; // For listener cleanup

    try {
      // Setup Progress Listener
      const handleProgress = (_event: any, progress: any) => {
        if (progress?.operationId === operationId) {
          // console.log(
          //   `[Renderer] Received progress for ${operationId}:`,
          //   progress
          // ); // Remove log
          setMergeProgress(progress.percent);
          setMergeStage(progress.stage);
        }
      };

      if (window.electron?.onMergeSubtitlesProgress) {
        window.electron.onMergeSubtitlesProgress(handleProgress);
        cleanupMergeListener = () => {
          // console.log(
          //   `[Renderer] Cleaning up merge listener for ${operationId}`
          // ); // Remove log
          window.electron.onMergeSubtitlesProgress(null);
        };
      } else {
        console.warn(
          '[Renderer] window.electron.onMergeSubtitlesProgress not available'
        );
      }

      const srtContent = buildSrt(fixOverlappingSegments(subtitles));

      // Start Merge Process
      setMergeStage('Starting merge process...');

      // Call Electron merge function
      const mergeResult = await window.electron.mergeSubtitles({
        videoFile: videoFile,
        srtContent: srtContent,
        operationId: operationId,
        fontSize: mergeFontSize,
        stylePreset: mergeStylePreset,
      });

      if (!mergeResult?.success || !mergeResult.tempOutputPath) {
        throw new Error(
          `Merge process failed: ${mergeResult?.error || 'Unknown merge error'}`
        );
      }

      tempMergedFilePath = mergeResult.tempOutputPath; // Store temp path
      setMergeStage('Merge complete. Select save location...');
      setMergeProgress(100); // Indicate merge part is done

      // Prompt User to Save
      const inputExt = videoFile.name.includes('.')
        ? videoFile.name.substring(videoFile.name.lastIndexOf('.'))
        : '.mp4';
      const suggestedOutputName = `video-with-subtitles${inputExt}`; // Simplified name

      const saveResult = await window.electron.saveFile({
        content: '', // Not saving content directly, just getting path
        defaultPath: suggestedOutputName,
        title: 'Save Merged Video As',
        filters: [
          { name: 'Video Files', extensions: [inputExt.slice(1)] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (saveResult.error) {
        if (saveResult.error.includes('canceled')) {
          setMergeStage('Save canceled by user. Cleaning up...');
          throw new Error('Save operation canceled by user.'); // Will trigger finally block
        } else {
          throw new Error(`Failed to get save path: ${saveResult.error}`);
        }
      }

      if (!saveResult.filePath) {
        throw new Error('No output path selected after merge.');
      }

      const finalOutputPath = saveResult.filePath;

      // Move Temporary File to Final Location
      if (!tempMergedFilePath) {
        throw new Error(
          'Temporary merge file path is missing before move operation.'
        );
      }

      setMergeStage('Moving file to final destination...');
      const moveResult = await window.electron.moveFile(
        tempMergedFilePath,
        finalOutputPath
      );

      if (!moveResult?.success) {
        throw new Error(
          `Failed to move file: ${moveResult?.error || 'Unknown move error'}`
        );
      }

      setMergeStage('File saved successfully!');
      tempMergedFilePath = null; // Clear temp path as it's now moved
      setTimeout(() => setIsMergingInProgress(false), 2000);
      // Return final path on success
      return { success: true, outputPath: finalOutputPath };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown merge error';
      console.error('Error during merge/save process:', error);
      setMergeStage(`Error: ${errorMessage}`);
      // Cleanup is now handled in finally
      setTimeout(() => setIsMergingInProgress(false), 3000);
      // Return error on failure
      return { success: false, error: errorMessage };
    } finally {
      // Cleanup Temporary File
      if (tempMergedFilePath) {
        // console.log(`Cleaning up temporary file: ${tempMergedFilePath}`); // Remove log
        try {
          await window.electron.deleteFile({
            filePathToDelete: tempMergedFilePath,
          });
          // console.log(`Successfully cleaned up: ${tempMergedFilePath}`); // Remove log
        } catch (cleanupError: any) {
          console.error(
            `Failed to clean up temporary file ${tempMergedFilePath}:`,
            cleanupError.message || cleanupError
          );
        }
      }

      // Clean up the progress listener
      if (cleanupMergeListener) {
        cleanupMergeListener();
      }
    }
  }

  function handleRemoveSubtitleLocal(index: number) {
    handleRemoveSubtitle(index, subtitlesState, setSubtitlesState);
  }

  function handleInsertSubtitleLocal(index: number) {
    handleInsertSubtitle(index, subtitlesState, setSubtitlesState);
  }
}
