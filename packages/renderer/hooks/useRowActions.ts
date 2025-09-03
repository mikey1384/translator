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
        return update(id, patch);
      },
      shift: (secs: number) => {
        return shift(id, secs);
      },

      remove: () => {
        return remove(id);
      },
      insertAfter: () => {
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
        return seek(id);
      },
      play: () => {
        return play(id);
      },
      pause,
      setActive: () => {
        return setActive(id);
      },
    }),
    [id, update, remove, insertAfter, shift, seek, play, pause, setActive]
  );
}
