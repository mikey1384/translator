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
import { subtitleVideoPlayer } from '../../../shared/constants/index.js';

import {
  buildSrt,
  openSubtitleWithElectron,
} from '../../../shared/helpers/index.js';

import { useSubtitleNavigation } from './hooks.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../../shared/constants/subtitle-styles.js';
import { colors } from '../../styles.js'; // Import colors
import FileInputButton from '../../components/FileInputButton.js';
import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';

export interface EditSubtitlesProps {
  isAudioOnly: boolean;
  videoFile: File | null;
  videoFilePath?: string | null;
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
  isAudioOnly,
  videoFile,
  videoFilePath,
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
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);
  const [forcedIndex, setForcedIndex] = useState<number | null>(null);
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
      console.log('[EditSubtitles] Finished loading settings attempt.');
      setIsLoadingSettings(false);
    } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
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
  }, [mergeFontSize, isLoadingSettings]);

  useEffect(() => {
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
  }, [mergeStylePreset, isLoadingSettings]);

  useEffect(() => {
    if (subtitlesProp && subtitlesProp.length > 0) {
      // Use the videoPlayerRef from props if available
      if (videoPlayerRef && typeof videoPlayerRef.currentTime === 'function') {
        try {
          const currentTime = videoPlayerRef.currentTime();
          videoPlayerRef.currentTime(currentTime);
        } catch {
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
        } catch {
          // console.warn('Error updating global player time:', e);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesProp]); // Depend on the prop

  // --- Effect to scroll to and highlight the reviewed batch --- START ---
  useEffect(() => {
    if (
      reviewedBatchStartIndex !== null &&
      reviewedBatchStartIndex !== undefined &&
      reviewedBatchStartIndex >= 0
    ) {
      // Ensure the index is within bounds
      if (subtitlesProp && reviewedBatchStartIndex < subtitlesProp.length) {
        // Scroll to the first subtitle in the batch
        const targetSubtitle = subtitlesProp[reviewedBatchStartIndex];
        const targetElement = subtitleRefs?.current[targetSubtitle.id];
        if (targetElement) {
          console.log(
            `[EditSubtitles] Scrolling to reviewed index: ${reviewedBatchStartIndex}`
          );
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

          // Highlight all subtitles in the batch (up to 50, which is the REVIEW_BATCH_SIZE)
          const REVIEW_BATCH_SIZE = 50;
          const endIndex = Math.min(
            reviewedBatchStartIndex + REVIEW_BATCH_SIZE,
            subtitlesProp.length
          );

          // First remove any existing highlights (in case this effect runs in quick succession)
          Object.values(subtitleRefs?.current || {}).forEach(element => {
            if (element) {
              element.classList.remove('highlight-subtitle');
            }
          });

          // Add highlight effect to each subtitle in the batch with a slight delay between each
          for (let i = reviewedBatchStartIndex; i < endIndex; i++) {
            const subtitle = subtitlesProp[i];
            const element = subtitleRefs?.current[subtitle.id];
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
  }, [reviewedBatchStartIndex, subtitlesProp]); // Trigger when index or subtitles change

  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    subtitlesProp || [],
    subtitleRefs,
    videoPlayerRef
  );

  const scrollToSubtitleIndex = useCallback(
    (index: number) => {
      if (subtitlesProp && index >= 0 && index < subtitlesProp.length) {
        console.log(`[EditSubtitles] Requesting scroll to index: ${index}`);

        setForcedIndex(index);

        setTimeout(() => {
          const targetSubtitle = subtitlesProp[index];
          const targetElement = subtitleRefs?.current[targetSubtitle.id];
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
    [subtitleRefs, setForcedIndex, subtitlesProp] // Added subtitlesProp to dependencies
  );

  useEffect(() => {
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  return (
    <Section title={t('editSubtitles.title')} overflowVisible>
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
            <Button variant="secondary" size="lg" onClick={handleLoadSrtLocal}>
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
              subtitleRefs={subtitleRefs}
              searchText={searchText || ''}
              forcedId={
                forcedIndex !== null &&
                subtitlesProp &&
                subtitlesProp[forcedIndex]
                  ? subtitlesProp[forcedIndex].id
                  : null
              }
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
            videoFileExists={!!videoFile}
            subtitlesExist={!!(subtitlesProp && subtitlesProp.length > 0)} // Ensure correct prop passed
          />
        </div>
      )}
    </Section>
  );

  async function handleLoadSrtLocal() {
    setSaveError('');
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
      onSetSubtitleSegments(result.segments);
      onSrtFileLoaded(result.filePath);
      setSaveError(''); // Clear any previous errors on success
    } else {
      console.warn('[handleLoadSrtLocal] Unexpected result:', result);
      setSaveError(
        'Failed to load SRT file: Unexpected result from file dialog.'
      ); // Use setSaveError
    }
  }

  async function handleMergeVideoWithSubtitles(): Promise<void> {
    console.log(
      '[EditSubtitles] handleMergeVideoWithSubtitles triggered (New PNG Sequence Method).'
    );
    setSaveError('');

    if (!videoFilePath) {
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
    if (!isAudioOnly) {
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
    }

    setMergeStage('Starting render...'); // Update progress stage
    const operationId = `render-${Date.now()}`;
    onSetMergeOperationId(operationId); // Set operation ID if needed by UI

    try {
      const srtContent = buildSrt({
        segments: subtitlesProp,
        mode: 'dual',
      });
      const videoDuration = videoDurationProp ?? 0; // Already checked above
      const videoWidth = isAudioOnly ? 1280 : (videoWidthProp ?? 1280);
      const videoHeight = isAudioOnly ? 720 : (videoHeightProp ?? 720);
      const frameRate = isAudioOnly ? 30 : (videoFrameRateProp ?? 30);
      const outputDir = '/placeholder/output/dir'; // Still a placeholder

      // Should not happen if validation above passed, but check srtContent just in case
      if (!srtContent) {
        throw new Error('Failed to build SRT content string.');
      }

      const overlayMode = isAudioOnly ? 'blackVideo' : 'overlayOnVideo';

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
        fontSizePx: mergeFontSize,
        stylePreset: mergeStylePreset,
        overlayMode,
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
}
