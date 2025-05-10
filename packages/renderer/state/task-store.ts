import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { STARTING_STAGE } from '../../shared/constants';

type Task = {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
  batchStartIndex?: number;
};

interface State {
  translation: Task & { reviewedBatchStartIndex: number | null };
  merge: Task;
  cancellingDownload: boolean;
}

interface Actions {
  setTranslation(patch: Partial<Task>): void;
  setMerge(patch: Partial<Task>): void;
  startMerge(): void;
  doneMerge(): void;
}

const empty: Task = { id: null, stage: '', percent: 0, inProgress: false };

const initialTranslation = {
  ...empty,
  reviewedBatchStartIndex: null as number | null,
};

export const useTaskStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    translation: { ...initialTranslation },
    merge: { ...empty },
    cancellingDownload: false,

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
    startMerge: () =>
      set(s => {
        s.merge = {
          ...s.merge,
          percent: 0,
          stage: STARTING_STAGE,
          inProgress: true,
        };
      }),
    doneMerge: () =>
      set(s => {
        s.merge = {
          ...s.merge,
          percent: 100,
          stage: 'done',
          inProgress: false,
        };
      }),
  }))
);
