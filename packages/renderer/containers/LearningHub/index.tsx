import { useCallback, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { useTranslation } from 'react-i18next';
import Section from '../../components/Section';
import { colors } from '../../styles';
import type { LearningEntry, SrtSegment } from '@shared-types/app';
import * as LearningIPC from '../../ipc/learning';
import { parseSrt } from '../../../shared/helpers';
import { useSubStore, useUIStore, useVideoStore } from '../../state';
import LearningHubEntryList from './EntryList';
import LearningHubViewer from './Viewer';
import { emptyStateStyles, layoutStyles, warningStyles } from './styles';
import type { LanguageKey, SelectedEntryState } from './types';

export default function LearningHub() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<LearningEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedEntryState | null>(null);
  const [videoMissing, setVideoMissing] = useState(false);
  const [srtError, setSrtError] = useState<string | null>(null);
  const activeShell = useUIStore(s => s.activeShell);
  const activeVideoUrl = useVideoStore(s => s.url);
  const transcriptSegments = useSubStore(
    useCallback(
      s =>
        s.order
          .map(id => s.segments[id])
          .filter((seg): seg is SrtSegment => Boolean(seg)),
      []
    )
  );

  const refreshEntries = useCallback(async () => {
    setLoading(true);
    try {
      const list = await LearningIPC.listEntries();
      setEntries(list);
      setError(null);
      setSelected(prev =>
        prev && list.some(entry => entry.id === prev.id) ? prev : null
      );
      if (list.length === 0) {
        setVideoMissing(false);
        setSrtError(null);
      }
    } catch (err: any) {
      console.error('[LearningHub] Failed to load entries', err);
      setError(err?.message ?? 'Unable to load learning history');
      setEntries([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshEntries();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshEntries, activeShell]);

  const handleSelectLanguage = useCallback(
    async (entry: LearningEntry, language: LanguageKey) => {
      const filePath =
        language === 'transcript'
          ? entry.transcriptPath
          : entry.translations[language];

      if (!filePath) {
        setSrtError(
          t(
            'learningHub.errors.missingFile',
            'No subtitles saved for this selection.'
          )
        );
        return;
      }

      setSrtError(null);
      setVideoMissing(false);

      try {
        const content = await (window as any).fileApi.readText(filePath);
        const segments = parseSrt(content ?? '');
        useSubStore
          .getState()
          .load(segments, filePath, 'disk', entry.videoPath ?? null);
        try {
          useUIStore.getState().setEditPanelOpen(true);
        } catch {
          // ignore UI store errors
        }
        setSelected({ id: entry.id, language });
      } catch (err) {
        console.error('[LearningHub] Failed to open subtitles', err);
        setSrtError(
          t('learningHub.errors.failedToLoad', 'Unable to open subtitles.')
        );
        return;
      }

      if (entry.videoPath) {
        let exists: boolean | null = null;
        try {
          const res = await (window as any).electron.pathExists?.(
            entry.videoPath
          );
          exists = Boolean(res?.exists);
        } catch (err) {
          console.error('[LearningHub] Failed to verify video path', err);
          exists = null;
        }

        if (exists === false) {
          setVideoMissing(true);
          return;
        }

        try {
          await useVideoStore.getState().setFile({
            name: entry.title,
            path: entry.videoPath,
            sourceKind: entry.sourceType ?? 'unknown',
          });
          setVideoMissing(false);
        } catch (err) {
          console.error('[LearningHub] Failed to mount video', err);
          setVideoMissing(true);
        }
      } else {
        setVideoMissing(true);
      }
    },
    [t]
  );

  const selectedEntry = useMemo(
    () => entries.find(entry => entry.id === selected?.id) ?? null,
    [entries, selected?.id]
  );

  return (
    <Section
      title={t('learningHub.title', 'Learning Hub')}
      headerRight={
        <span
          className={css`
            font-size: 0.85rem;
            color: ${colors.gray};
          `}
        >
          {t('learningHub.statusInProgress', 'Preview')}
        </span>
      }
    >
      <div className={layoutStyles}>
        {loading ? (
          <div className={emptyStateStyles}>
            {t('learningHub.loading', 'Loading your transcribed videos…')}
          </div>
        ) : error ? (
          <div className={warningStyles}>{error}</div>
        ) : entries.length === 0 ? (
          <div className={emptyStateStyles}>
            {t(
              'learningHub.empty',
              'Transcribe a video to see it appear in your learning history.'
            )}
          </div>
        ) : (
          <LearningHubEntryList
            entries={entries}
            selected={selected}
            onSelectLanguage={handleSelectLanguage}
            t={t}
            locale={i18n.language}
          />
        )}

        <LearningHubViewer
          selectedEntry={selectedEntry}
          selectedLanguage={selected?.language ?? null}
          transcriptSegments={transcriptSegments}
          srtError={srtError}
          videoMissing={videoMissing}
          activeVideoUrl={activeVideoUrl}
          t={t}
        />
      </div>
    </Section>
  );
}
