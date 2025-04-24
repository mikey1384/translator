import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  SetStateAction,
  Dispatch,
} from 'react';
import { css } from '@emotion/css';
import Section from '../../components/Section.js';
import Button from '../../components/Button.js';
import { useTranslation } from 'react-i18next';

import SubtitleList from './SubtitleList.js';
import MergeControls from './MergeControls.js';
import EditSubtitlesHeader from './EditSubtitlesHeader.js';
import {
  nativeSeek,
  nativePause,
  nativePlay,
  nativeGetCurrentTime,
  getNativePlayerInstance,
} from '../../native-player.js';
import { subtitleVideoPlayer } from '../../../shared/constants/index.js';

import { openSubtitleWithElectron } from '../../../shared/helpers/index.js';

import { secondsToSrtTime } from '../../../shared/helpers/index.js';
import { useSubtitleNavigation } from './hooks.js';
import { useSubtitleEditing } from './hooks/useSubtitleEditing.js';
import { SrtSegment } from '../../../types/interface.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../../shared/constants/subtitle-styles.js';
import { colors } from '../../styles.js'; // Import colors
import FileInputButton from '../../components/FileInputButton.js';
import { RenderSubtitlesOptions } from '../../../types/interface.js';

export interface EditSubtitlesProps {
  videoFile: File | null;
  videoFilePath?: string | null;
  isPlaying?: boolean;
  secondsToSrtTime?: (seconds: number) => string;
  subtitles?: SrtSegment[];
  videoPlayerRef?: any;
  isMergingInProgress?: boolean;
  setMergeStage: React.Dispatch<React.SetStateAction<string>>;
  onSetMergeOperationId: Dispatch<SetStateAction<string | null>>;
  editorRef?: React.RefObject<{
    scrollToCurrentSubtitle: () => void;
    scrollToSubtitleIndex: (index: number) => void;
  }>;
  onSetSubtitleSegments: Dispatch<SetStateAction<SrtSegment[]>>;
  reviewedBatchStartIndex?: number | null;
  canSaveDirectly: boolean;
  handleSaveSrt: () => Promise<void>;
  handleSaveEditedSrtAs: () => Promise<void>;
  onSrtFileLoaded: (filePath: string) => void;
  onSelectVideoClick: () => void;
  saveError: string;
  setSaveError: Dispatch<SetStateAction<string>>;
  searchText?: string;
  onStartPngRenderRequest: (
    options: RenderSubtitlesOptions
  ) => Promise<{ success: boolean; error?: string; outputPath?: string }>;
  videoDuration?: number;
  videoWidth?: number;
  videoHeight?: number;
  videoFrameRate?: number;
  mergeFontSize: number;
  setMergeFontSize: (value: number) => void;
  mergeStylePreset: SubtitleStylePresetKey;
  setMergeStylePreset: (value: SubtitleStylePresetKey) => void;
}

export function EditSubtitles({
  videoFile,
  videoFilePath,
  isPlaying: isPlayingProp,
  secondsToSrtTime: secondsToSrtTimeProp,
  subtitles: subtitlesProp,
  videoPlayerRef,
  isMergingInProgress: isMergingInProgressProp,
  onSelectVideoClick,
  setMergeStage,
  onSetMergeOperationId,
  editorRef,
  onSetSubtitleSegments,
  reviewedBatchStartIndex,
  canSaveDirectly,
  handleSaveSrt,
  handleSaveEditedSrtAs,
  onSrtFileLoaded,
  saveError,
  setSaveError,
  searchText,
  onStartPngRenderRequest,
  videoDuration: videoDurationProp,
  videoWidth: videoWidthProp,
  videoHeight: videoHeightProp,
  videoFrameRate: videoFrameRateProp,
  mergeFontSize,
  setMergeFontSize,
  mergeStylePreset,
  setMergeStylePreset,
}: EditSubtitlesProps) {
  const { t } = useTranslation();
  const [isPlayingState, setIsPlayingState] = useState<boolean>(
    isPlayingProp || false
  );
  const [isShiftingDisabled, setIsShiftingDisabled] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);
  const [forcedIndex, setForcedIndex] = useState<number | null>(null);
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
        Object.keys(SUBTITLE_STYLE_PRESETS).includes(savedStylePreset)
      ) {
        console.log(
          `[EditSubtitles] Applying saved style preset: ${savedStylePreset}`
        );
        setMergeStylePreset(savedStylePreset as SubtitleStylePresetKey);
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
    } // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (isPlayingProp !== undefined) {
      setIsPlayingState(isPlayingProp);
    }
  }, [isPlayingProp]);

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
      if (reviewedBatchStartIndex < subtitleRefs?.current.length) {
        // Scroll to the first subtitle in the batch
        const targetElement = subtitleRefs?.current[reviewedBatchStartIndex];
        if (targetElement) {
          console.log(
            `[EditSubtitles] Scrolling to reviewed index: ${reviewedBatchStartIndex}`
          );
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Highlight all subtitles in the batch (up to 20, which is the REVIEW_BATCH_SIZE)
          const REVIEW_BATCH_SIZE = 50;
          const endIndex = Math.min(
            reviewedBatchStartIndex + REVIEW_BATCH_SIZE,
            subtitleRefs?.current.length
          );

          // First remove any existing highlights (in case this effect runs in quick succession)
          subtitleRefs?.current.forEach(element => {
            if (element) {
              element.classList.remove('highlight-subtitle');
            }
          });

          // Add highlight effect to each subtitle in the batch with a slight delay between each
          for (let i = reviewedBatchStartIndex; i < endIndex; i++) {
            const element = subtitleRefs?.current[i];
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
    useSubtitleEditing({
      subtitles: subtitlesProp,
      onSetSubtitleSegments,
    });

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

  // --- Function to scroll to and highlight a specific subtitle index --- START ---
  const scrollToSubtitleIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < subtitleRefs?.current.length) {
        console.log(`[EditSubtitles] Requesting scroll to index: ${index}`);

        // Step 1: Set the index to be force-rendered
        setForcedIndex(index);

        // Step 2: Wait for React to render the forced item, then scroll
        setTimeout(() => {
          const targetElement = subtitleRefs?.current[index];
          if (targetElement) {
            console.log(
              `[EditSubtitles] Executing scrollIntoView for forced index: ${index}`
            );
            targetElement.scrollIntoView({
              behavior: 'instant',
              block: 'center',
            });

            // Highlight logic (can potentially run slightly delayed too)
            targetElement.classList.remove('highlight-subtitle'); // Remove any previous
            targetElement.classList.add('highlight-subtitle');
            setTimeout(() => {
              targetElement.classList.remove('highlight-subtitle');
              // Reset forcedIndex after scroll/highlight animation
              setForcedIndex(null);
            }, 2000);
          } else {
            console.warn(
              `[EditSubtitles] Target element for index ${index} not found after forced render.`
            );
            // If element still not found, reset forcedIndex
            setForcedIndex(null);
          }
        }, 100); // Changed delay to 100ms
      } else {
        console.warn(`[EditSubtitles] Invalid index for scrolling: ${index}`);
      }
    },
    [subtitleRefs, setForcedIndex] // Added setForcedIndex to dependencies
  );
  // --- Function to scroll to and highlight a specific subtitle index --- END ---

  // If an external editorRef is provided, expose `scrollToCurrentSubtitle`
  // -- MODIFIED: Also expose scrollToSubtitleIndex --
  useEffect(() => {
    if (editorRef?.current) {
      // Assign the existing scroll function
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      // Assign the new scroll-to-index function
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
    // Add scrollToSubtitleIndex to dependencies
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  // --- NEW Seek Handler ---
  const seekPlayerToTime = useCallback(
    (time: number) => {
      if (videoPlayerRef && typeof videoPlayerRef.seek === 'function') {
        try {
          videoPlayerRef.seek(time);
        } catch (error) {
          console.error('Error seeking player via ref:', error);
        }
      } else {
        try {
          nativeSeek(time);
        } catch (error) {
          console.error('Error seeking player via global nativePlayer:', error);
        }
      }
    },
    [videoPlayerRef] // Depend on videoPlayerRef state
  );

  return (
    <Section title={t('editSubtitles.title')} overflowVisible>
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
              <FileInputButton onClick={onSelectVideoClick}>
                {t('input.selectVideoAudioFile')}
              </FileInputButton>
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
              {t('subtitles.chooseSrtFile')}
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
            <h3 style={{ margin: 0 }}>
              {t('editSubtitles.listTitle', { count: subtitlesProp.length })}
            </h3>
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
              subtitles={subtitlesProp}
              subtitleRefs={subtitleRefs}
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
              searchText={searchText || ''}
              forcedIndex={forcedIndex}
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
            handleMergeVideoWithSubtitles={handleMergeVideoWithSubtitles}
            isMergingInProgress={isMergingInProgressProp || false}
            videoFileExists={!!videoFile} // Ensure correct prop passed
            subtitlesExist={!!(subtitlesProp && subtitlesProp.length > 0)} // Ensure correct prop passed
          />
        </div>
      )}
      {/* --- Restore Original Fixed Action Bar --- END --- */}
    </Section>
  );

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
    } else if (result.segments && result.filePath && onSetSubtitleSegments) {
      console.log(
        `[handleLoadSrtLocal] Successfully loaded SRT: ${result.filePath}, segments count: ${result.segments.length}`
      );
      onSetSubtitleSegments(result.segments); // Update segments & potentially trigger ID change in parent
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
    if (playTimeoutRef?.current) {
      window.clearTimeout(playTimeoutRef?.current);
      playTimeoutRef.current = null;
    }

    if (isPlayingState) {
      try {
        nativePause();
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
      const playerInstance = getNativePlayerInstance();
      if (playerInstance) {
        currentPosition = playerInstance.currentTime;
      } else {
        currentPosition = nativeGetCurrentTime();
      }

      if (currentPosition >= validStartTime && currentPosition < validEndTime) {
        playFromCurrentPosition(currentPosition, validEndTime);
      } else {
        if (playerInstance) {
          const trackElement = playerInstance.querySelector('track');
          if (trackElement && trackElement.track) {
            const oldMode = trackElement.track.mode;
            trackElement.track.mode = 'hidden';

            playerInstance.currentTime = validStartTime;

            setTimeout(() => {
              trackElement.track.mode = oldMode;
              playFromCurrentPosition(playerInstance.currentTime, validEndTime);
            }, 200);
          } else {
            playerInstance.currentTime = validStartTime;
            setTimeout(() => {
              playFromCurrentPosition(playerInstance.currentTime, validEndTime);
            }, 200);
          }
        } else {
          nativeSeek(validStartTime);
          setTimeout(() => {
            playFromCurrentPosition(nativeGetCurrentTime(), validEndTime);
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
      const playerInstance = getNativePlayerInstance();
      if (playerInstance) {
        actualTime = playerInstance.currentTime;
      } else {
        actualTime = nativeGetCurrentTime();
      }
    } catch (err) {
      // console.error('Error retrieving current time:', err);
    }

    try {
      const playerInstance = getNativePlayerInstance();
      const playPromise = playerInstance ? playerInstance.play() : nativePlay();
      playPromise
        .then(() => {
          setIsPlayingState(true);

          const durationMs = (endTime - actualTime) * 1000;
          if (durationMs > 0) {
            playTimeoutRef.current = window.setTimeout(() => {
              try {
                const playerInstance = getNativePlayerInstance();
                if (playerInstance) {
                  playerInstance.pause();
                } else {
                  nativePause();
                }
              } catch (err) {
                // console.error('Error pausing after snippet playback:', err);
              }
              setIsPlayingState(false);
              playTimeoutRef.current = null;
            }, durationMs);
          }
        })
        .catch((_error: any) => {
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
      if (onSetSubtitleSegments) {
        onSetSubtitleSegments(current =>
          current.map((s, i) =>
            i === index ? { ...s, start: newStart, end: newEnd } : s
          )
        );
      }

      try {
        nativeSeek(newStart);
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

  async function handleMergeVideoWithSubtitles(): Promise<void> {
    console.log(
      '[EditSubtitles] handleMergeVideoWithSubtitles triggered (New PNG Sequence Method).'
    );
    setSaveError(''); // Clear previous errors

    // --- UPDATED Initial Checks ---
    // For PNG sequence method, we NEED the file path
    if (!videoFilePath) {
      // Require videoFilePath for this method
      const msg = 'Cannot merge: Original video file path is missing.';
      console.error(`[EditSubtitles] ${msg}`);
      setSaveError(msg);
      return;
    }
    if (!subtitlesProp || subtitlesProp.length === 0) {
      const msg = 'No subtitles loaded to merge.';
      console.error(`[EditSubtitles] ${msg}`);
      setSaveError(msg);
      return;
    }
    // Add checks for other required props if needed (duration, width, height, frameRate)
    if (
      !videoDurationProp ||
      videoDurationProp <= 0 ||
      !videoWidthProp ||
      videoWidthProp <= 0 ||
      !videoHeightProp ||
      videoHeightProp <= 0 ||
      !videoFrameRateProp ||
      videoFrameRateProp <= 0
    ) {
      const missing = [
        !videoDurationProp ? 'duration' : null,
        !videoWidthProp ? 'width' : null,
        !videoHeightProp ? 'height' : null,
        !videoFrameRateProp ? 'frame rate' : null,
      ]
        .filter(Boolean)
        .join(', ');
      const msg = `Cannot merge: Missing required video metadata (${missing}).`;
      console.error(`[EditSubtitles] ${msg}`);
      setSaveError(msg);
      return;
    }
    // --- End UPDATED Checks ---

    setMergeStage('Starting render...'); // Update progress stage
    const operationId = `render-${Date.now()}`;
    onSetMergeOperationId(operationId); // Set operation ID if needed by UI

    try {
      // --- Gather required options ---
      const srtContent = subtitlesProp
        ?.map(
          s =>
            `${s.index}\n${secondsToSrtTimeFn(s.start)} --> ${secondsToSrtTimeFn(s.end)}\n${s.text}\n`
        )
        .join('\n');
      const videoDuration = videoDurationProp; // Already checked above
      const videoWidth = videoWidthProp;
      const videoHeight = videoHeightProp;
      const frameRate = videoFrameRateProp;
      const outputDir = '/placeholder/output/dir'; // Still a placeholder

      // Should not happen if validation above passed, but check srtContent just in case
      if (!srtContent) {
        throw new Error('Failed to build SRT content string.');
      }

      // --- Create the CORRECT options object ---
      const renderOptions: RenderSubtitlesOptions = {
        operationId,
        srtContent,
        outputDir,
        videoDuration,
        videoWidth,
        videoHeight,
        frameRate,
        originalVideoPath: videoFilePath,
      };
      // --- End Creating Options ---

      console.log(
        `[EditSubtitles ${operationId}] Calling onStartPngRenderRequest prop with options:`,
        renderOptions // Verify this log includes originalVideoPath
      );
      setMergeStage('Initializing render process via parent...');

      // Pass options to parent (AppContent), which now handles the full flow including save
      const finalResult = await onStartPngRenderRequest(renderOptions);

      // The result from the parent now indicates final success/failure AFTER save attempt
      if (!finalResult.success) {
        throw new Error(
          finalResult.error ||
            'Render process failed (received from AppContent).'
        );
      }

      // Success is handled by UI updates in AppContent based on finalResult
      console.log(
        `[EditSubtitles ${operationId}] Render and save process completed successfully (handled by parent). Final Path: ${finalResult.outputPath}`
      );
    } catch (error: any) {
      const errorMessage = `Error during subtitle rendering process: ${error.message || error}`;
      console.error(`[EditSubtitles ${operationId}] ${errorMessage}`);
      setSaveError(errorMessage);
      setMergeStage('Error');
      onSetMergeOperationId(null);
    }
  }

  function handleRemoveSubtitleLocal(index: number) {
    // Add confirmation before removing
    if (
      !window.confirm(
        t('editSubtitles.item.confirmRemove') // Use translation key
      )
    ) {
      return; // Stop if user cancels
    }
    // Actual removal logic
    // Use onSetSubtitlesDirectly
    if (onSetSubtitleSegments && subtitlesProp) {
      const updated = (subtitlesProp || [])
        .filter((_, i) => i !== index)
        .map((sub, i) => ({ ...sub, index: i + 1 }));
      onSetSubtitleSegments(updated);
    }
  }

  function handleInsertSubtitleLocal(index: number) {
    // Use onSetSubtitlesDirectly
    if (onSetSubtitleSegments && subtitlesProp) {
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
      onSetSubtitleSegments(updated);
    }
  }
}
