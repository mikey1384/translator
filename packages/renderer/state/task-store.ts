import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { i18n } from '../i18n';

export interface TranslationTask {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
  batchStartIndex?: number;
  isCompleted?: boolean;
}

interface State {
  translation: TranslationTask & { reviewedBatchStartIndex: number | null };
  transcription: TranslationTask;
  merge: TranslationTask;
}

interface Actions {
  setTranslation(patch: Partial<TranslationTask>): void;
  setTranscription(patch: Partial<TranslationTask>): void;
  setMerge(patch: Partial<TranslationTask>): void;
  startMerge(): void;
  doneMerge(): void;
}

const empty: TranslationTask = {
  id: null,
  stage: '',
  percent: 0,
  inProgress: false,
  isCompleted: false,
};

const initialTranslation = {
  ...empty,
  reviewedBatchStartIndex: null as number | null,
};

export const useTaskStore = createWithEqualityFn<State & Actions>()(
  immer(set => ({
    translation: { ...initialTranslation },
    transcription: { ...empty },
    merge: { ...empty },

    setTranslation: p =>
      set(s => {
        Object.assign(s.translation, p);
        // Respect explicit inProgress override first
        if (p.inProgress !== undefined) {
          s.translation.inProgress = p.inProgress;
        } else if (p.percent !== undefined) {
          // Derive inProgress from percent/stage when not explicitly provided
          const isComplete =
            p.percent >= 100 &&
            (p.stage?.toLowerCase().includes('complete') ||
              p.stage?.toLowerCase().includes('done') ||
              p.stage?.toLowerCase().includes('error') ||
              p.stage?.toLowerCase().includes('processing complete'));
          s.translation.inProgress = p.percent < 100 || !isComplete;
          if (!s.translation.inProgress)
            s.translation.reviewedBatchStartIndex = null;
        }
        if (p.percent !== undefined || p.stage !== undefined) {
          const st = p.stage ?? s.translation.stage;
          const pct = p.percent ?? s.translation.percent;
          s.translation.isCompleted =
            pct >= 100 || /processing complete|complete|done/i.test(st ?? '');
        }
        if (p.batchStartIndex !== undefined) {
          s.translation.reviewedBatchStartIndex = p.batchStartIndex;
        }
        if (p.inProgress === false) {
          s.translation.reviewedBatchStartIndex = null;
          s.translation.id = null;
          s.translation.stage = '';
          s.translation.percent = 0;
          s.translation.inProgress = false;
          s.translation.isCompleted = false;
        }
      }),
    setTranscription: p =>
      set(s => {
        Object.assign(s.transcription, p);
        const stageNow = (p.stage ?? s.transcription.stage ?? '').toLowerCase();
        const pctNow = p.percent ?? s.transcription.percent ?? 0;
        const isCancelled = /cancel/.test(stageNow);
        if (p.inProgress !== undefined) {
          s.transcription.inProgress = p.inProgress;
        } else if (isCancelled) {
          // Explicitly stop showing the panel on cancellation
          s.transcription.inProgress = false;
        } else if (p.percent !== undefined) {
          s.transcription.inProgress = pctNow < 100;
        }
        if (p.percent !== undefined || p.stage !== undefined) {
          s.transcription.isCompleted =
            !isCancelled && (pctNow >= 100 || /processing complete|complete|done/i.test(stageNow));
        }
        if (p.inProgress === false) {
          s.transcription.id = null;
          s.transcription.stage = '';
          s.transcription.percent = 0;
          s.transcription.inProgress = false;
          s.transcription.isCompleted = false;
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
