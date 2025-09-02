import React, { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

import Section from '../../components/Section';
import ErrorBanner from '../../components/ErrorBanner';
import Button from '../../components/Button';
import { subtleAccentButton } from '../../styles.js';

import SubtitleList from './SubtitleList';
import MergeMenu from './MergeMenu';
import SaveMenu from './SaveMenu';

import { buildSrt, openSubtitleWithElectron } from '../../../shared/helpers';
import { flashReviewedSegment, useSubtitleNavigation } from './hooks/index.js';
import { flashSubtitle, scrollPrecisely } from '../../utils/scroll.js';
import { BASELINE_HEIGHT, fontScale } from '../../../shared/constants';

import { colors, selectStyles } from '../../styles';
import {
  TRANSLATION_LANGUAGE_GROUPS,
  TRANSLATION_LANGUAGES_BASE,
} from '../../constants/translation-languages';

import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';

import * as FileIPC from '@ipc/file';

import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';
import { getNativePlayerInstance } from '../../native-player';
import { sameArray } from '../../utils/array';
import { translateMissingUntranslated } from '../../utils/translateMissing';

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

function EditHeaderTranslateBar({
  disabled,
  onTranslate,
}: {
  disabled?: boolean;
  onTranslate: () => void;
}) {
  const { t } = useTranslation();
  const targetLanguage = useUIStore(s => s.targetLanguage);
  const setTargetLanguage = useUIStore(s => s.setTargetLanguage);

  // Use a distinct accent color (not green/blue)
  const borderColor = colors.progressDownload; // yellow
  const bgColor = `${colors.progressDownload}20`; // light translucent

  return (
    <div
      className={css`
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 1px solid ${borderColor};
        border-radius: 6px;
        background: ${bgColor};
      `}
    >
      <label
        className={css`
          margin-right: 4px;
          color: ${colors.dark};
          font-size: 0.95rem;
        `}
      >
        {t('subtitles.outputLanguage')}:
      </label>
      <select
        className={selectStyles}
        value={targetLanguage}
        onChange={e => setTargetLanguage(e.target.value)}
        disabled={disabled}
      >
        {/* Base/common languages first */}
        {TRANSLATION_LANGUAGES_BASE.map(opt => (
          <option key={opt.value} value={opt.value}>
            {t(opt.labelKey)}
          </option>
        ))}
        {/* Then grouped by region */}
        {TRANSLATION_LANGUAGE_GROUPS.map(group => (
          <optgroup key={group.labelKey} label={t(group.labelKey)}>
            {group.options.map(opt => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <Button
        variant="primary"
        size="sm"
        onClick={onTranslate}
        disabled={disabled}
      >
        {t('subtitles.translate', 'Translate')}
      </Button>
    </div>
  );
}

export default function EditSubtitles({
  setMergeStage,
  onSetMergeOperationId,
  onStartPngRenderRequest,
  editorRef,
}: EditSubtitlesProps) {
  const { searchText, showOriginalText, navTick } = useUIStore();
  const {
    file: videoFile,
    path: videoPath,
    isAudioOnly,
    meta,
  } = useVideoStore();
  const { t } = useTranslation();
  const { merge: mergeTask, translation } = useTaskStore();
  const subStore = useSubStore();
  const subtitles = subStore.order.map(id => subStore.segments[id]);
  const sourceId = useSubStore(s => s.sourceId);
  const origin = useSubStore(s => s.origin);

  const { originalPath } = useSubStore();
  const canSaveDirectly = !!originalPath;

  const [saveError, setSaveError] = useState('');
  const [affectedRows, setAffectedRows] = useState<number[]>([]);
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
    const local = collectMatchIndices(subtitles, searchText, showOriginalText);
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

  const rbs = translation.reviewedBatchStartIndex;
  useEffect(() => {
    if (rbs == null || rbs === prevReviewedBatchRef.current) return;

    const diff = calcAffected(prevSubsRef.current, subtitles, rbs);
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

  // Prompt once after a fresh translation to choose display mode (Dual vs Translation Only)
  const lastPromptedRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      origin === 'fresh' &&
      translation.isCompleted &&
      !translation.inProgress &&
      subtitles.length > 0 &&
      lastPromptedRef.current !== sourceId
    ) {
      const hasTranslation = subtitles.some(
        s => (s.translation ?? '').trim().length > 0
      );
      if (hasTranslation) {
        const msg =
          `${t('subtitles.translation')} – ${t(
            'subtitles.showOriginalText'
          )} ?\n` +
          `${t('common.confirm')}: ${t('subtitles.showOriginalText')} (Dual)\n` +
          `${t('common.cancel')}: ${t('subtitles.translation')} Only`;
        const dual = window.confirm(msg);
        useUIStore.getState().setShowOriginalText(!!dual);
        lastPromptedRef.current = sourceId;
      }
    }
  }, [
    origin,
    translation.isCompleted,
    translation.inProgress,
    sourceId,
    subtitles,
    t,
  ]);

  async function handleTranslateMissing() {
    try {
      await translateMissingUntranslated();
    } catch (err) {
      console.error('[EditSubtitles] translate missing error:', err);
      useTaskStore.getState().setTranslation({
        stage: t('generateSubtitles.status.error', 'Error'),
        percent: 100,
        inProgress: false,
      });
    }
  }

  const hasUntranslated = subtitles.some(
    s => (s.original || '').trim() && !(s.translation || '').trim()
  );

  const isTranscribing = useTaskStore(s => !!s.transcription.inProgress);

  const headerRight = hasUntranslated ? (
    <EditHeaderTranslateBar
      disabled={translation.inProgress || isTranscribing}
      onTranslate={handleTranslateMissing}
    />
  ) : null;

  return (
    <Section
      title={t('editSubtitles.title')}
      headerRight={headerRight}
      overflowVisible
    >
      {saveError && (
        <ErrorBanner message={saveError} onClose={() => setSaveError('')} />
      )}

      {(!videoFile || subtitles.length === 0) && (
        <div style={{ marginTop: 30 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 10,
            }}
          >
            <Button
              variant="secondary"
              size="lg"
              onClick={handleLoadSrtLocal}
              className={subtleAccentButton}
              title={t('subtitles.chooseSrtFile')}
            >
              <div
                className={css`
                  display: inline-flex;
                  align-items: center;
                  gap: 10px;
                `}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{t('subtitles.chooseSrtFile')}</span>
              </div>
            </Button>
          </div>
        </div>
      )}

      {subtitles.length > 0 && (
        <>
          {/* Mount video CTA when subtitles exist but no video is mounted */}
          {!videoPath && (
            <div
              className={css`
                display: flex;
                justify-content: center;
                margin: 10px 0 4px;
              `}
            >
              <Button
                variant="secondary"
                size="md"
                onClick={handleMountVideoForSubs}
                className={subtleAccentButton}
                title={t('input.selectVideoAudioFile')}
              >
                <div
                  className={css`
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                  `}
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
                    aria-hidden
                  >
                    <rect x="2" y="7" width="15" height="10" rx="2" />
                    <polygon points="23 7 16 12 23 17 23 7" />
                  </svg>
                  <span>{t('input.selectVideoAudioFile')}</span>
                </div>
              </Button>
            </div>
          )}

          <h3 style={{ margin: '10px 0' }}>
            {t('editSubtitles.listTitle', {
              count: subtitles.length,
            })}
          </h3>

          <div
            className={css`
              display: flex;
              flex-direction: column;
              gap: 15px;
              margin-bottom: 80px;
            `}
          >
            <SubtitleList
              subtitleRefs={subtitleRefs}
              searchText={searchText}
              affectedRows={affectedRows}
            />
          </div>
        </>
      )}

      {subtitles.length > 0 && (
        <div
          className={css`
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            padding: 15px 20px;
            background: rgba(30, 30, 30, 0.75);
            backdrop-filter: blur(12px);
            border-top: 1px solid ${colors.border};
            display: flex;
            align-items: center;
            gap: 10px;
            justify-content: center;
            z-index: 100;
          `}
        >
          <SaveMenu
            onSave={handleSaveSrt}
            onSaveAs={handleSaveEditedSrtAs}
            canSaveDirectly={canSaveDirectly}
            subtitlesExist={subtitles.length > 0}
          />

          <MergeMenu
            onMergeMediaWithSubtitles={handleMerge}
            isMergingInProgress={mergeTask.inProgress}
            videoFileExists={!!videoPath}
            subtitlesExist={subtitles.length > 0}
            isTranslationInProgress={translation.inProgress}
          />
        </div>
      )}
    </Section>
  );

  async function handleSaveSrt() {
    if (!originalPath) return handleSaveEditedSrtAs();
    await writeSrt(originalPath);
  }

  async function handleSaveEditedSrtAs() {
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
      subStore.load(subtitles, res.filePath);
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
    try {
      if (!videoPath) {
        setSaveError(t('common.error.noSourceVideo'));
        return;
      }
      if (subtitles.length === 0) {
        setSaveError(t('common.error.noSubtitlesLoaded'));
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

      setMergeStage('Starting render…');
      const opId = `render-${Date.now()}`;
      onSetMergeOperationId(opId);
      useTaskStore.getState().startMerge();

      const srtContent = buildSrt({
        segments: subtitles,
        mode: getSrtMode(),
      });

      const { baseFontSize, subtitleStyle } = useUIStore.getState();

      const targetHeight = meta?.height ?? BASELINE_HEIGHT;
      const scaledFontSize = isAudioOnly
        ? baseFontSize
        : Math.max(1, Math.round(baseFontSize * fontScale(targetHeight)));

      const opts: RenderSubtitlesOptions = {
        operationId: opId,
        srtContent,
        outputDir: '/placeholder/output/dir',
        videoDuration: meta?.duration ?? 0,
        videoWidth: meta?.width ?? 1280,
        videoHeight: meta?.height ?? 720,
        frameRate: Number(meta?.frameRate ?? 30),
        originalVideoPath: videoPath,
        fontSizePx: scaledFontSize,
        stylePreset: subtitleStyle,
        overlayMode: isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
      };

      const res = await onStartPngRenderRequest(opts);
      if (!res.success) {
        setSaveError(res.error || t('common.error.renderFailed'));
        setMergeStage('Error');
        onSetMergeOperationId(null);
      }
    } finally {
      useTaskStore.getState().doneMerge();
    }
  }

  async function handleLoadSrtLocal() {
    setSaveError('');
    const res = await openSubtitleWithElectron();
    if (res.error && !res.error.includes('canceled')) {
      setSaveError(res.error);
      return;
    }
    if (res.segments) {
      subStore.load(res.segments, res.filePath ?? null);
    }
  }

  async function handleMountVideoForSubs() {
    try {
      await useVideoStore.getState().openFileDialogPreserveSubs();
    } catch (err) {
      console.error('[EditSubtitles] mount video error:', err);
      setSaveError(t('common.error.unexpected'));
    }
  }

  function calcAffected(
    prev: SrtSegment[],
    next: SrtSegment[],
    start: number | null | undefined
  ): number[] {
    if (start == null) return [];
    const BATCH = 50,
      out: number[] = [];
    for (
      let i = start;
      i < Math.min(start + BATCH, prev.length, next.length);
      i++
    ) {
      if (
        prev[i] &&
        next[i] &&
        (prev[i].original !== next[i].original ||
          prev[i].translation !== next[i].translation)
      )
        out.push(i);
    }
    return out;
  }
}

function collectMatchIndices(
  subs: SrtSegment[],
  term: string,
  showOriginal: boolean
) {
  if (!term.trim()) return [];
  const needle = term.toLowerCase();
  return subs
    .map((seg, idx) => {
      const originalText = seg.original || '';
      const translationText = seg.translation || '';
      const haystack = showOriginal
        ? `${originalText}\n${translationText}`.toLowerCase()
        : (translationText || originalText).toLowerCase();
      return haystack.includes(needle) ? idx : -1;
    })
    .filter(idx => idx !== -1);
}
