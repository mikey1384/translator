import { useSubStore } from '../state/subtitle-store';
import { useModalStore } from '../state/modal-store';
import { flushPendingEdits, hasPendingEdits } from './pending-edits';
import { didSaveSubtitleFile, saveCurrentSubtitles } from './saveSubtitles';

/** Mounted subtitles have edits that no save has captured yet. */
export function hasUnsavedSubtitleEdits(): boolean {
  const state = useSubStore.getState();
  if (state.order.length === 0) return false;
  return state.dirty || hasPendingEdits();
}

/**
 * Before mounted subtitles are replaced (another .srt, another video): when
 * they hold unsaved edits, ask to save or discard them. Resolves true when
 * it's fine to go ahead.
 */
export async function confirmReplaceUnsavedSubtitles(): Promise<boolean> {
  flushPendingEdits();
  if (!hasUnsavedSubtitleEdits()) return true;
  const choice = await useModalStore
    .getState()
    .openUnsavedSrtConfirm('replace');
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  return didSaveSubtitleFile(await saveCurrentSubtitles());
}
