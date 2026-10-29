import { create } from 'zustand';
import type { WebVideoCandidate } from '@shared-types/app';

type Picker = {
  operationId: string;
  candidates: WebVideoCandidate[];
  resolve: (id: string | null) => void;
};
export const useWebVideoStore = create<{
  picker: Picker | null;
  choose: (id: string | null) => void;
}>(set => ({
  picker: null,
  choose: id =>
    set(state => {
      state.picker?.resolve(id);
      return { picker: null };
    }),
}));

export function chooseWebVideo(
  operationId: string,
  candidates: WebVideoCandidate[]
): Promise<string | null> {
  useWebVideoStore.getState().choose(null);
  return new Promise(resolve =>
    useWebVideoStore.setState({ picker: { operationId, candidates, resolve } })
  );
}
