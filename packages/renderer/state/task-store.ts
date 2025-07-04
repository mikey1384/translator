import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { i18n } from '../i18n';

export interface TranslationTask {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
  batchStartIndex?: number;
}

interface State {
  translation: TranslationTask & { reviewedBatchStartIndex: number | null };
  merge: TranslationTask;
}

interface Actions {
  setTranslation(patch: Partial<TranslationTask>): void;
  setMerge(patch: Partial<TranslationTask>): void;
  startMerge(): void;
  doneMerge(): void;
}

const empty: TranslationTask = {
  id: null,
  stage: '',
  percent: 0,
  inProgress: false,
};

const initialTranslation = {
  ...empty,
  reviewedBatchStartIndex: null as number | null,
};

export const useTaskStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    translation: { ...initialTranslation },
    merge: { ...empty },

    setTranslation: p =>
      set(s => {
        Object.assign(s.translation, p);
        if (p.percent !== undefined) {
          // Only set inProgress to false when explicitly told it's complete
          // (e.g., stage contains "complete" or "done") or when there's an error
          const isComplete = p.percent >= 100 && 
            (p.stage?.toLowerCase().includes('complete') || 
             p.stage?.toLowerCase().includes('done') ||
             p.stage?.toLowerCase().includes('error') ||
             p.stage?.toLowerCase().includes('processing complete'));
          s.translation.inProgress = p.percent < 100 || !isComplete;
          if (!s.translation.inProgress)
            s.translation.reviewedBatchStartIndex = null;
        }
        if (p.batchStartIndex !== undefined) {
          s.translation.reviewedBatchStartIndex = p.batchStartIndex;
        }
        if (p.inProgress === false) {
          s.translation.reviewedBatchStartIndex = null;
          s.translation.id = null;
          s.translation.stage = '';
          s.translation.percent = 0;
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
          stage: i18n.t('generateSubtitles.status.starting'),
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
