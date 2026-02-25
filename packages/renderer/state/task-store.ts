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
  /** AI model being used (e.g., "Claude Opus", "GPT-5.1") */
  model?: string;
}

interface State {
  translation: TranslationTask & { reviewedBatchStartIndex: number | null };
  transcription: TranslationTask;
  merge: TranslationTask;
  summary: TranslationTask;
  dubbing: TranslationTask;
}

interface Actions {
  setTranslation(patch: Partial<TranslationTask>): void;
  setTranscription(patch: Partial<TranslationTask>): void;
  setMerge(patch: Partial<TranslationTask>): void;
  setSummary(patch: Partial<TranslationTask>): void;
  setDubbing(patch: Partial<TranslationTask>): void;
  startMerge(): void;
  doneMerge(): void;
  /**
   * Atomically check if dubbing can start (no transcription running)
   * and set dubbing to inProgress. Returns true if started, false if blocked.
   */
  tryStartDubbing(id: string, stage: string): boolean;
  /**
   * Atomically check if translation can start (no transcription running)
   * and set translation to inProgress. Returns true if started, false if blocked.
   */
  tryStartTranslation(id: string, stage: string): boolean;
  /**
   * Atomically check if summary can start and set to inProgress.
   * Returns true if started, false if blocked.
   */
  tryStartSummary(id: string, stage: string): boolean;
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
    summary: { ...empty },
    dubbing: { ...empty },

    setTranslation: p =>
      set(s => {
        const t = s.translation;
        const same =
          (p.stage === undefined || p.stage === t.stage) &&
          (p.percent === undefined ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (p.id === undefined || p.id === t.id) &&
          (p.inProgress === undefined || p.inProgress === t.inProgress) &&
          (p.model === undefined || p.model === t.model) &&
          (p.batchStartIndex === undefined ||
            p.batchStartIndex === t.reviewedBatchStartIndex);
        if (same) return;
        Object.assign(s.translation, p);
        const stageNow = (p.stage ?? s.translation.stage ?? '').toLowerCase();
        const pctNow = p.percent ?? s.translation.percent ?? 0;
        const isCancelled = /cancel/.test(stageNow);

        // Respect explicit inProgress override first
        if (p.inProgress !== undefined) {
          s.translation.inProgress = p.inProgress;
        } else if (isCancelled) {
          // Explicitly stop showing the panel on cancellation
          s.translation.inProgress = false;
        } else if (p.percent !== undefined) {
          // Derive inProgress from percent/stage when not explicitly provided
          const isComplete =
            pctNow >= 100 &&
            (stageNow.includes('complete') ||
              stageNow.includes('done') ||
              stageNow.includes('error') ||
              stageNow.includes('processing complete'));
          s.translation.inProgress = pctNow < 100 || !isComplete;
          if (!s.translation.inProgress)
            s.translation.reviewedBatchStartIndex = null;
        }
        if (p.percent !== undefined || p.stage !== undefined) {
          s.translation.isCompleted =
            !isCancelled &&
            (pctNow >= 100 ||
              /processing complete|complete|done/i.test(stageNow ?? ''));
        }
        if (p.batchStartIndex !== undefined) {
          s.translation.reviewedBatchStartIndex = p.batchStartIndex;
        }
        if (p.inProgress === false) {
          // Mark not in progress, but preserve final percent/stage and completion flag
          s.translation.inProgress = false;
          s.translation.reviewedBatchStartIndex = null;
          s.translation.id = null;
        }
      }),
    setDubbing: p =>
      set(s => {
        const task = s.dubbing;
        const same =
          (p.stage === undefined || p.stage === task.stage) &&
          (p.percent === undefined ||
            Math.round(p.percent) === Math.round(task.percent)) &&
          (p.id === undefined || p.id === task.id) &&
          (p.inProgress === undefined || p.inProgress === task.inProgress) &&
          (p.model === undefined || p.model === task.model);
        if (same) return;
        Object.assign(s.dubbing, p);
        const stageNow = (p.stage ?? s.dubbing.stage ?? '').toLowerCase();
        const pctNow = p.percent ?? s.dubbing.percent ?? 0;
        const isCancelled = /cancel/.test(stageNow);

        if (p.inProgress !== undefined) {
          s.dubbing.inProgress = p.inProgress;
        } else if (isCancelled) {
          s.dubbing.inProgress = false;
        } else if (p.percent !== undefined) {
          const isComplete =
            pctNow >= 100 &&
            (stageNow.includes('complete') ||
              stageNow.includes('done') ||
              stageNow.includes('error'));
          s.dubbing.inProgress = pctNow < 100 || !isComplete;
        }
        if (p.percent !== undefined || p.stage !== undefined) {
          s.dubbing.isCompleted =
            !isCancelled &&
            (pctNow >= 100 ||
              /processing complete|complete|done/i.test(stageNow ?? ''));
        }
        if (p.inProgress === false) {
          s.dubbing.inProgress = false;
          s.dubbing.id = null;
        }
      }),
    setTranscription: p =>
      set(s => {
        const t = s.transcription;
        const same =
          (p.stage === undefined || p.stage === t.stage) &&
          (p.percent === undefined ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (p.id === undefined || p.id === t.id) &&
          (p.inProgress === undefined || p.inProgress === t.inProgress);
        if (same) return;
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
            !isCancelled &&
            (pctNow >= 100 ||
              /processing complete|complete|done/i.test(stageNow));
        }
        if (p.inProgress === false) {
          // Mark not in progress, but preserve final percent/stage and completion flag
          s.transcription.inProgress = false;
          s.transcription.id = null;
        }
      }),
    setSummary: p =>
      set(s => {
        const t = s.summary;
        const same =
          (p.stage === undefined || p.stage === t.stage) &&
          (p.percent === undefined ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (p.id === undefined || p.id === t.id) &&
          (p.inProgress === undefined || p.inProgress === t.inProgress);
        if (same) return;
        Object.assign(s.summary, p);
        const stageNow = (p.stage ?? s.summary.stage ?? '').toLowerCase();
        const pctNow = p.percent ?? s.summary.percent ?? 0;
        const isCancelled = /cancel/.test(stageNow);
        if (p.inProgress !== undefined) {
          s.summary.inProgress = p.inProgress;
        } else if (isCancelled) {
          s.summary.inProgress = false;
        } else if (p.percent !== undefined) {
          s.summary.inProgress = pctNow < 100;
        }
        if (p.percent !== undefined || p.stage !== undefined) {
          s.summary.isCompleted =
            !isCancelled && (pctNow >= 100 || /complete|done/.test(stageNow));
        }
        if (p.inProgress === false) {
          s.summary.inProgress = false;
          s.summary.id = null;
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
          inProgress: false,
        };
      }),
    tryStartDubbing: (id: string, stage: string) => {
      let started = false;
      set(s => {
        // Block if transcription is running or dubbing already in progress
        if (s.transcription.inProgress || s.dubbing.inProgress) {
          return;
        }
        s.dubbing = {
          id,
          stage,
          percent: 0,
          inProgress: true,
          isCompleted: false,
        };
        started = true;
      });
      return started;
    },
    tryStartTranslation: (id: string, stage: string) => {
      let started = false;
      set(s => {
        // Block if transcription is running or translation already in progress
        if (s.transcription.inProgress || s.translation.inProgress) {
          return;
        }
        s.translation = {
          id,
          stage,
          percent: 0,
          inProgress: true,
          isCompleted: false,
          reviewedBatchStartIndex: null,
        };
        started = true;
      });
      return started;
    },
    tryStartSummary: (id: string, stage: string) => {
      let started = false;
      set(s => {
        // Block if summary already in progress
        if (s.summary.inProgress) {
          return;
        }
        s.summary = {
          id,
          stage,
          percent: 0,
          inProgress: true,
          isCompleted: false,
        };
        started = true;
      });
      return started;
    },
  }))
);
