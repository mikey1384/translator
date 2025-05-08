import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

type Task = {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
};

interface State {
  download: Task;
  translation: Task;
  merge: Task;
  cancellingDownload: boolean;
}
interface Actions {
  setDownload(patch: Partial<Task>): void;
  setTranslation(patch: Partial<Task>): void;
  setMerge(patch: Partial<Task>): void;
  setCancellingDownload(b: boolean): void;
}

const empty: Task = { id: null, stage: '', percent: 0, inProgress: false };

export const useTaskStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    download: { ...empty },
    translation: { ...empty },
    merge: { ...empty },
    cancellingDownload: false,

    setDownload: p =>
      set(s => {
        Object.assign(s.download, p);
      }),
    setTranslation: p =>
      set(s => {
        Object.assign(s.translation, p);
      }),
    setMerge: p =>
      set(s => {
        Object.assign(s.merge, p);
      }),
    setCancellingDownload: b => set({ cancellingDownload: b }),
  }))
);
