import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../../components/Button.js';
import { useSubStore, type UndoableEditKind } from '../../state/subtitle-store';
import { subtitleUndoBarStyles } from './edit-workspace-styles';

const VISIBLE_MS = 10_000;

export function undoShortcutLabel(): string {
  return /mac/i.test(navigator.platform || navigator.userAgent)
    ? '⌘Z'
    : 'Ctrl+Z';
}

/** "Line deleted · Undo" after a structural edit, for a few seconds. */
export default function SubtitleUndoBar() {
  const { t } = useTranslation();
  const lastUndoable = useSubStore(s => s.lastUndoable);
  const undoDepth = useSubStore(s => s.undoDepth);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastUndoable) return;
    setNow(Date.now());
    const remaining = lastUndoable.at + VISIBLE_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 20);
    return () => clearTimeout(timer);
  }, [lastUndoable]);

  if (!lastUndoable || undoDepth === 0) return null;
  if (now - lastUndoable.at > VISIBLE_MS) return null;

  const messages: Record<UndoableEditKind, string> = {
    remove: t('editSubtitles.undo.removed', 'Line deleted.'),
    insert: t('editSubtitles.undo.inserted', 'Line added.'),
    replaceAll: t('editSubtitles.undo.replaced', 'Replaced in all lines.'),
    shift: t('editSubtitles.undo.shifted', 'Timing shifted.'),
    shiftAll: t('editSubtitles.undo.shifted', 'Timing shifted.'),
    improve: t('editSubtitles.undo.improved', 'Line transcribed again.'),
    split: t('editSubtitles.undo.split', 'Line split in two.'),
    merge: t('editSubtitles.undo.merged', 'Lines merged.'),
  };

  return (
    <div className={subtitleUndoBarStyles} role="status" dir="auto">
      <span>{messages[lastUndoable.kind]}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => useSubStore.getState().undo()}
        title={t('editSubtitles.undo.shortcut', 'Undo ({{keys}})', {
          keys: undoShortcutLabel(),
        })}
      >
        {t('editSubtitles.undo.action', 'Undo')}
      </Button>
    </div>
  );
}
