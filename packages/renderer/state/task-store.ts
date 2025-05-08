import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';

type Task = {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
  batchStartIndex?: number /** transient: only arrives from IPC */;
};

interface State {
  download: Task;
  translation: Task & { reviewedBatchStartIndex: number | null };
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

const initialTranslation = {
  ...empty,
  reviewedBatchStartIndex: null,
};

export const useTaskStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    download: { ...empty },
    translation: { ...initialTranslation },
    merge: { ...empty },
    cancellingDownload: false,

    setDownload: p =>
      set(s => {
        Object.assign(s.download, p);
      }),
    setTranslation: p =>
      set(s => {
        Object.assign(s.translation, p);
        if (p.percent !== undefined) {
          s.translation.inProgress = p.percent < 100;
          if (!s.translation.inProgress)
            s.translation.reviewedBatchStartIndex = null;
        }
        if (p.batchStartIndex !== undefined) {
          s.translation.reviewedBatchStartIndex = p.batchStartIndex;
        }
      }),
    setMerge: p =>
      set(s => {
        Object.assign(s.merge, p);
        if (p.percent !== undefined) s.merge.inProgress = p.percent < 100;
      }),
    setCancellingDownload: b => set({ cancellingDownload: b }),
  }))
);

export const useDownloadTask = () => useTaskStore(s => s.download);
export const useTranslationTask = () => useTaskStore(s => s.translation);
export const useMergeTask = () => useTaskStore(s => s.merge);
export const useCancellingDownload = () =>
  useTaskStore(s => s.cancellingDownload);
