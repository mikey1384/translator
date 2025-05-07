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
import ErrorBanner from '../../components/ErrorBanner.js';

import SubtitleList from './SubtitleList/index.js';
import MergeControls from './MergeControls.js';
import EditSubtitlesHeader from './EditSubtitlesHeader.js';
import { subtitleVideoPlayer } from '../../../shared/constants/index.js';

import {
  buildSrt,
  openSubtitleWithElectron,
} from '../../../shared/helpers/index.js';

import { useSubtitleNavigation, flashSubtitle } from './hooks.js';
import {
  SUBTITLE_STYLE_PRESETS,
  SubtitleStylePresetKey,
} from '../../../shared/constants/subtitle-styles.js';
import { colors } from '../../styles.js';
import FileInputButton from '../../components/FileInputButton.js';
import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';
import { useSubStore } from '../../state/subtitle-store';
import { scrollPrecisely, scrollWhenReady } from './hooks';

export interface EditSubtitlesProps {
  isAudioOnly: boolean;
  videoFile: File | null;
  videoFilePath?: string | null;
  subtitles?: SrtSegment[];
  videoPlayerRef?: any;
  isMergingInProgress?: boolean;
  isTranslationInProgress?: boolean;
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
  showOriginalText: boolean;
}

export function EditSubtitles({
  isAudioOnly,
  videoFile,
  videoFilePath,
  subtitles: subtitlesProp,
  videoPlayerRef,
  isMergingInProgress: isMergingInProgressProp,
  isTranslationInProgress,
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
  showOriginalText,
}: EditSubtitlesProps) {
  const { t } = useTranslation();
  const [isLoadingSettings, setIsLoadingSettings] = useState<boolean>(true);
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const loadSubtitlesIntoStore = useSubStore(s => s.load);
  const [affectedRows, setAffectedRows] = useState<number[]>([]);
  const prevSubsRef = useRef<SrtSegment[]>([]);

  console.log('[review] prop:', reviewedBatchStartIndex);

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
      if (videoPlayerRef && typeof videoPlayerRef.currentTime === 'function') {
        try {
          const currentTime = videoPlayerRef.currentTime();
          videoPlayerRef.currentTime(currentTime);
        } catch {
          // console.warn('Error updating player time via videoPlayerRef:', e);
        }
      } else if (
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
  }, [subtitlesProp]);

  useEffect(() => {
    if (affectedRows.length > 0 && subtitlesProp) {
      const lastAffectedIndex = affectedRows[affectedRows.length - 1];
      if (lastAffectedIndex >= 0 && lastAffectedIndex < subtitlesProp.length) {
        const targetId = subtitlesProp[lastAffectedIndex].id;
        console.log(
          `[affectedRows Effect] Scrolling to last affected row index ${lastAffectedIndex}, id ${targetId}`
        );
        const scrollDone = () => {
          console.log(
            `[affectedRows Effect] Scroll finished, clearing affectedRows.`
          );
          setAffectedRows([]);
        };
        scrollWhenReady(targetId, subtitleRefs, false, 0, 30, scrollDone);
      } else {
        console.warn(
          `[affectedRows Effect] Last affected index ${lastAffectedIndex} out of bounds.`
        );
        setAffectedRows([]);
      }
    }
  }, [affectedRows, subtitlesProp]);

  const activePlayer =
    videoPlayerRef ?? (subtitleVideoPlayer?.instance || undefined);

  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    subtitlesProp || [],
    subtitleRefs,
    activePlayer
  );

  const scrollToSubtitleIndex = useCallback(
    (index: number) => {
      if (subtitlesProp && index >= 0 && index < subtitlesProp.length) {
        console.log(`[EditSubtitles] Requesting scroll to index: ${index}`);

        setTimeout(() => {
          const targetSubtitle = subtitlesProp[index];
          const targetElement = subtitleRefs?.current[targetSubtitle.id];
          if (targetElement) {
            console.log(
              `[EditSubtitles] Executing scrollIntoView for forced index: ${index}`
            );
            scrollPrecisely(targetElement, false);
            requestAnimationFrame(() => flashSubtitle(targetElement));
          } else {
            console.warn(
              `[EditSubtitles] Target element for index ${index} not found after forced render.`
            );
          }
        }, 100);
      } else {
        console.warn(`[EditSubtitles] Invalid index for scrolling: ${index}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subtitlesProp]
  );

  useEffect(() => {
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  useEffect(() => {
    // Early exit if subtitlesProp is not a valid array
    if (!Array.isArray(subtitlesProp)) {
      prevSubsRef.current = []; // Ensure ref is cleared if props become invalid
      return;
    }
    // Effect to load subtitles, calculate diff for animation, and handle reviewed batches
    if (!subtitlesProp?.length) {
      prevSubsRef.current = []; // Clear ref if props are empty
      return;
    }

    const withIds = subtitlesProp.map(seg =>
      seg.id ? seg : { ...seg, id: crypto.randomUUID() }
    );
    const prevSubsForDiff = prevSubsRef.current;

    // --- Populate _oldText before updating store --- START ---
    const merged = withIds.map((nextSeg, index) => {
      // Find the corresponding previous segment *by ID* if possible, else by index
      const prevSeg =
        prevSubsForDiff.find(p => p.id === nextSeg.id) ??
        prevSubsForDiff[index];

      // Check if text content actually changed compared to the previous state
      if (
        prevSeg &&
        (prevSeg.translation !== nextSeg.translation ||
          prevSeg.original !== nextSeg.original)
      ) {
        // If changed, store the previous text (prefer translation) in _oldText
        return {
          ...nextSeg,
          _oldText: prevSeg.translation ?? prevSeg.original,
        };
      }
      // If not changed, return the segment as is (ensuring _oldText isn't carried over unnecessarily)
      const { _oldText, ...rest } = nextSeg; // Remove potential stale _oldText
      return rest;
    });
    // --- Populate _oldText before updating store --- END ---

    loadSubtitlesIntoStore(merged);

    if (reviewedBatchStartIndex != null) {
      console.log(
        `[EditSubtitles] Calculating diff based on reviewedBatchStartIndex: ${reviewedBatchStartIndex}`
      );

      const diffIndices = calcAffected(
        prevSubsForDiff,
        merged,
        reviewedBatchStartIndex
      );
      // Wrap in rAF to ensure DOM updates (from store load) complete before triggering scroll effect
      requestAnimationFrame(() => {
        setAffectedRows(diffIndices);
      });
    } else {
      if (affectedRows.length > 0) {
        setAffectedRows([]);
      }
    }

    prevSubsRef.current = merged;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitlesProp, reviewedBatchStartIndex]);

  return (
    <Section title={t('editSubtitles.title')} overflowVisible>
      {saveError && (
        <ErrorBanner message={saveError} onClose={() => setSaveError('')} />
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
              affectedRows={affectedRows}
            />
          </div>
        </>
      )}
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
            videoFileExists={!!videoFile || !!videoFilePath}
            subtitlesExist={!!(subtitlesProp && subtitlesProp.length > 0)}
            isTranslationInProgress={isTranslationInProgress}
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
        setSaveError(`Error loading SRT: ${result.error}`);
        console.error('[handleLoadSrtLocal] Error:', result.error);
      } else {
        console.log('[handleLoadSrtLocal] File selection canceled.');
        setSaveError('');
      }
    } else if (result.segments && result.filePath && onSetSubtitleSegments) {
      console.log(
        `[handleLoadSrtLocal] Successfully loaded SRT: ${result.filePath}, segments count: ${result.segments.length}`
      );
      onSetSubtitleSegments(result.segments);
      onSrtFileLoaded(result.filePath);
      setAffectedRows([]);
      setSaveError('');
    } else {
      console.warn('[handleLoadSrtLocal] Unexpected result:', result);
      setSaveError(
        'Failed to load SRT file: Unexpected result from file dialog.'
      );
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

    setMergeStage('Starting render...');
    const operationId = `render-${Date.now()}`;
    onSetMergeOperationId(operationId);

    try {
      const mode = showOriginalText ? 'dual' : 'translation';
      const srtContent = buildSrt({
        segments: subtitlesProp,
        mode,
      });
      const videoDuration = videoDurationProp ?? 0;
      const videoWidth = isAudioOnly ? 1280 : (videoWidthProp ?? 1280);
      const videoHeight = isAudioOnly ? 720 : (videoHeightProp ?? 720);
      const frameRate = isAudioOnly ? 30 : (videoFrameRateProp ?? 30);
      const outputDir = '/placeholder/output/dir';

      if (!srtContent) {
        throw new Error('Failed to build SRT content string.');
      }

      const overlayMode = isAudioOnly ? 'blackVideo' : 'overlayOnVideo';

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

      console.log(
        `[EditSubtitles ${operationId}] Calling onStartPngRenderRequest prop with options:`,
        renderOptions
      );
      setMergeStage('Initializing render process via parent...');

      const finalResult = await onStartPngRenderRequest(renderOptions);

      if (!finalResult.success) {
        throw new Error(
          finalResult.error ||
            'Render process failed (received from AppContent).'
        );
      }

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

const calcAffected = (
  prevSubs: SrtSegment[],
  nextSubs: SrtSegment[],
  startIndex: number | null | undefined
): number[] => {
  if (startIndex === null || startIndex === undefined) return [];
  const REVIEW_BATCH_SIZE = 50;
  const affectedIndices: number[] = [];
  for (
    let i = startIndex;
    i <
    Math.min(startIndex + REVIEW_BATCH_SIZE, prevSubs.length, nextSubs.length);
    i++
  ) {
    if (
      prevSubs[i] &&
      nextSubs[i] &&
      (prevSubs[i].translation !== nextSubs[i].translation ||
        prevSubs[i].original !== nextSubs[i].original)
    ) {
      console.log(
        `%c[Δ %d]`,
        'color:#f7559a;font-weight:bold',
        '\nprev:',
        prevSubs[i].translation ?? prevSubs[i].original,
        '\nnext:',
        nextSubs[i].translation ?? nextSubs[i].original
      );
      affectedIndices.push(i);
      // Optionally track which batch reviewed this segment:
      // if (nextSubs[i]) nextSubs[i].reviewedInBatch = startIndex; // Or use a batch ID
    }
  }
  console.log('[calcAffected] Placeholder affected indices:', affectedIndices);
  return affectedIndices;
};
