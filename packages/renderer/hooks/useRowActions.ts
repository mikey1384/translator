import { useMemo } from 'react';
import { useSubActions } from '../state/subtitle-store';
import type { SrtSegment } from '@shared-types/app';
import { scrollPrecisely, flashSubtitle } from '../utils/scroll';

export function useRowActions(id: string) {
  const { update, remove, insertAfter, shift, seek, play, pause, setActive } =
    useSubActions();

  return useMemo(
    () => ({
      update: (patch: Partial<SrtSegment>) => {
        console.log('UPDATE called for id:', id);
        return update(id, patch);
      },
      shift: (secs: number) => {
        console.log('SHIFT called for id:', id, 'with seconds:', secs);
        return shift(id, secs);
      },

      remove: () => {
        console.log('REMOVE called for id:', id);
        return remove(id);
      },
      insertAfter: () => {
        console.log('INSERT AFTER called for id:', id);
        const newId = insertAfter(id);
        if (newId) {
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLElement>(
              `[data-cue-id="${newId}"]`
            );
            if (el) {
              scrollPrecisely(el, false);
              requestAnimationFrame(() => flashSubtitle(el));
            }
          });
        }
        return newId;
      },

      seek: () => {
        console.log('SEEK called for id:', id);
        return seek(id);
      },
      play: () => {
        console.log('PLAY called for id:', id);
        return play(id);
      },
      pause,
      setActive: () => {
        console.log('SET ACTIVE called for id:', id);
        return setActive(id);
      },
    }),
    [id, update, remove, insertAfter, shift, seek, play, pause, setActive]
  );
}
