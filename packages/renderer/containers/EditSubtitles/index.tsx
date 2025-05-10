import React, { useEffect, useRef, useState, useCallback } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

import Section from '../../components/Section';
import ErrorBanner from '../../components/ErrorBanner';
import Button from '../../components/Button';
import FileInputButton from '../../components/FileInputButton';

import SubtitleList from './SubtitleList';
import BottomMenu from './BottomMenu';
import EditSubtitlesHeader from './EditSubtitlesHeader';

import { buildSrt, openSubtitleWithElectron } from '../../../shared/helpers';
import { scrollWhenReady, useSubtitleNavigation } from './hooks/index.js';
import { flashSubtitle, scrollPrecisely } from '../../utils/scroll.js';

import { colors } from '../../styles';

import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';

import * as FileIPC from '@ipc/file';

import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';
import { getNativePlayerInstance } from '../../native-player';

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
  const { searchText, showOriginalText, activeMatchIndex } = useUIStore();
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

  const { originalPath, setOriginalPath } = useSubStore(s => ({
    originalPath: s.originalPath,
    setOriginalPath: s.setOriginalPath,
  }));
  const canSaveDirectly = !!originalPath;

  /* ---------- local UI state ---------- */
  const [saveError, setSaveError] = useState('');
  const [affectedRows, setAffectedRows] = useState<number[]>([]);
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const prevSubsRef = useRef<SrtSegment[]>([]);
  const prevReviewedBatchRef = useRef<number | null>(null);

  /** remembers which match we last scrolled to */
  const prevActiveRef = useRef(activeMatchIndex);

  /* ---------- scrolling helpers ---------- */
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

  /* expose helpers to parent */
  useEffect(() => {
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  /* ---------- Cmd/Ctrl‑F navigation between matches ---------- */
  useEffect(() => {
    const localMatchIndices = collectMatchIndices(
      subtitles,
      searchText,
      showOriginalText
    );

    const currentMatchedIndices = useUIStore.getState().matchedIndices;
    if (!sameArray(currentMatchedIndices, localMatchIndices)) {
      useUIStore.getState().setMatchedIndices(localMatchIndices);
    }

    // scroll *only* when the user actively navigates or search criteria change
    if (
      prevActiveRef.current !== activeMatchIndex &&
      localMatchIndices.length > 0 &&
      activeMatchIndex < localMatchIndices.length
    ) {
      scrollToSubtitleIndex(localMatchIndices[activeMatchIndex]);
    }

    // remember for the next run
    prevActiveRef.current = activeMatchIndex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchText,
    activeMatchIndex,
    showOriginalText,
    scrollToSubtitleIndex,
    // subtitles is intentionally omitted to prevent scrolling on every edit
    // The current subtitles are accessed directly within the effect's closure
  ]);

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
    scrollWhenReady({
      id,
      subtitleRefs: subtitleRefs,
      smooth: false,
      onSuccess: done,
    });
  }, [affectedRows, subtitles]);

  useEffect(() => {
    prevSubsRef.current = subtitles;
  }, [subtitles]);

  const getSrtMode = () => (showOriginalText ? 'dual' : 'translation');

  return (
    <Section title={t('editSubtitles.title')} overflowVisible>
      {saveError && (
        <ErrorBanner message={saveError} onClose={() => setSaveError('')} />
      )}

      {/* file / srt pickers */}
      {(!videoFile || subtitles.length === 0) && (
        <div style={{ marginTop: 30 }}>
          {!videoFile && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: 10,
              }}
            >
              <FileInputButton onClick={handleSelectVideoClick}>
                {t('input.selectVideoAudioFile')}
              </FileInputButton>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginBottom: 10,
            }}
          >
            <Button variant="secondary" size="lg" onClick={handleLoadSrtLocal}>
              {t('subtitles.chooseSrtFile')}
            </Button>
          </div>
        </div>
      )}

      {/* subtitle list */}
      {subtitles.length > 0 && (
        <>
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
          <EditSubtitlesHeader
            onSave={handleSaveSrt}
            onSaveAs={handleSaveEditedSrtAs}
            canSaveDirectly={canSaveDirectly}
            subtitlesExist={subtitles.length > 0}
          />

          <BottomMenu
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
    const suggestion = originalPath || 'edited_subtitles.srt';
    const res = await FileIPC.save({
      title: 'Save SRT File As',
      defaultPath: suggestion,
      filters: [{ name: 'SRT Files', extensions: ['srt'] }],
      content: buildSrt({ segments: subtitles, mode: getSrtMode() }),
    });
    if (res.error && !res.error.includes('canceled')) {
      setSaveError(res.error);
    } else if (res.filePath) {
      await writeSrt(res.filePath);
      setOriginalPath(res.filePath);
    }
  }

  async function writeSrt(path: string) {
    const result = await FileIPC.save({
      filePath: path,
      content: buildSrt({ segments: subtitles, mode: getSrtMode() }),
    });
    if (result.error) {
      setSaveError(result.error);
    } else {
      alert(`File saved:\n${path}`);
    }
  }

  /* ---------- merge to video ---------- */
  async function handleMerge() {
    try {
      if (!videoPath) {
        setSaveError('No source video');
        return;
      }
      if (subtitles.length === 0) {
        setSaveError('No subtitles loaded');
        return;
      }
      if (!isAudioOnly) {
        const missing: string[] = [];
        if (!meta?.duration) missing.push('duration');
        if (!meta?.width) missing.push('width');
        if (!meta?.height) missing.push('height');
        if (!meta?.frameRate) missing.push('frame rate');
        if (missing.length) {
          setSaveError(`Missing video metadata (${missing.join(', ')})`);
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

      const opts: RenderSubtitlesOptions = {
        operationId: opId,
        srtContent,
        outputDir: '/placeholder/output/dir',
        videoDuration: meta?.duration ?? 0,
        videoWidth: meta?.width ?? 1280,
        videoHeight: meta?.height ?? 720,
        frameRate: Number(meta?.frameRate ?? 30),
        originalVideoPath: videoPath,
        fontSizePx: baseFontSize,
        stylePreset: subtitleStyle,
        overlayMode: isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
      };

      const res = await onStartPngRenderRequest(opts);
      if (!res.success) {
        setSaveError(res.error || 'Render failed');
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
      subStore.load(res.segments);
      setOriginalPath(res.filePath ?? null);
    }
  }

  async function handleSelectVideoClick() {
    const result = await FileIPC.open({
      properties: ['openFile'],
      filters: [
        {
          name: 'Media Files',
          extensions: [
            'mp4',
            'mkv',
            'avi',
            'mov',
            'webm',
            'mp3',
            'wav',
            'aac',
            'ogg',
            'flac',
          ],
        },
      ],
    });
    if (!result.canceled && result.filePaths.length) {
      await useVideoStore.getState().setFile({
        name: result.filePaths[0].split(/[\\/]/).pop() || 'media',
        path: result.filePaths[0],
      });
      setOriginalPath(null);
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

function sameArray(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
