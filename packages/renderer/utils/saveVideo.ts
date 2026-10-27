import * as FileIPC from '../ipc/file';
import * as SystemIPC from '../ipc/system';
import { i18n } from '../i18n';
import { syncSavedVideoSuggestionHistoryPath } from '../containers/GenerateSubtitles/components/VideoSuggestionPanel/video-suggestion-local-storage.js';
import { syncStoredSubtitleVideoAssociationPath } from './subtitle-library';
import { useSubStore } from '../state/subtitle-store';
import { useVideoStore } from '../state/video-store';
import { getNativePlayerInstance } from '../native-player';
import {
  getSourceVideoUnavailableMessage,
  isSourceVideoPathAccessible,
} from './sourceVideoErrors';

const VIDEO_FILE_EXTENSIONS = ['mp4', 'mkv', 'webm', 'mov', 'avi'];

function getVideoFilters(extensions: string[]) {
  return [
    {
      name: i18n.t('common.fileFilters.videoFiles'),
      extensions,
    },
  ];
}

function removeYtDlpPrefix(filename: string): string {
  return filename.startsWith('ytdl_') ? filename.slice(5) : filename;
}

function sanitizeVoiceSuffix(voice: string | null | undefined): string {
  return (
    (voice || 'voice').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'voice'
  );
}

async function saveVideoCopy(options: {
  sourcePath: string;
  title: string;
  defaultPath: string;
  extensions: string[];
  successMessage: string;
  errorLabel: string;
}): Promise<string | null> {
  let savedPath: string;
  try {
    const { success, canceled, filePath, error } = await FileIPC.save({
      title: options.title,
      defaultPath: options.defaultPath,
      // Copy in the save operation itself. Creating an empty destination first
      // would truncate the source if the user chooses its existing path.
      sourcePath: options.sourcePath,
      filters: getVideoFilters(options.extensions),
    });

    if (canceled) return null;
    if (!success || error || !filePath) {
      throw new Error(error || 'The save operation did not return a file.');
    }
    savedPath = filePath;
  } catch (err) {
    console.error(`[save-video] ${options.errorLabel}:`, err);
    await SystemIPC.showMessage(i18n.t('errors.unexpectedSave'), {
      type: 'error',
    }).catch(messageError => {
      console.error('[save-video] Failed to show save error:', messageError);
    });
    return null;
  }

  // The saved file is authoritative even if the confirmation cannot be shown.
  // Keep history and the mounted source pointed at the completed save.
  await SystemIPC.showMessage(
    options.successMessage.replace('{{path}}', savedPath)
  ).catch(error => {
    console.error('[save-video] Failed to show save confirmation:', error);
  });
  return savedPath;
}

export function pathsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) {
    return false;
  }

  const normalize = (value: string) =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

  return normalize(a) === normalize(b);
}

export function isManagedTempOriginalVideoPath(
  originalVideoPath: string | null
): boolean {
  if (!originalVideoPath) {
    return false;
  }

  const normalizedPath = originalVideoPath
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  const fileName = normalizedPath.split('/').pop() || '';
  const isManagedTempDir =
    normalizedPath.includes('/translator-electron/') ||
    normalizedPath.includes('/translator-electron-dev/') ||
    normalizedPath.includes('/translator-electron-work/') ||
    normalizedPath.includes('/translator-electron-dev-work/') ||
    normalizedPath.includes('/translator-electron-monorepo/') ||
    normalizedPath.includes('/downloaded-media/');
  // Promoted downloads in the library are named after the video's title.
  const isManagedDownloadName =
    /^download_\d+_.+\.[a-z0-9]+$/i.test(fileName) ||
    /^ytdl_.+\.[a-z0-9]+$/i.test(fileName) ||
    (normalizedPath.includes('/downloaded-media/') &&
      /\.[a-z0-9]+$/i.test(fileName));

  return isManagedTempDir && isManagedDownloadName;
}

function toFileUrl(path: string): string {
  if (!path) return path;
  if (path.startsWith('file://')) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file://${encodeURI(`/${normalized}`)}`;
}

export async function saveOriginalVideoFile(
  originalVideoPath: string | null
): Promise<boolean> {
  if (!originalVideoPath) {
    return false;
  }
  if (!(await isSourceVideoPathAccessible(originalVideoPath))) {
    await SystemIPC.showMessage(getSourceVideoUnavailableMessage(), {
      type: 'error',
    });
    return false;
  }

  const filename = originalVideoPath.split(/[\\/]/).pop() || 'downloaded_video';

  const savedPath = await saveVideoCopy({
    sourcePath: originalVideoPath,
    title: i18n.t('dialogs.saveDownloadedVideoAs'),
    defaultPath: removeYtDlpPrefix(filename),
    extensions: VIDEO_FILE_EXTENSIONS,
    successMessage: i18n.t('messages.videoSaved', { path: '{{path}}' }),
    errorLabel: 'save original video failed',
  });
  if (!savedPath) return false;

  // Best-effort: the user's copy already exists and the success dialog has
  // shown — a history-sync failure must not abort the completed save flow
  // (same policy as the subtitle association sync below).
  try {
    await syncSavedVideoSuggestionHistoryPath({
      previousPath: originalVideoPath,
      savedPath,
    });
  } catch (err) {
    console.error('[save-video] download history sync failed:', err);
  }
  try {
    await syncStoredSubtitleVideoAssociationPath({
      previousPath: originalVideoPath,
      savedPath,
    });
  } catch (err) {
    console.error('[save-video] subtitle history sync failed:', err);
  }

  const currentVideo = useVideoStore.getState();
  if (pathsMatch(currentVideo.originalPath, originalVideoPath)) {
    const savedUrl = toFileUrl(savedPath);
    const shouldRefreshPositionSaver = currentVideo.activeTrack === 'original';
    const resumeAt = shouldRefreshPositionSaver
      ? (getNativePlayerInstance()?.currentTime ??
        currentVideo.resumeAt ??
        null)
      : (currentVideo.resumeAt ?? null);
    if (typeof window !== 'undefined' && typeof resumeAt === 'number') {
      (window as any)._videoLastValidTime = resumeAt;
    }
    useVideoStore.setState(state => {
      const nextFile =
        state.file &&
        typeof state.file === 'object' &&
        'path' in state.file &&
        pathsMatch((state.file as any).path ?? null, originalVideoPath)
          ? {
              ...(state.file as any),
              path: savedPath,
              name:
                savedPath.split(/[\\/]/).pop() ||
                (state.file as any).name ||
                'video',
            }
          : state.file;

      return {
        file: nextFile,
        originalPath: savedPath,
        originalUrl: savedUrl,
        path: state.activeTrack === 'original' ? savedPath : state.path,
        url: state.activeTrack === 'original' ? savedUrl : state.url,
        resumeAt,
      };
    });
    if (shouldRefreshPositionSaver) {
      useVideoStore.getState().stopPositionSaving();
      useVideoStore.getState().startPositionSaving();
    }
  }

  const currentSubtitles = useSubStore.getState();
  if (pathsMatch(currentSubtitles.sourceVideoPath, originalVideoPath)) {
    const preservedSourceVideoAssetIdentity =
      currentSubtitles.sourceVideoAssetIdentity ??
      (pathsMatch(currentVideo.originalPath, originalVideoPath)
        ? currentVideo.sourceAssetIdentity
        : null);
    useSubStore.setState({
      sourceVideoPath: savedPath,
      sourceVideoAssetIdentity: preservedSourceVideoAssetIdentity,
    });
  }
  return true;
}

export async function saveDubbedVideoFile(options: {
  dubbedVideoPath: string | null;
  sourceVideoPath?: string | null;
  dubVoice?: string | null;
}): Promise<boolean> {
  const { dubbedVideoPath, sourceVideoPath, dubVoice } = options;

  if (!dubbedVideoPath) {
    return false;
  }

  const sourceName = sourceVideoPath ?? dubbedVideoPath;
  const filename = sourceName.split(/[\\/]/).pop() ?? 'dubbed_video';
  const baseName = filename.replace(/\.[^/.]+$/, '');
  const extCandidate = (dubbedVideoPath.split('.').pop() || 'mp4')
    .split('?')[0]
    .toLowerCase();
  const extension = extCandidate || 'mp4';

  return Boolean(
    await saveVideoCopy({
      sourcePath: dubbedVideoPath,
      title: i18n.t('dialogs.saveDubbedVideoAs'),
      defaultPath: `${baseName}_dubbed_${sanitizeVoiceSuffix(dubVoice)}.${extension}`,
      extensions: [extension],
      successMessage: i18n.t('messages.dubbedVideoSaved', { path: '{{path}}' }),
      errorLabel: 'save dubbed video failed',
    })
  );
}
