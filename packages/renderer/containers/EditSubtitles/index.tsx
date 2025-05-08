import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  Dispatch,
  SetStateAction,
} from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';

import Section from '../../components/Section';
import ErrorBanner from '../../components/ErrorBanner';
import Button from '../../components/Button';
import FileInputButton from '../../components/FileInputButton';

import SubtitleList from './SubtitleList';
import MergeControls from './MergeControls';
import EditSubtitlesHeader from './EditSubtitlesHeader';

import { buildSrt, openSubtitleWithElectron } from '../../../shared/helpers';
import {
  flashSubtitle,
  scrollPrecisely,
  scrollWhenReady,
  useSubtitleNavigation,
} from './hooks';

import { colors } from '../../styles';
import {
  SubtitleStylePresetKey,
  SUBTITLE_STYLE_PRESETS,
} from '../../../shared/constants/subtitle-styles';
import {
  useUIStore,
  useVideoStore,
  useTaskStore,
  useSubStore,
} from '../../state';

import { RenderSubtitlesOptions, SrtSegment } from '@shared-types/app';

/* ------------------------------------------------------------------ */
/* props still provided by parent */
/* ------------------------------------------------------------------ */
export interface EditSubtitlesProps {
  setMergeStage: (stage: string) => void;
  onSetMergeOperationId: (id: string | null) => void;
  onStartPngRenderRequest: (
    opts: RenderSubtitlesOptions
  ) => Promise<{ success: boolean; error?: string }>;
  /* optional – expose scroll helpers to parent */
  editorRef?: React.RefObject<{
    scrollToCurrentSubtitle: () => void;
    scrollToSubtitleIndex: (idx: number) => void;
  }>;
}

/* ------------------------------------------------------------------ */
/* EditSubtitles component */
/* ------------------------------------------------------------------ */
export default function EditSubtitles({
  setMergeStage,
  onSetMergeOperationId,
  onStartPngRenderRequest,
  editorRef,
}: EditSubtitlesProps) {
  /* ---------- stores ---------- */
  const { searchText, showOriginalText } = useUIStore();
  const {
    file: videoFile,
    path: videoPath,
    isAudioOnly,
    meta,
  } = useVideoStore();
  const { t } = useTranslation();
  const { merge, translation } = useTaskStore();
  const subStore = useSubStore();
  const subtitles = subStore.order.map(id => subStore.segments[id]);

  /* ---------- local UI state ---------- */
  const [mergeFontSize, setMergeFontSize] = useState<number>(
    () => Number(localStorage.getItem('savedMergeFontSize')) || 24
  );

  const [mergeStylePreset, setMergeStylePreset] =
    useState<SubtitleStylePresetKey>(
      () =>
        (localStorage.getItem(
          'savedMergeStylePreset'
        ) as SubtitleStylePresetKey) || 'Default'
    );

  const [saveError, setSaveError] = useState('');
  const [affectedRows, setAffectedRows] = useState<number[]>([]);
  const subtitleRefs = useRef<Record<string, HTMLDivElement | null>>({});

  /* ---------- persist UI prefs ---------- */
  useEffect(() => {
    localStorage.setItem('savedMergeFontSize', String(mergeFontSize));
  }, [mergeFontSize]);
  useEffect(() => {
    localStorage.setItem('savedMergeStylePreset', mergeStylePreset);
  }, [mergeStylePreset]);

  /* ---------- scrolling helpers ---------- */
  const activePlayer = null; // replace with getNativePlayerInstance() if needed
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
    if (editorRef?.current) {
      editorRef.current.scrollToCurrentSubtitle = scrollToCurrentSubtitle;
      editorRef.current.scrollToSubtitleIndex = scrollToSubtitleIndex;
    }
  }, [editorRef, scrollToCurrentSubtitle, scrollToSubtitleIndex]);

  /* ---------- handle “open SRT” button ---------- */
  async function handleLoadSrtLocal() {
    setSaveError('');
    const res = await openSubtitleWithElectron();
    if (res.error && !res.error.includes('canceled')) {
      setSaveError(res.error);
      return;
    }
    if (res.segments) subStore.load(res.segments);
  }

  /* ---------- merge to video ---------- */
  async function handleMerge() {
    if (!videoPath) {
      setSaveError('No source video');
      return;
    }
    if (subtitles.length === 0) {
      setSaveError('No subtitles loaded');
      return;
    }

    setMergeStage('Starting render...');
    const opId = `render-${Date.now()}`;
    onSetMergeOperationId(opId);

    const srtContent = buildSrt({
      segments: subtitles,
      mode: showOriginalText ? 'dual' : 'translation',
    });

    const opts: RenderSubtitlesOptions = {
      operationId: opId,
      srtContent,
      outputDir: '/placeholder/output/dir',
      videoDuration: meta?.duration ?? 0,
      videoWidth: meta?.width ?? 1280,
      videoHeight: meta?.height ?? 720,
      frameRate: meta?.frameRate ?? 30,
      originalVideoPath: videoPath,
      fontSizePx: mergeFontSize,
      stylePreset: mergeStylePreset,
      overlayMode: isAudioOnly ? 'blackVideo' : 'overlayOnVideo',
    };

    const res = await onStartPngRenderRequest(opts);
    if (!res.success) {
      setSaveError(res.error || 'Render failed');
      setMergeStage('Error');
      onSetMergeOperationId(null);
    }
  }

  /* ---------- render ---------- */
  return (
    <Section title={useTranslation().t('editSubtitles.title')} overflowVisible>
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
              <FileInputButton
                onClick={() => {
                  /* trigger file-open */
                }}
              >
                Select video / audio file
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
            onSave={() => {
              /* call save in store */
            }}
            onSaveAs={() => {
              /* save as */
            }}
            canSaveDirectly={false}
            subtitlesExist={subtitles.length > 0}
          />

          <MergeControls
            mergeFontSize={mergeFontSize}
            setMergeFontSize={setMergeFontSize}
            mergeStylePreset={mergeStylePreset}
            setMergeStylePreset={setMergeStylePreset}
            onMergeMediaWithSubtitles={handleMerge}
            isMergingInProgress={merge.inProgress}
            videoFileExists={!!videoPath}
            subtitlesExist={subtitles.length > 0}
            isTranslationInProgress={translation.inProgress}
          />
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* util – calculate rows to flash after batch review */
/* ------------------------------------------------------------------ */
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
