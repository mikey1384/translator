import { useMemo } from 'react';
import { useSubActions } from '../state/subtitle-store';
import { SrtSegment } from '@shared-types/app';

/**
 * Provides memoized, row-scoped actions for a specific subtitle ID.
 * @param id The ID of the subtitle row.
 * @returns A stable object containing actions bound to the specified ID.
 */
export function useRowActions(id: string) {
  const global = useSubActions();

  return useMemo(
    () => ({
      update: (p: Partial<SrtSegment>) => global.update(id, p),
      remove: () => global.remove(id),
      insertAfter: () => global.insertAfter(id),
      shift: (secs: number) => global.shift(id, secs),
      seek: () => global.seek(id),
      play: () => global.play(id),
      pause: global.pause,
      setActive: () => global.setActive(id),
    }),
    [global, id]
  );
}
