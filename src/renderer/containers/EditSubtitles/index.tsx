import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  SetStateAction,
  Dispatch,
  ChangeEvent,
} from 'react';
import { css } from '@emotion/css';
import Section from '../../components/Section';
import Button from '../../components/Button';

import SubtitleList from './SubtitleList';
import MergeControls from './MergeControls';
import EditSubtitlesHeader from './EditSubtitlesHeader';
import { nativePlayer } from '../../components/NativeVideoPlayer';
import { subtitleVideoPlayer } from '../../constants';

import {
  openSubtitleWithElectron,
  buildSrt,
  fixOverlappingSegments,
} from '../../helpers/subtitle-utils';

import { secondsToSrtTime } from './utils';
import { useSubtitleNavigation } from './hooks';
import { useSubtitleEditing } from './hooks/useSubtitleEditing';
import { useSubtitleSaving } from './hooks/useSubtitleSaving';

import { SrtSegment } from '../../../types/interface';
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../../constants/subtitle-styles';
import { colors } from '../../styles'; // Import colors

// Adjusted type for file change events from Button
type FileChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | { target: { files: FileList | { name: string; path: string }[] | null } };

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  onSetVideoFile: (file: File | null) => void;
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
  reviewedBatchStartIndex?: number | null;
  subtitleSourceId?: number;
}

export function EditSubtitles({
  videoFile,
  onSetVideoFile,
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
  reviewedBatchStartIndex,
  subtitleSourceId,
}: EditSubtitlesProps) {
  /**
   * ------------------------------------------------------
   * State Management
   * ------------------------------------------------------
   */
  const [isPlayingState, setIsPlayingState] = useState<boolean>(
    isPlayingProp || false
  );
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  const [error, setError] = useState<string>('');
  const [mergeFontSize, setMergeFontSize] = useState<number>(24);
  const [mergeStylePreset, setMergeStylePreset] =
    useState<AssStylePresetKey>('Default');
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);

  // For controlling a timed auto‐pause
  const playTimeoutRef = useRef<number | null>(null);

  // Subtitle DOM references
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);

  // If the user passed in a custom `secondsToSrtTime`, use that; otherwise fallback
  const secondsToSrtTimeFn = secondsToSrtTimeProp || secondsToSrtTime;

  // New ref for current merge operation ID
  const currentMergeOperationIdRef = useRef<string | null>(null);

  /**
   * ------------------------------------------------------
   * Initialization & Updates
   * ------------------------------------------------------
   */
  // Load saved merge settings from localStorage on mount
  useEffect(() => {
    console.log(
      '[EditSubtitles] Attempting to load settings from localStorage...'
    );
    try {
      const savedFontSize = localStorage.getItem('savedMergeFontSize');
      console.log('[EditSubtitles] Loaded savedFontSize:', savedFontSize);
      if (savedFontSize) {
        const size = parseInt(savedFontSize, 10);
        if (!isNaN(size) && size >= 10 && size <= 72) {
          console.log(`[EditSubtitles] Applying saved font size: ${size}`);
          setMergeFontSize(size);
        } else {
          console.warn(
            '[EditSubtitles] Invalid saved font size ignored:',
            savedFontSize
          );
        }
      }

      const savedStylePreset = localStorage.getItem('savedMergeStylePreset');
      console.log('[EditSubtitles] Loaded savedStylePreset:', savedStylePreset);
      if (
        savedStylePreset &&
        Object.keys(ASS_STYLE_PRESETS).includes(savedStylePreset)
      ) {
        console.log(
          `[EditSubtitles] Applying saved style preset: ${savedStylePreset}`
        );
        setMergeStylePreset(savedStylePreset as AssStylePresetKey);
      } else if (savedStylePreset) {
        console.warn(
          '[EditSubtitles] Invalid saved style preset ignored:',
          savedStylePreset
        );
      }
    } catch (error) {
      console.error(
        '[EditSubtitles] Error loading settings from localStorage:',
        error
      );
    } finally {
      // Ensure loading state is set to false after attempting to load
      console.log('[EditSubtitles] Finished loading settings attempt.');
      setIsLoadingSettings(false);
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  // Save mergeFontSize to localStorage whenever it changes
  useEffect(() => {
    // Only save if initial loading is complete
    if (!isLoadingSettings) {
      console.log(
        `[EditSubtitles] Attempting to save mergeFontSize: ${mergeFontSize}`
      );
      try {
        localStorage.setItem('savedMergeFontSize', String(mergeFontSize));
        console.log(
          `[EditSubtitles] Successfully saved mergeFontSize: ${mergeFontSize}`
        );
      } catch (error) {
        console.error(
          '[EditSubtitles] Error saving mergeFontSize to localStorage:',
          error
        );
      }
    }
  }, [mergeFontSize, isLoadingSettings]); // Add isLoadingSettings dependency

  // Save mergeStylePreset to localStorage whenever it changes
  useEffect(() => {
    // Only save if initial loading is complete
    if (!isLoadingSettings) {
      console.log(
        `[EditSubtitles] Attempting to save mergeStylePreset: ${mergeStylePreset}`
      );
      try {
        localStorage.setItem('savedMergeStylePreset', mergeStylePreset);
        console.log(
          `[EditSubtitles] Successfully saved mergeStylePreset: ${mergeStylePreset}`
        );
      } catch (error) {
        console.error(
          '[EditSubtitles] Error saving mergeStylePreset to localStorage:',
          error
        );
      }
    }
  }, [mergeStylePreset, isLoadingSettings]); // Add isLoadingSettings dependency

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
    if (subtitlesProp && subtitlesProp.length > 0) {
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
  }, [subtitlesProp]); // Depend on the prop

  // Scroll to the start of the last reviewed batch
  useEffect(() => {
    if (
      reviewedBatchStartIndex !== null &&
      reviewedBatchStartIndex !== undefined &&
      reviewedBatchStartIndex >= 0
    ) {
      // Ensure the index is within bounds
      if (reviewedBatchStartIndex < subtitleRefs.current.length) {
        const targetElement = subtitleRefs.current[reviewedBatchStartIndex];
        if (targetElement) {
          console.log(
            `[EditSubtitles] Scrolling to reviewed index: ${reviewedBatchStartIndex}`
          );
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Add a temporary highlight effect
          targetElement.classList.add('highlight-subtitle');
          setTimeout(() => {
            targetElement.classList.remove('highlight-subtitle');
          }, 2000); // Remove highlight after 2 seconds
        }
      } else {
        console.warn(
          `[EditSubtitles] reviewedBatchStartIndex ${reviewedBatchStartIndex} is out of bounds.`
        );
      }
    }
  }, [reviewedBatchStartIndex]); // Trigger only when this index changes

  /**
   * ------------------------------------------------------
   * Subtitle Editing Logic
   * ------------------------------------------------------
   */
  const { editingTimesState, handleEditSubtitle, handleTimeInputBlur } =
    useSubtitleEditing(subtitlesProp, onSetSubtitlesDirectly);

  /**
   * ------------------------------------------------------
   * Navigation: highlight or scroll to current subtitle
   * ------------------------------------------------------
   */
  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    // Use subtitlesProp
    subtitlesProp || [],
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
  const { canSaveDirectly, handleSaveSrt, handleSaveEditedSrtAs } =
    useSubtitleSaving(subtitlesProp, setError, subtitleSourceId);

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

      {/* --- Restore Original Conditional Load Buttons --- START --- */}
      {(!videoFile ||
        (videoFile && (!subtitlesProp || subtitlesProp.length === 0))) && (
        <div style={{ marginBottom: 20 }}>
          {!videoFile && (
            <div
              style={{
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <label>Load Video:</label>
              <Button
                asFileInput
                accept="video/*"
                onFileChange={handleVideoFileChangeLocal}
                variant="secondary"
              >
                Choose Video
              </Button>
            </div>
          )}

          <div
            style={{
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <label>Load SRT:</label>
            <Button variant="secondary" onClick={handleLoadSrtLocal}>
              Choose SRT File
            </Button>
          </div>
        </div>
      )}
      {/* --- Restore Original Conditional Load Buttons --- END --- */}

      {/* --- Restore Original Subtitle List Section --- START --- */}
      {subtitlesProp && subtitlesProp.length > 0 && (
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
            <h3 style={{ margin: 0 }}>Subtitles ({subtitlesProp.length})</h3>
          </div>

          <div
            className={`subtitle-editor-container ${css`
              display: flex;
              flex-direction: column;
              gap: 15px;
              margin-bottom: 80px; /* Keep margin for fixed bar */

              .highlight-subtitle {
                /* Keep highlight style */
              }
              @keyframes highlight-pulse {
                /* Keep keyframes */
              }
            `}`}
          >
            <SubtitleList
              subtitles={subtitlesProp} // Use the correct prop name
              subtitleRefs={subtitleRefs}
              editingTimes={editingTimesState}
              isPlaying={isPlayingState}
              secondsToSrtTime={secondsToSrtTimeFn}
              onEditSubtitle={handleEditSubtitle} // Use the correct prop name
              onTimeInputBlur={handleTimeInputBlur} // Use the correct prop name
              onRemoveSubtitle={handleRemoveSubtitleLocal} // Use the correct prop name
              onInsertSubtitle={handleInsertSubtitleLocal} // Use the correct prop name
              onSeekToSubtitle={seekPlayerToTime} // Use the correct prop name
              onPlaySubtitle={handlePlaySubtitle} // Use the correct prop name
              onShiftSubtitle={handleShiftSubtitle} // Use the correct prop name
              isShiftingDisabled={isShiftingDisabled}
            />
          </div>
        </>
      )}
      {/* --- Restore Original Subtitle List Section --- END --- */}

      {/* --- Restore Original Fixed Action Bar --- START --- */}
      {subtitlesProp && subtitlesProp.length > 0 && (
        <div
          className={css`
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 15px 20px;
            background-color: rgba(30, 30, 30, 0.75);
            backdrop-filter: blur(12px);
            border-top: 1px solid ${colors.border};
            display: flex;
            align-items: center;
            gap: 10px;
            justify-content: center;
            z-index: 100;
            box-shadow: none;
          `}
        >
          <EditSubtitlesHeader
            onSave={handleSaveSrt}
            onSaveAs={handleSaveEditedSrtAs}
            canSaveDirectly={canSaveDirectly}
            subtitlesExist={!!(subtitlesProp && subtitlesProp.length > 0)}
          />

          <MergeControls
            mergeFontSize={mergeFontSize}
            setMergeFontSize={setMergeFontSize}
            mergeStylePreset={mergeStylePreset}
            setMergeStylePreset={setMergeStylePreset}
            handleMergeVideoWithSubtitles={() =>
              handleMergeVideoWithSubtitles(videoFile!)
            }
            isMergingInProgress={isMergingInProgressProp || false}
            videoFileExists={!!videoFile} // Ensure correct prop passed
            subtitlesExist={!!(subtitlesProp && subtitlesProp.length > 0)} // Ensure correct prop passed
          />
        </div>
      )}
      {/* --- Restore Original Fixed Action Bar --- END --- */}
    </Section>
  );

  // --- Helper Functions ---

  function handleVideoFileChangeLocal(event: FileChangeEvent) {
    let file: File | null = null;
    if (
      'target' in event &&
      event.target &&
      'files' in event.target &&
      event.target.files instanceof FileList &&
      event.target.files.length > 0
    ) {
      file = event.target.files[0];
    }

    if (file) {
      onSetVideoFile(file);
      // No need to set URL here, App.tsx handles it
    } else {
      console.log('No video file selected or selection cancelled.');
    }
  }

  async function handleLoadSrtLocal() {
    const result = await openSubtitleWithElectron();
    if (result.error) {
      setError(`Error loading SRT: ${result.error}`);
      if (result.error.includes('canceled')) {
        setError('');
      }
    } else if (result.segments && onSetSubtitlesDirectly) {
      onSetSubtitlesDirectly(result.segments);
      setError('');
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
      // Use subtitlesProp
      const sub = subtitlesProp ? subtitlesProp[index] : null;
      if (!sub) {
        // console.error(`No subtitle found at index ${index}`);
        setIsShiftingDisabled(false);
        return;
      }
      const newStart = Math.max(0, sub.start + shiftSeconds);
      const duration = sub.end - sub.start;
      const newEnd = newStart + duration;

      // Use onSetSubtitlesDirectly
      if (onSetSubtitlesDirectly) {
        onSetSubtitlesDirectly(current =>
          current.map((s, i) =>
            i === index ? { ...s, start: newStart, end: newEnd } : s
          )
        );
      }

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
    videoFile: File
  ): Promise<{ success: boolean; outputPath?: string; error?: string }> {
    // Define the file size limit (1GB)
    const fileSizeLimitBytes = 1 * 1024 * 1024 * 1024; // 1 GB

    // Check file size
    if (videoFile.size > fileSizeLimitBytes) {
      const limitGB = fileSizeLimitBytes / (1024 * 1024 * 1024);
      const fileSizeGB = (videoFile.size / (1024 * 1024 * 1024)).toFixed(2);
      const errorMessage = `Error: Video file size (${fileSizeGB} GB) exceeds the ${limitGB} GB limit. Merge aborted.`;
      console.error(errorMessage);
      setError(errorMessage); // Display error to the user
      setMergeStage('Merge aborted due to file size.');
      setIsMergingInProgress(false); // Ensure merging state is reset
      return { success: false, error: errorMessage };
    }

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

      // Use subtitlesProp
      const srtContent = buildSrt(fixOverlappingSegments(subtitlesProp || []));

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
      // --- Add Logging --- START ---
      console.log(`[Merge] Attempting to move file.`);
      console.log(`[Merge] Source (temp): ${tempMergedFilePath}`);
      console.log(`[Merge] Destination (user selected): ${finalOutputPath}`);
      // --- Add Logging --- END ---

      if (!tempMergedFilePath) {
        throw new Error(
          'Temporary merge file path is missing before move operation.'
        );
      }
      if (!finalOutputPath) {
        throw new Error(
          'Final output path is missing before move operation (save dialog issue?).'
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
    // Use onSetSubtitlesDirectly
    if (onSetSubtitlesDirectly && subtitlesProp) {
      if (
        !window.confirm('Are you sure you want to remove this subtitle block?')
      )
        return;
      const updated = (subtitlesProp || [])
        .filter((_, i) => i !== index)
        .map((sub, i) => ({ ...sub, index: i + 1 }));
      onSetSubtitlesDirectly(updated);
    }
  }

  function handleInsertSubtitleLocal(index: number) {
    // Use onSetSubtitlesDirectly
    if (onSetSubtitlesDirectly && subtitlesProp) {
      // Use subtitlesProp
      const currentSub = subtitlesProp[index];
      const nextSub =
        index < subtitlesProp.length - 1 ? subtitlesProp[index + 1] : null;
      const newStart = currentSub.end;
      const newEnd = nextSub ? nextSub.start : currentSub.end + 2;
      const newSubtitle = {
        index: index + 2, // This will be fixed by map below
        start: newStart,
        end: newEnd,
        text: '',
      };
      const updated = [
        ...(subtitlesProp || []).slice(0, index + 1),
        newSubtitle,
        ...(subtitlesProp || []).slice(index + 1),
      ].map((sub, i) => ({ ...sub, index: i + 1 }));
      onSetSubtitlesDirectly(updated);
    }
  }
}
