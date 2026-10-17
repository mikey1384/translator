import { i18n } from '../i18n';
import { pickDroppedFile } from './droppedFiles';
import { useTaskStore, useUIStore, useVideoStore } from '../state';
import { useSubStore } from '../state/subtitle-store';
import * as VideoIPC from '../ipc/video';
import { durationsLookLikeSameVideo } from './sameVideo';
import { useUrlStore } from '../state/url-store';
import { useWorkspaceActions } from '../state/workspace-actions';

export type DropBlockReason = 'downloading' | 'busy' | null;

/** Why a drop must not replace the source right now, if anything. */
export function dropBlockReason(): DropBlockReason {
  if (useUrlStore.getState().download.inProgress) return 'downloading';
  const tasks = useTaskStore.getState();
  if (
    tasks.transcription.inProgress ||
    tasks.translation.inProgress ||
    tasks.dubbing.inProgress ||
    tasks.merge.inProgress
  ) {
    return 'busy';
  }
  return null;
}

export function dropBlockedMessage(reason: Exclude<DropBlockReason, null>) {
  return reason === 'downloading'
    ? i18n.t(
        'input.dropWhileDownloading',
        'A download is running. Drop the file again when it finishes.'
      )
    : i18n.t(
        'input.dropWhileBusy',
        'Translator is working on this video. Drop the file again when it finishes.'
      );
}

export function dropNotSupportedMessage() {
  return i18n.t(
    'input.dropNotSupported',
    'Drop a video, an audio file or an .srt subtitle file.'
  );
}

async function shouldKeepSubtitlesForDroppedVideo(
  nextPath: string
): Promise<boolean> {
  const video = useVideoStore.getState();
  if (!(video.path || video.file)) return false;
  if (useSubStore.getState().order.length === 0) return false;
  if (video.path && video.path === nextPath) return true;
  try {
    const next = await VideoIPC.getMetadata(nextPath);
    return durationsLookLikeSameVideo(
      video.meta?.duration,
      next.success ? next.metadata?.duration : null
    );
  } catch {
    return false;
  }
}

/**
 * Drops anywhere outside a dedicated drop zone (the workspace, the Change
 * Video dialog, home outside its box): a video replaces the current video
 * (keeping its subtitles only for another copy of the same video), an .srt
 * opens in the editor, anything else says what can be dropped. Returns false when the drop held no files.
 */
export async function handleWindowFileDrop(
  files: readonly File[]
): Promise<boolean> {
  const picked = pickDroppedFile(files);
  if (!picked) return false;
  const url = useUrlStore.getState();
  const fail = (message: string) => url.setValidationError(message);

  if (picked.kind === 'other') {
    fail(dropNotSupportedMessage());
    return true;
  }
  const blocked = dropBlockReason();
  if (blocked) {
    fail(dropBlockedMessage(blocked));
    return true;
  }
  const path = window.fileApi.getPathForFile(picked.file);
  if (!path) {
    fail(dropNotSupportedMessage());
    return true;
  }

  if (picked.kind === 'subtitle') {
    const editor = useWorkspaceActions.getState().editor;
    if (!editor) {
      fail(dropNotSupportedMessage());
      return true;
    }
    url.clearError();
    const ui = useUIStore.getState();
    ui.setSubtitleEditMode(true);
    ui.setEditPanelOpen(true);
    editor.loadSrt(path);
    return true;
  }

  url.clearError();
  const video = useVideoStore.getState();
  // Subtitles only follow another copy of the same video. A different video
  // goes through the normal replace path: unsaved edits are asked about and
  // the old video's subtitles are released.
  const preserveSubtitles = await shouldKeepSubtitlesForDroppedVideo(path);
  const opened = await video.openRecentLocalMedia(path, {
    preserveSubtitles,
  });
  if (!opened.opened) {
    fail(i18n.t('home.dropOpenFailed', 'That file could not be opened.'));
  }
  return true;
}
