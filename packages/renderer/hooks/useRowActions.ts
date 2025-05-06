import { useMemo } from 'react';
import { useSubActions } from '../state/subtitle-store';
import type { SrtSegment } from '@shared-types/app';

/**
 * Provides memoized, row-scoped actions for a specific subtitle ID.
 * @param id The ID of the subtitle row.
 * @returns A stable object containing actions bound to the specified ID.
 */
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

      /** structural ops */
      remove: () => {
        console.log('REMOVE called for id:', id);
        return remove(id);
      },
      insertAfter: () => {
        console.log('INSERT AFTER called for id:', id);
        return insertAfter(id);
      },

      /** player helpers */
      seek: () => {
        console.log('SEEK called for id:', id);
        return seek(id);
      },
      play: () => {
        console.log('PLAY called for id:', id);
        return play(id);
      },
      pause, // no id needed
      setActive: () => {
        console.log('SET ACTIVE called for id:', id);
        return setActive(id);
      },
    }),
    [id, update, remove, insertAfter, shift, seek, play, pause, setActive]
  );
}
