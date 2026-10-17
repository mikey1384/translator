import { openSubtitleWithElectron } from '../../shared/helpers';
import { i18n } from '../i18n';
import { useSubStore } from '../state/subtitle-store';
import { useTaskStore } from '../state/task-store';
import { reportUnreadableCues } from './subtitleImportNotice';
import { confirmReplaceUnsavedSubtitles } from './unsaved-subtitles';

export type OpenSubtitleFileResult =
  | { status: 'loaded'; filePath: string | null }
  | { status: 'cancelled' }
  | { status: 'error'; error: string };

/**
 * Opens an .srt (asking for one when no path is given) and mounts it as the
 * current subtitles, asking first about unsaved edits.
 */
export async function openSubtitleFileIntoStore({
  filePath,
  dialogTitle,
}: {
  filePath?: string;
  dialogTitle?: string;
} = {}): Promise<OpenSubtitleFileResult> {
  const res = await openSubtitleWithElectron({
    filePath,
    dialogTitle:
      dialogTitle ?? i18n.t('subtitles.chooseSrtFile', 'Choose SRT File'),
    filterName: i18n.t('common.fileFilters.subtitleFiles', 'Subtitle files'),
  });
  if (res.error && !res.cancelled) return { status: 'error', error: res.error };
  if (!res.segments) return { status: 'cancelled' };
  if (!(await confirmReplaceUnsavedSubtitles())) return { status: 'cancelled' };

  const subStore = useSubStore.getState();
  subStore.load(
    res.segments,
    res.filePath ?? null,
    'disk',
    res.document?.sourceVideoPath ?? null,
    res.document?.transcriptionEngine,
    null,
    res.document?.sourceVideoAssetIdentity,
    res.document ?? null
  );
  subStore.setActiveFileTarget({
    filePath: res.filePath ?? null,
    mode: res.fileMode ?? null,
    role: res.fileRole ?? 'import',
  });
  reportUnreadableCues(res.unreadableCues);
  // A different .srt: an earlier "Transcription complete" no longer applies.
  useTaskStore.getState().setTranscription({
    isCompleted: false,
    inProgress: false,
    id: null,
    stage: '',
    percent: 0,
  });
  return { status: 'loaded', filePath: res.filePath ?? null };
}
