import { isTextEntryTarget } from '../VideoPlayer/player-shortcuts.js';
import { useSubStore } from '../../state/subtitle-store.js';

// While the Undo bar still offers the Replace All.
const FIND_BAR_UNDO_MS = 10_000;

/** Cmd+Z on macOS, Ctrl+Z elsewhere; Shift (redo) and Alt are left alone. */
export function isStructuralUndoKey(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): boolean {
  if (e.defaultPrevented || e.shiftKey || e.altKey) return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  return e.key.toLowerCase() === 'z';
}

/**
 * Whether Cmd/Ctrl+Z should undo a line edit rather than typing. Text fields
 * keep their own undo, except the find bar right after Replace All (there the
 * user means the replacement). Nothing is taken while a dialog is open.
 */
export function shouldTakeStructuralUndo(
  target: Element | null,
  doc: Pick<Document, 'querySelector'> = document
): boolean {
  if (doc.querySelector('[aria-modal="true"], dialog[open]')) return false;
  if (!isTextEntryTarget(target)) return true;
  if (!target?.closest?.('[data-find-bar]')) return false;
  const last = useSubStore.getState().lastUndoable;
  return last?.kind === 'replaceAll' && Date.now() - last.at < FIND_BAR_UNDO_MS;
}
