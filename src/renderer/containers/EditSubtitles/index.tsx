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
import Section from '../../components/Section.js';
import Button from '../../components/Button.js';

import SubtitleList from './SubtitleList.js';
import MergeControls from './MergeControls.js';
import EditSubtitlesHeader from './EditSubtitlesHeader.js';
import { nativePlayer } from '../../components/NativeVideoPlayer.js';
import { subtitleVideoPlayer } from '../../../shared/constants/index.js';

import {
  openSubtitleWithElectron,
  buildSrt,
  fixOverlappingSegments,
} from '../../../shared/helpers/index.js';

import { secondsToSrtTime } from './utils.js';
import { useSubtitleNavigation } from './hooks.js';
import { useSubtitleEditing } from './hooks/useSubtitleEditing.js';
import { SrtSegment, MergeSubtitlesOptions } from '../../../types/interface.js';
import {
  ASS_STYLE_PRESETS,
  AssStylePresetKey,
} from '../../../shared/constants/subtitle-styles.js';
import { colors } from '../../styles.js'; // Import colors

// Adjusted type for file change events from Button
type FileChangeEvent =
  | ChangeEvent<HTMLInputElement>
  | { target: { files: FileList | { name: string; path: string }[] | null } };

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoUrl: string | null;
  videoFilePath?: string | null;
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
  onSetMergeOperationId: Dispatch<SetStateAction<string | null>>;
  editorRef?: React.RefObject<{ scrollToCurrentSubtitle: () => void }>;
  onSetSubtitlesDirectly?: Dispatch<SetStateAction<SrtSegment[]>>;
  reviewedBatchStartIndex?: number | null;
  subtitleSourceId?: number;
  canSaveDirectly: boolean;
  handleSaveSrt: () => Promise<void>;
  handleSaveEditedSrtAs: () => Promise<void>;
  onSrtFileLoaded: (filePath: string) => void;
  saveError: string;
  setSaveError: Dispatch<SetStateAction<string>>;
}

export function EditSubtitles({
  videoFile,
  videoFilePath,
  onSetVideoFile,
  isPlaying: isPlayingProp,
  secondsToSrtTime: secondsToSrtTimeProp,
  subtitles: subtitlesProp,
  videoPlayerRef,
  isMergingInProgress: isMergingInProgressProp,
  setMergeProgress,
  setMergeStage,
  setIsMergingInProgress,
  onSetMergeOperationId,
  editorRef,
  onSetSubtitlesDirectly,
  reviewedBatchStartIndex,
  canSaveDirectly,
  handleSaveSrt,
  handleSaveEditedSrtAs,
  onSrtFileLoaded,
  saveError,
  setSaveError,
}: EditSubtitlesProps) {
  const [isPlayingState, setIsPlayingState] = useState<boolean>(
    isPlayingProp || false
  );
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  const [mergeFontSize, setMergeFontSize] = useState<number>(40);
  const [mergeStylePreset, setMergeStylePreset] =
    useState<AssStylePresetKey>('Default');
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);
  const playTimeoutRef = useRef<number | null>(null);
  const subtitleRefs = useRef<(HTMLDivElement | null)[]>([]);
  const secondsToSrtTimeFn = secondsToSrtTimeProp || secondsToSrtTime;

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

  // Scroll to the start of the last reviewed batch and highlight all subtitles in the batch
  useEffect(() => {
    if (
      reviewedBatchStartIndex !== null &&
      reviewedBatchStartIndex !== undefined &&
      reviewedBatchStartIndex >= 0
    ) {
      // Ensure the index is within bounds
      if (reviewedBatchStartIndex < subtitleRefs.current.length) {
        // Scroll to the first subtitle in the batch
        const targetElement = subtitleRefs.current[reviewedBatchStartIndex];
        if (targetElement) {
          console.log(
            `[EditSubtitles] Scrolling to reviewed index: ${reviewedBatchStartIndex}`
          );
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Highlight all subtitles in the batch (up to 20, which is the REVIEW_BATCH_SIZE)
          const REVIEW_BATCH_SIZE = 20;
          const endIndex = Math.min(
            reviewedBatchStartIndex + REVIEW_BATCH_SIZE,
            subtitleRefs.current.length
          );

          // First remove any existing highlights (in case this effect runs in quick succession)
          subtitleRefs.current.forEach(element => {
            if (element) {
              element.classList.remove('highlight-subtitle');
            }
          });

          // Add highlight effect to each subtitle in the batch with a slight delay between each
          for (let i = reviewedBatchStartIndex; i < endIndex; i++) {
            const element = subtitleRefs.current[i];
            if (element) {
              // Small delay for staggered effect
              setTimeout(
                () => {
                  element.classList.add('highlight-subtitle');
                },
                (i - reviewedBatchStartIndex) * 100
              );

              // Remove highlight after animation
              setTimeout(
                () => {
                  element.classList.remove('highlight-subtitle');
                },
                2000 + (i - reviewedBatchStartIndex) * 100
              );
            }
          }
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
  // const { canSaveDirectly, handleSaveSrt, handleSaveEditedSrtAs, notifyFileLoaded } =
  //   useSubtitleSaving(subtitlesProp, setSaveError /* pass setSaveError */);

  return (
    <Section title="Edit Subtitles" overflowVisible>
      {/* Error display - Use saveError prop now */}
      {saveError && (
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
          {saveError}
        </div>
      )}

      {/* --- Restore Original Conditional Load Buttons --- START --- */}
      {(!videoFile ||
        (videoFile && (!subtitlesProp || subtitlesProp.length === 0))) && (
        <div style={{ marginTop: 30 }}>
          {!videoFile && (
            <div
              style={{
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Button
                // style={{ width: '10rem' }} // Remove fixed width
                asFileInput
                accept="video/*"
                onFileChange={handleVideoFileChangeLocal}
                variant="secondary" // Change variant back to secondary
                size="lg" // Increase size
              >
                {/* Add Upload Icon */}
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
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Choose Video
              </Button>
            </div>
          )}

          <div
            style={{
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <Button
              // style={{ width: '10rem' }} // Remove fixed width
              variant="secondary" // Change variant back to secondary
              size="lg" // Increase size
              onClick={handleLoadSrtLocal}
            >
              {/* Add File Icon */}
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
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
              margin-bottom: 80px;
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
    setSaveError(''); // Clear save error on new load attempt
    console.log('Attempting to load SRT file via Electron...');
    const result = await openSubtitleWithElectron();

    if (result.error) {
      if (!result.error.includes('canceled')) {
        setSaveError(`Error loading SRT: ${result.error}`); // Use setSaveError
        console.error('[handleLoadSrtLocal] Error:', result.error);
      } else {
        console.log('[handleLoadSrtLocal] File selection canceled.');
        setSaveError(''); // Clear error if canceled
      }
    } else if (result.segments && result.filePath && onSetSubtitlesDirectly) {
      console.log(
        `[handleLoadSrtLocal] Successfully loaded SRT: ${result.filePath}, segments count: ${result.segments.length}`
      );
      onSetSubtitlesDirectly(result.segments); // Update segments & potentially trigger ID change in parent
      onSrtFileLoaded(result.filePath); // Call the new callback prop from App.tsx
      setSaveError(''); // Clear any previous errors on success
    } else {
      console.warn('[handleLoadSrtLocal] Unexpected result:', result);
      setSaveError(
        'Failed to load SRT file: Unexpected result from file dialog.'
      ); // Use setSaveError
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
    // Define the file size limit (3GB)
    const fileSizeLimitBytes = 3 * 1024 * 1024 * 1024;

    // Check file size
    if (videoFile.size > fileSizeLimitBytes) {
      const limitGB = fileSizeLimitBytes / (1024 * 1024 * 1024);
      const fileSizeGB = (videoFile.size / (1024 * 1024 * 1024)).toFixed(2);
      const errorMessage = `Error: Video file size (${fileSizeGB} GB) exceeds the ${limitGB} GB limit. Merge aborted.`;
      console.error(errorMessage);
      setSaveError(errorMessage);
      setMergeStage('Merge aborted due to file size.');
      setIsMergingInProgress(false);
      return { success: false, error: errorMessage };
    }

    // Generate operationId here
    const operationId = `merge-${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    setIsMergingInProgress(true);
    // --- Set the operation ID in parent state --- START ---
    onSetMergeOperationId(operationId);
    // --- Set the operation ID in parent state --- END ---
    setMergeProgress(0);
    setMergeStage('Preparing subtitle file...');
    let tempMergedFilePath: string | null = null; // Keep track of the temp file
    let cleanupMergeListener: (() => void) | null = null; // For listener cleanup

    // Add a flag to track cancellation status from progress events
    let wasCancelledViaProgress = false;

    try {
      // Setup Progress Listener
      const handleProgress = (_event: any, progress: any) => {
        if (progress?.operationId === operationId) {
          setMergeProgress(progress.percent);
          setMergeStage(progress.stage);

          // Keep cancellation status visible
          if (
            progress.cancelled ||
            progress.stage.includes('cancelled') ||
            progress.stage.includes('Merge cancelled')
          ) {
            console.log('Detected cancellation in progress event:', progress);
            setMergeStage(progress.stage || 'Merge cancelled');
            setTimeout(() => setIsMergingInProgress(false), 2000);
            // Set the cancellation flag to true
            wasCancelledViaProgress = true;
          }
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

      // --- Prepare Merge Options --- START ---
      let mergeOptions: MergeSubtitlesOptions;

      // --- MODIFIED: Prioritize videoFilePath prop --- START ---
      if (videoFilePath) {
        // If path prop exists, use it directly
        console.log('[EditSubtitles] Using videoFilePath prop:', videoFilePath);
        mergeOptions = {
          videoPath: videoFilePath,
          videoFileName: videoFile.name, // Still use name from File object for context
          srtContent: srtContent,
          operationId: operationId,
          fontSize: mergeFontSize,
          stylePreset: mergeStylePreset,
        };
      } else {
        // If no path is available, use the buffer method (File object)
        // The 500MB limit check is NO LONGER NEEDED here because
        // the path should *always* be available thanks to the Electron dialog changes.
        // If we reach here, something unexpected happened.
        console.warn(
          '[EditSubtitles] videoFilePath prop is missing! Falling back to sending File object. This might fail for large files.'
        );
        mergeOptions = {
          videoFile: videoFile, // Send the File object
          srtContent: srtContent,
          operationId: operationId,
          fontSize: mergeFontSize,
          stylePreset: mergeStylePreset,
        };
      }
      // --- MODIFIED: Prioritize videoFilePath prop --- END ---

      // Call Electron merge function with prepared options
      const mergeResult = await window.electron.mergeSubtitles(mergeOptions);

      console.log('Merge result received:', mergeResult);

      // Check for cancellation
      if (mergeResult?.cancelled) {
        console.log('Merge was cancelled by user');
        setMergeStage('Merge cancelled by user');
        setTimeout(() => setIsMergingInProgress(false), 2000);
        // No need to clean up temp files - the handler already took care of that
        return { success: false, error: 'Operation cancelled by user' };
      }

      // Check for success and outputPath (not tempOutputPath)
      if (!mergeResult?.success || !mergeResult.outputPath) {
        console.error('Merge process failed or no output path:', mergeResult);
        throw new Error(
          `Merge process failed: ${mergeResult?.error || 'Unknown merge error'}`
        );
      }

      tempMergedFilePath = mergeResult.outputPath; // Use outputPath instead of tempOutputPath
      console.log('Successfully got merge output path:', tempMergedFilePath);

      // EXTRA CHECK: Consider empty or whitespace-only path as indication of cancellation
      if (!tempMergedFilePath || tempMergedFilePath.trim() === '') {
        console.log(
          'Empty output path from merge result, treating as cancelled'
        );
        setMergeStage('Merge was cancelled');
        setTimeout(() => setIsMergingInProgress(false), 2000);
        return { success: false, error: 'Operation was cancelled' };
      }

      setMergeStage('Merge complete. Select save location...');
      setMergeProgress(100); // Indicate merge part is done
      console.log(
        'Merge complete, proceeding to save dialog for:',
        tempMergedFilePath
      );

      // Check if the merge was cancelled via progress events
      if (wasCancelledViaProgress) {
        console.log(
          'Merge was cancelled via progress events, skipping save dialog'
        );
        setMergeStage('Merge was cancelled');
        setTimeout(() => setIsMergingInProgress(false), 2000);
        return { success: false, error: 'Operation was cancelled' };
      }

      // Immediately show the save dialog after merge completes
      console.log('⭐ ATTEMPTING TO DISPLAY SAVE DIALOG...');

      // Ensure we remove any remaining validation before showing the save dialog
      if (tempMergedFilePath && tempMergedFilePath.trim() !== '') {
        try {
          // Prompt User to Save
          const inputExt = videoFile.name.includes('.')
            ? videoFile.name.substring(videoFile.name.lastIndexOf('.'))
            : '.mp4';
          const suggestedOutputName = `video-with-subtitles${inputExt}`; // Simplified name

          console.log(
            '⭐ Showing save dialog with suggested name:',
            suggestedOutputName,
            'for merged file:',
            tempMergedFilePath
          );

          const saveResult = await window.electron.saveFile({
            content: '', // Not saving content directly, just getting path
            defaultPath: suggestedOutputName,
            title: 'Save Merged Video As',
            filters: [
              { name: 'Video Files', extensions: [inputExt.slice(1)] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });

          console.log('Save dialog result:', saveResult);

          if (saveResult.error) {
            if (saveResult.error.includes('canceled')) {
              console.log('Save was cancelled by user');
              setMergeStage('Save canceled by user. Cleaning up...');
              throw new Error('Save operation canceled by user.'); // Will trigger finally block
            } else {
              console.error('Save dialog error:', saveResult.error);
              throw new Error(`Failed to get save path: ${saveResult.error}`);
            }
          }

          if (!saveResult.filePath) {
            console.error('No file path returned from save dialog');
            throw new Error('No output path selected after merge.');
          }

          const finalOutputPath = saveResult.filePath;
          console.log('User selected output path:', finalOutputPath);

          // Move Temporary File to Final Location
          // --- Add Logging --- START ---
          console.log(`[Merge] Attempting to move file.`);
          console.log(`[Merge] Source (temp): ${tempMergedFilePath}`);
          console.log(
            `[Merge] Destination (user selected): ${finalOutputPath}`
          );
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

          console.log('Move result:', moveResult);

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
        } catch (dialogError) {
          console.error('Error during save dialog or file move:', dialogError);
          throw dialogError; // Re-throw to be caught by the outer catch block
        }
      } else {
        // If we get here, something went wrong with the merge result
        console.log('No valid output path from merge result, likely cancelled');
        setMergeStage('Operation did not complete, no file to save');
        setTimeout(() => setIsMergingInProgress(false), 2000);
        return { success: false, error: 'No output file was produced' };
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown merge error';
      console.error('Error during merge/save process:', error);
      setMergeStage(`Error: ${errorMessage}`);

      // Clean up temporary file if it exists
      if (tempMergedFilePath) {
        try {
          await window.electron.deleteFile({
            filePathToDelete: tempMergedFilePath,
          });
          console.log(
            `Deleted temporary merge file after error: ${tempMergedFilePath}`
          );
          tempMergedFilePath = null;
        } catch (cleanupErr) {
          console.warn(`Failed to delete temp file after error: ${cleanupErr}`);
        }
      }

      // Cleanup is now handled in finally
      setTimeout(() => setIsMergingInProgress(false), 3000);
      // Return error on failure
      return { success: false, error: errorMessage };
    } finally {
      // Clean up the progress listener
      if (cleanupMergeListener) {
        cleanupMergeListener();
      }
      // --- Clear the operation ID in parent state --- START ---
      onSetMergeOperationId(null);
      // --- Clear the operation ID in parent state --- END ---
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
