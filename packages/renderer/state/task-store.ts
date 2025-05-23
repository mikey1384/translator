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
  cancellingDownload: boolean;
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
