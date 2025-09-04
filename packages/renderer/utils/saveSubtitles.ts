import * as FileIPC from '../ipc/file';
import { useSubStore, useUIStore } from '../state';
import { buildSrt } from '../../shared/helpers';
import { i18n } from '../i18n';

function getSrtMode(): 'dual' | 'translation' | 'original' {
  const showOriginal = useUIStore.getState().showOriginalText;
  return showOriginal ? 'dual' : 'translation';
}

function getCurrentSrtContent(): string {
  const store = useSubStore.getState();
  const segments = store.order.map(id => store.segments[id]);
  return buildSrt({ segments, mode: getSrtMode(), noWrap: true });
}

export async function saveSubtitlesToPath(path: string): Promise<boolean> {
  const content = getCurrentSrtContent();
  const result = await FileIPC.save({ filePath: path, content });
  return !result.error;
}

export async function saveSubtitlesAs(): Promise<boolean> {
  const store = useSubStore.getState();
  const segments = store.order.map(id => store.segments[id]);
  const content = buildSrt({ segments, mode: getSrtMode(), noWrap: true });
  const suggestion = store.originalPath || 'subtitles.srt';
  const res = await FileIPC.save({
    title: i18n.t('dialogs.saveSrtFileAs'),
    defaultPath: suggestion,
    filters: [
      { name: i18n.t('common.fileFilters.srtFiles'), extensions: ['srt'] },
    ],
    content,
  });
  if (res.error || !res.filePath) return false;
  // Update originalPath to enable direct save next time
  // Mounting a saved file counts as a disk-origin SRT, not fresh
  useSubStore.getState().load(segments, res.filePath, 'disk', null);
  return true;
}

/**
 * Save using existing path if available, otherwise Save As.
 */
export async function saveCurrentSubtitles(): Promise<boolean> {
  const path = useSubStore.getState().originalPath;
  if (path) return saveSubtitlesToPath(path);
  return saveSubtitlesAs();
}
