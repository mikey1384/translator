import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';

import Section from '../../components/Section';
import ErrorBanner from '../../components/ErrorBanner';
import Button from '../../components/Button';

import SubtitleList from './SubtitleList';
import SaveAndMergeBar from './SaveAndMergeBar';
import EditHeaderTranslateBar from './EditHeaderTranslateBar';
import {
  calcAffectedSubtitleRows,
  collectMatchIndices,
} from './edit-subtitles-helpers';

import { buildSrt, openSubtitleWithElectron } from '../../../shared/helpers';
import { flashReviewedSegment, useSubtitleNavigation } from './hooks/index.js';
import { flashSubtitle, scrollPrecisely } from '../../utils/scroll.js';
import {
  BASELINE_HEIGHT,
  fontScale,
  ERROR_CODES,
} from '../../../shared/constants';
import {
  editorEmptyActionsStyles,
  editorEmptyPrimaryButtonStyles,
  editorEmptyStateStyles,
  editorFooterDockStyles,
  editorFooterInnerStyles,
  editorListHeaderMainStyles,
  editorListHeaderStyles,
  editorListMetaStyles,
  editorListShellStyles,
  editorListTitleStyles,
  editorStatusActionRowStyles,
  editorStatusPillRowStyles,
  editorStatusPillStyles,
  editorStatusShellStyles,
  editorStatusSourceItemStyles,
  editorStatusSourceListStyles,
  editorWorkspaceStackStyles,
} from './edit-workspace-styles';

import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';
import { useUrlStore } from '../../state/url-store';

import * as FileIPC from '@ipc/file';

import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';
import { getNativePlayerInstance } from '../../native-player';
import { sameArray } from '../../utils/array';
import { runFullSrtTranslation } from '../../utils/runFullTranslation';
import { logButton, logTask, logError } from '../../utils/logger.js';
import { getByoErrorMessage, isByoError } from '../../utils/byoErrors';

export interface EditSubtitlesProps {
  setMergeStage: (stage: string) => void;
  onSetMergeOperationId: (id: string | null) => void;
  onStartPngRenderRequest: (
    opts: RenderSubtitlesOptions
  ) => Promise<{ success: boolean; error?: string }>;
  editorRef?: React.RefObject<{
    scrollToCurrentSubtitle: () => void;
    scrollToSubtitleIndex: (idx: number) => void;
  }>;
}

export default function EditSubtitles({
  setMergeStage,
  onSetMergeOperationId,
  onStartPngRenderRequest,
  editorRef,
}: EditSubtitlesProps) {
  const searchText = useUIStore(s => s.searchText);
  const showOriginalText = useUIStore(s => s.showOriginalText);
  const navTick = useUIStore(s => s.navTick);
  const videoPath = useVideoStore(s => s.path);
  const isAudioOnly = useVideoStore(s => s.isAudioOnly);
  const meta = useVideoStore(s => s.meta);
  const { t } = useTranslation();
  const translationInProgress = useTaskStore(s => !!s.translation.inProgress);
  const mergeInProgress = useTaskStore(s => !!s.merge.inProgress);
  const subtitleOrder = useSubStore(s => s.order);
  const subtitleSegments = useSubStore(s => s.segments);
  const subtitles = useMemo(
    () => subtitleOrder.map(id => subtitleSegments[id]),
    [subtitleOrder, subtitleSegments]
  );
  const origin = useSubStore(s => s.origin);
  const sourceVideoPath = useSubStore(s => s.sourceVideoPath);
  const originalPath = useSubStore(s => s.originalPath);
  const canSaveDirectly = !!originalPath;
  const videoDuration = meta?.duration ?? null;
  const subtitleFileName = originalPath
    ? originalPath.split(/[\\/]/).pop() || originalPath
    : null;
  const mountedVideoName = videoPath
    ? videoPath.split(/[\\/]/).pop() || videoPath
    : null;

  const [saveError, setSaveError] = useState('');
  const [affectedRows, setAffectedRows] = useState<number[]>([]);
  const [mergePreflightInProgress, setMergePreflightInProgress] =
    useState(false);
  const mergeStartLockRef = useRef(false);
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevSubsRef = useRef<SrtSegment[]>([]);
  const prevReviewedBatchRef = useRef<number | null>(null);

  const activePlayer = getNativePlayerInstance();
  const { scrollToCurrentSubtitle } = useSubtitleNavigation(
    subtitles,
    subtitleRefs,
    activePlayer
  );

  const scrollToSubtitleIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= subtitles.length) return;
      const node = subtitleRefs.current[subtitles[index].id];
      if (node) {
        scrollPrecisely(node, false);
        requestAnimationFrame(() => flashSubtitle(node));
      }
    },
    [subtitles]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (canSaveDirectly) void handleSaveSrt();
        else void handleSaveEditedSrtAs();
      }
    };
    window.addEventListener('keydown', onKeyDown as any);
    return () => window.removeEventListener('keydown', onKeyDown as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSaveDirectly, originalPath, subtitles]);

  useEffect(() => {
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  useEffect(() => {
    const local = collectMatchIndices(subtitles, searchText);
    if (!sameArray(useUIStore.getState().matchedIndices, local)) {
      useUIStore.getState().setMatchedIndices(local);
    }
  }, [searchText, showOriginalText, subtitles]);

  useEffect(() => {
    const { matchedIndices, activeMatchIndex } = useUIStore.getState();
    if (matchedIndices.length && activeMatchIndex < matchedIndices.length) {
      scrollToSubtitleIndex(matchedIndices[activeMatchIndex]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navTick]);

  const rbs = useTaskStore(s => s.translation.reviewedBatchStartIndex);
  useEffect(() => {
    if (rbs == null || rbs === prevReviewedBatchRef.current) return;

    const diff = calcAffectedSubtitleRows(prevSubsRef.current, subtitles, rbs);
    setAffectedRows(diff);
    prevReviewedBatchRef.current = rbs;
  }, [rbs, subtitles]);

  useEffect(() => {
    if (affectedRows.length === 0) return;
    const last = affectedRows[affectedRows.length - 1];
    const id = subtitles[last]?.id;
    if (!id) return;
    const done = () => setAffectedRows([]);
    flashReviewedSegment({
      id,
      subtitleRefs: subtitleRefs,
      onSuccess: done,
    });
  }, [affectedRows, subtitles]);

  useEffect(() => {
    prevSubsRef.current = subtitles;
  }, [subtitles]);

  const getSrtMode = () => (showOriginalText ? 'dual' : 'translation');

  // Removed post-translation display-mode popup; user controls this via the bottom toggle.

  async function handleTranslateAll() {
    try {
      logButton('translate_full');
      await runFullSrtTranslation();
    } catch (err) {
      console.error('[EditSubtitles] translate error:', err);
      logError('translate_full', err as any);
    }
  }

  const hasUntranslated = useMemo(
    () =>
      subtitles.some(
        s => (s.original || '').trim() && !(s.translation || '').trim()
      ),
    [subtitles]
  );

  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);

  const isFreshForThisVideo =
    origin === 'fresh' &&
    !!videoPath &&
    !!sourceVideoPath &&
    sourceVideoPath === videoPath;
  const hasSubtitles = subtitles.length > 0;
  const canContinueTranscribing =
    Boolean(videoPath) &&
    hasSubtitles &&
    typeof videoDuration === 'number' &&
    videoDuration - (subtitles[subtitles.length - 1]?.end ?? 0) >= 60;
  const workspaceModeLabel = showOriginalText
    ? t('editSubtitles.workspace.dualMode', 'Dual text mode')
    : t('editSubtitles.workspace.translationMode', 'Translation-only mode');
  const previewStatusLabel = videoPath
    ? t('editSubtitles.workspace.videoMounted', 'Preview video mounted')
    : t(
        'editSubtitles.workspace.videoNeeded',
        'Mount a source video to preview and merge'
      );

  const headerRight =
    hasUntranslated && !isFreshForThisVideo ? (
      <EditHeaderTranslateBar
        disabled={translationInProgress || isTranscribing}
        onTranslate={handleTranslateAll}
      />
    ) : null;

  return (
    <Section
      title={t('editSubtitles.title')}
      headerRight={headerRight}
      overflowVisible
      contentClassName={editorWorkspaceStackStyles}
    >
      {saveError && (
        <ErrorBanner message={saveError} onClose={() => setSaveError('')} />
      )}

      {!hasSubtitles ? (
        <div className={editorEmptyStateStyles}>
          <div className={editorEmptyActionsStyles}>
            <Button
              variant="primary"
              size="lg"
              className={editorEmptyPrimaryButtonStyles}
              onClick={handleLoadSrtLocal}
              title={t('subtitles.chooseSrtFile')}
              disabled={
                isTranscribing || translationInProgress || mergeInProgress
              }
            >
              {t('subtitles.chooseSrtFile')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className={editorStatusShellStyles}>
            <div className={editorStatusPillRowStyles}>
              <span className={editorStatusPillStyles}>
                {t(
                  'editSubtitles.workspace.rowsLoaded',
                  '{{count}} rows loaded',
                  {
                    count: subtitles.length,
                  }
                )}
              </span>
              <span className={editorStatusPillStyles}>
                {workspaceModeLabel}
              </span>
              <span className={editorStatusPillStyles}>
                {previewStatusLabel}
              </span>
            </div>

            {subtitleFileName || mountedVideoName ? (
              <div className={editorStatusSourceListStyles}>
                {subtitleFileName ? (
                  <p className={editorStatusSourceItemStyles}>
                    {subtitleFileName}
                  </p>
                ) : null}
                {mountedVideoName ? (
                  <p className={editorStatusSourceItemStyles}>
                    {mountedVideoName}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className={editorStatusActionRowStyles}>
              <Button
                variant="secondary"
                size="md"
                onClick={handleLoadSrtLocal}
                disabled={
                  isTranscribing || translationInProgress || mergeInProgress
                }
              >
                {t(
                  'editSubtitles.workspace.loadAnotherSrt',
                  'Load another SRT'
                )}
              </Button>
              {!videoPath ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleMountVideoForSubs}
                  title={t('input.selectVideoAudioFile')}
                >
                  {t('input.selectVideoAudioFile')}
                </Button>
              ) : null}
              {canContinueTranscribing ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleContinueTranscribing}
                  disabled={
                    isTranscribing || translationInProgress || mergeInProgress
                  }
                  title={t(
                    'subtitles.continueTranscribing',
                    'Continue transcribing'
                  )}
                >
                  {t('subtitles.continueTranscribing', 'Continue transcribing')}
                </Button>
              ) : null}
            </div>
          </div>

          <div className={editorListShellStyles}>
            <div className={editorListHeaderStyles}>
              <div className={editorListHeaderMainStyles}>
                <h3 className={editorListTitleStyles}>
                  {t('editSubtitles.listTitle', {
                    count: subtitles.length,
                  })}
                </h3>
                <p className={editorListMetaStyles}>
                  {t(
                    'editSubtitles.workspace.listCopy',
                    'Edit source text, translation, timing, and line-level actions directly in place.'
                  )}
                </p>
              </div>
            </div>

            <SubtitleList
              subtitleRefs={subtitleRefs}
              searchText={searchText}
              affectedRows={affectedRows}
            />
          </div>
        </>
      )}

      {hasSubtitles && (
        <div className={editorFooterDockStyles}>
          <div className={editorFooterInnerStyles}>
            <SaveAndMergeBar
              onSave={handleSaveSrt}
              onSaveAs={handleSaveEditedSrtAs}
              onMerge={handleMerge}
              canSaveDirectly={canSaveDirectly}
              subtitlesExist={subtitles.length > 0}
              videoFileExists={!!videoPath}
              isMergingInProgress={mergeInProgress || mergePreflightInProgress}
              isTranslationInProgress={translationInProgress}
            />
          </div>
        </div>
      )}
    </Section>
  );

  async function handleSaveSrt() {
    if (!originalPath) return handleSaveEditedSrtAs();
    try {
      logButton('save_srt');
    } catch {
      // Do nothing
    }
    await writeSrt(originalPath);
  }

  async function handleContinueTranscribing() {
    try {
      logButton('continue_transcribing');
      const videoPath = useVideoStore.getState().path;
      if (!videoPath || subtitles.length === 0) return;
      const start = subtitles[subtitles.length - 1].end;
      const operationId = `transcribe-${Date.now()}-tail`;

      // Initialize progress so the UI reflects live updates (like full transcription)
      try {
        useTaskStore.getState().setTranscription({
          id: operationId,
          stage: t('generateSubtitles.status.starting', 'Starting...'),
          percent: 0,
          inProgress: true,
        });
        logTask('start', 'transcription', {
          operationId,
          mode: 'continue-tail',
          start,
        });
      } catch {
        // Do nothing
      }
      await (
        await import('../../ipc/subtitles')
      ).transcribeRemaining({
        videoPath,
        start,
        operationId,
        qualityTranscription: useUIStore.getState().qualityTranscription,
      });
      // Tail segments are appended via progress listener (appendSegments payload)
      // Mark completion explicitly (progress-buffer will also send final 100%)
      try {
        useTaskStore.getState().setTranscription({
          stage: t('generateSubtitles.status.completed', 'Completed'),
          percent: 100,
          inProgress: false,
        });
        logTask('complete', 'transcription', { operationId });
      } catch {
        // Do nothing
      }
    } catch (err) {
      console.error('[EditSubtitles] continue transcribing error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      const friendlyError = isByoError(errorMsg)
        ? getByoErrorMessage(errorMsg)
        : errorMsg || t('generateSubtitles.status.error', 'Error');
      // Surface error state to progress UI
      try {
        useTaskStore.getState().setTranscription({
          stage: friendlyError,
          percent: 100,
          inProgress: false,
        });
        useUrlStore.getState().setOperationError(friendlyError);
      } catch {
        // Do nothing
      }
      logError('continue_transcribing', err as any);
    }
  }

  async function handleSaveEditedSrtAs() {
    try {
      logButton('save_srt_as');
    } catch {
      // Do nothing
    }
    const suggestion = originalPath || 'subtitles.srt';
    const res = await FileIPC.save({
      title: t('dialogs.saveSrtFileAs'),
      defaultPath: suggestion,
      filters: [
        { name: t('common.fileFilters.srtFiles'), extensions: ['srt'] },
      ],
      // Preserve exactly what the user sees (do not auto-wrap lines)
      content: buildSrt({
        segments: subtitles,
        mode: getSrtMode(),
        noWrap: true,
      }),
    });
    if (res.error && !res.error.includes('canceled')) {
      setSaveError(res.error);
    } else if (res.filePath) {
      useSubStore.getState().load(subtitles, res.filePath);
      alert(t('messages.fileSaved', { path: res.filePath }));
    }
  }

  async function writeSrt(path: string) {
    const result = await FileIPC.save({
      filePath: path,
      // Preserve exactly what the user sees (do not auto-wrap lines)
      content: buildSrt({
        segments: subtitles,
        mode: getSrtMode(),
        noWrap: true,
      }),
    });
    if (result.error) {
      setSaveError(result.error);
    } else {
      alert(t('messages.fileSaved', { path: path }));
    }
  }

  async function handleMerge() {
    // Guard against double-clicks / re-entrancy. The merge button is disabled
    // using merge state, but we also do an async disk-space preflight before
    // `startMerge()` runs, so we need a synchronous lock too.
    if (mergeStartLockRef.current || mergeInProgress) return;
    mergeStartLockRef.current = true;

    let opId: string | null = null;
    let ok = false;
    try {
      logButton('merge_start');
      setSaveError('');
      if (!videoPath) {
        setSaveError(t('common.error.noSourceVideo'));
        try {
          logError('merge', 'no_source_video');
        } catch {
          // Do nothing
        }
        return;
      }
      if (subtitles.length === 0) {
        setSaveError(t('common.error.noSubtitlesLoaded'));
        try {
          logError('merge', 'no_subtitles_loaded');
        } catch {
          // Do nothing
        }
        return;
      }
      if (!isAudioOnly) {
        const missing: string[] = [];
        if (!meta?.duration) missing.push('duration');
        if (!meta?.width) missing.push('width');
        if (!meta?.height) missing.push('height');
        if (!meta?.frameRate) missing.push('frame rate');
        if (missing.length) {
          setSaveError(
            t('common.error.missingVideoMetadata', {
              missing: missing.join(', '),
            })
          );
          return;
        }
      }

      // Preflight warning: burn-in merge can create very large files.
      // Only warn when the current free space is close to (or below) a rough estimate.
      setMergePreflightInProgress(true);
      try {
        const [sizeRes, tempSpaceRes] = await Promise.all([
          FileIPC.getFileSize(videoPath),
          FileIPC.getTempDiskSpace(),
        ]);
        const inputBytes = sizeRes.success ? (sizeRes.sizeBytes ?? 0) : 0;
        const freeBytes = tempSpaceRes.success
          ? (tempSpaceRes.freeBytes ?? 0)
          : 0;

        if (inputBytes > 0 && freeBytes > 0) {
          const EST_MULTIPLIER = 5;
          const EST_OVERHEAD_BYTES = 2 * 1024 ** 3; // temp PNGs + misc overhead
          const SAFETY_MULTIPLIER = 1.1; // "around" the estimate
          const estimatedBytes =
            inputBytes * EST_MULTIPLIER + EST_OVERHEAD_BYTES;
          const warnBelowBytes = estimatedBytes * SAFETY_MULTIPLIER;

          const fmt = (bytes: number) => {
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let value = Math.max(0, bytes);
            let unitIndex = 0;
            while (value >= 1024 && unitIndex < units.length - 1) {
              value /= 1024;
              unitIndex++;
            }
            const decimals = unitIndex <= 1 ? 0 : value >= 10 ? 0 : 1;
            return `${value.toFixed(decimals)} ${units[unitIndex]}`;
          };

          if (freeBytes <= warnBelowBytes) {
            const proceed = window.confirm(
              t('dialogs.mergeLowDiskSpaceConfirm', {
                defaultValue:
                  'Low disk space detected. This merge may need ~{{need}} free space, but only ~{{free}} is available. Continue anyway?',
                need: fmt(estimatedBytes),
                free: fmt(freeBytes),
              })
            );
            if (!proceed) return;
          }
        }
      } catch {
        // Best-effort only: never block merge if preflight check fails.
      } finally {
        setMergePreflightInProgress(false);
      }

      setMergeStage(t('progress.starting', 'Starting...'));
      opId = `render-${Date.now()}`;
      onSetMergeOperationId(opId);
      useTaskStore.getState().startMerge();

      const srtContent = buildSrt({
        segments: subtitles,
        mode: getSrtMode(),
        // Important: preserve user-visible lines; let renderer wrap visually
        noWrap: true,
      });

      const {
        baseFontSize,
        subtitleStyle,
        previewSubtitleFontPx,
        previewDisplayHeightPx,
        previewVideoHeightPx,
      } = useUIStore.getState();

      const targetHeight = meta?.height ?? BASELINE_HEIGHT;
      let fontSizePx = isAudioOnly
        ? Math.max(10, baseFontSize)
        : Math.max(10, Math.round(baseFontSize * fontScale(targetHeight)));

      if (
        !isAudioOnly &&
        previewSubtitleFontPx > 0 &&
        previewDisplayHeightPx > 0 &&
        previewVideoHeightPx > 0
      ) {
        const adjusted = Math.round(
          (previewSubtitleFontPx * previewVideoHeightPx) /
            previewDisplayHeightPx
        );
        fontSizePx = Math.max(10, adjusted);
      }

      const opts: RenderSubtitlesOptions = {
        operationId: opId,
        srtContent,
        outputDir: '/placeholder/output/dir',
        videoDuration: meta?.duration ?? 0,
        videoWidth: meta?.width ?? 1280,
        videoHeight: meta?.height ?? 720,
        displayWidth: meta?.displayWidth ?? meta?.width ?? 1280,
        displayHeight: meta?.displayHeight ?? meta?.height ?? 720,
        videoRotationDeg: meta?.rotation ?? 0,
        frameRate: Number(meta?.frameRate ?? 30),
        originalVideoPath: videoPath,
        fontSizePx,
        stylePreset: subtitleStyle,
        overlayMode: isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
      };

      const res = await onStartPngRenderRequest(opts);
      ok = !!res?.success;

      // Defensive: some callers may return {success:false} instead of throwing.
      if (!ok) {
        const errMsg =
          res?.error || t('common.error.renderFailed', 'Render failed');
        throw new Error(errMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const cancelled = /cancel/i.test(errorMsg);
      const isDiskFull =
        errorMsg === ERROR_CODES.INSUFFICIENT_DISK_SPACE ||
        /\bENOSPC\b/i.test(errorMsg) ||
        /no space left on device/i.test(errorMsg) ||
        /disk quota exceeded/i.test(errorMsg);
      const friendlyError = cancelled
        ? t('generateSubtitles.status.cancelled', 'Cancelled')
        : isDiskFull
          ? t('common.error.insufficientDiskSpace')
          : errorMsg || t('generateSubtitles.status.error', 'Error');

      setSaveError(friendlyError);
      setMergeStage(friendlyError);
      try {
        logError('merge', err as any, { operationId: opId || undefined });
      } catch {
        // Do nothing
      }
    } finally {
      mergeStartLockRef.current = false;
      setMergePreflightInProgress(false);
      useTaskStore.getState().doneMerge();
      onSetMergeOperationId(null);
      try {
        logTask('complete', 'merge', {
          success: ok,
          operationId: opId || undefined,
        } as any);
      } catch {
        // Do nothing
      }
    }
  }

  async function handleLoadSrtLocal() {
    try {
      logButton('choose_srt_from_device');
    } catch {
      // Do nothing
    }
    setSaveError('');
    const res = await openSubtitleWithElectron();
    if (res.error && !res.error.includes('canceled')) {
      setSaveError(res.error);
      try {
        logError('open_srt', res.error as any);
      } catch {
        // Do nothing
      }
      return;
    }
    if (res.segments) {
      const associatedVideoPath =
        useVideoStore.getState().originalPath ??
        useVideoStore.getState().path ??
        null;
      useSubStore
        .getState()
        .load(
          res.segments,
          res.filePath ?? null,
          'disk',
          associatedVideoPath
        );
      // Reset the 'Transcription Complete' state when user mounts a different SRT from disk
      try {
        useTaskStore.getState().setTranscription({
          isCompleted: false,
          inProgress: false,
          id: null,
          stage: '',
          percent: 0,
        });
      } catch {
        // Do nothing
      }
    }
  }

  async function handleMountVideoForSubs() {
    try {
      await useVideoStore
        .getState()
        .openLocalMedia({ preserveSubtitles: true });
    } catch (err) {
      console.error('[EditSubtitles] mount video error:', err);
      setSaveError(t('common.error.unexpected'));
    }
  }
}
