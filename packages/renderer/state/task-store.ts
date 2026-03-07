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
  /** Machine-readable phase key for ETA / progress logic. */
  phaseKey?: string;
  /** Optional current/total counters for active progress units. */
  current?: number;
  total?: number;
  /** Unit for current/total counters (e.g. "chunks", "segments"). */
  unit?: string;
  /** Remaining-time hint from the backend when available. */
  etaSeconds?: number;
  /** Renderer timestamps used for smart ETA smoothing. */
  startedAt?: number | null;
  phaseStartedAt?: number | null;
  lastUpdatedAt?: number | null;
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
  startedAt: null,
  phaseStartedAt: null,
  lastUpdatedAt: null,
};

const initialTranslation = {
  ...empty,
  reviewedBatchStartIndex: null as number | null,
};

function clearRuntime(task: TranslationTask) {
  task.current = undefined;
  task.total = undefined;
  task.unit = undefined;
  task.etaSeconds = undefined;
  task.phaseKey = undefined;
  task.model = undefined;
  task.startedAt = null;
  task.phaseStartedAt = null;
  task.lastUpdatedAt = null;
}

function applyRuntimePatch(
  task: TranslationTask,
  patch: Partial<TranslationTask>
) {
  const now = Date.now();
  const priorPhaseKey = task.phaseKey;
  const idChanged =
    patch.id !== undefined && patch.id !== null && patch.id !== task.id;
  const starting =
    idChanged || (patch.inProgress === true && task.inProgress !== true);

  if (starting) {
    clearRuntime(task);
    task.startedAt = now;
    task.lastUpdatedAt = now;
  }

  Object.assign(task, patch);

  if (task.inProgress && task.startedAt == null) {
    task.startedAt = now;
  }

  const phaseChanged =
    Object.prototype.hasOwnProperty.call(patch, 'phaseKey') &&
    patch.phaseKey !== priorPhaseKey;
  if (phaseChanged || (starting && task.phaseKey)) {
    task.phaseStartedAt = now;
  }

  const touchedRuntime =
    Object.prototype.hasOwnProperty.call(patch, 'stage') ||
    Object.prototype.hasOwnProperty.call(patch, 'percent') ||
    Object.prototype.hasOwnProperty.call(patch, 'current') ||
    Object.prototype.hasOwnProperty.call(patch, 'total') ||
    Object.prototype.hasOwnProperty.call(patch, 'unit') ||
    Object.prototype.hasOwnProperty.call(patch, 'etaSeconds') ||
    Object.prototype.hasOwnProperty.call(patch, 'phaseKey') ||
    Object.prototype.hasOwnProperty.call(patch, 'model') ||
    Object.prototype.hasOwnProperty.call(patch, 'batchStartIndex');
  if (task.inProgress && touchedRuntime) {
    task.lastUpdatedAt = now;
  }
}

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
        const has = (key: keyof TranslationTask | 'batchStartIndex') =>
          Object.prototype.hasOwnProperty.call(p, key);
        const same =
          (!has('stage') || p.stage === t.stage) &&
          (!has('percent') ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (!has('id') || p.id === t.id) &&
          (!has('inProgress') || p.inProgress === t.inProgress) &&
          (!has('model') || p.model === t.model) &&
          (!has('phaseKey') || p.phaseKey === t.phaseKey) &&
          (!has('current') || p.current === t.current) &&
          (!has('total') || p.total === t.total) &&
          (!has('unit') || p.unit === t.unit) &&
          (!has('etaSeconds') || p.etaSeconds === t.etaSeconds) &&
          (!has('batchStartIndex') ||
            p.batchStartIndex === t.reviewedBatchStartIndex);
        if (same) return;
        applyRuntimePatch(s.translation, p);
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
          clearRuntime(s.translation);
        }
      }),
    setDubbing: p =>
      set(s => {
        const task = s.dubbing;
        const has = (key: keyof TranslationTask) =>
          Object.prototype.hasOwnProperty.call(p, key);
        const same =
          (!has('stage') || p.stage === task.stage) &&
          (!has('percent') ||
            Math.round(p.percent) === Math.round(task.percent)) &&
          (!has('id') || p.id === task.id) &&
          (!has('inProgress') || p.inProgress === task.inProgress) &&
          (!has('model') || p.model === task.model) &&
          (!has('phaseKey') || p.phaseKey === task.phaseKey) &&
          (!has('current') || p.current === task.current) &&
          (!has('total') || p.total === task.total) &&
          (!has('unit') || p.unit === task.unit) &&
          (!has('etaSeconds') || p.etaSeconds === task.etaSeconds);
        if (same) return;
        applyRuntimePatch(s.dubbing, p);
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
          clearRuntime(s.dubbing);
        }
      }),
    setTranscription: p =>
      set(s => {
        const t = s.transcription;
        const has = (key: keyof TranslationTask) =>
          Object.prototype.hasOwnProperty.call(p, key);
        const same =
          (!has('stage') || p.stage === t.stage) &&
          (!has('percent') ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (!has('id') || p.id === t.id) &&
          (!has('inProgress') || p.inProgress === t.inProgress) &&
          (!has('model') || p.model === t.model) &&
          (!has('phaseKey') || p.phaseKey === t.phaseKey) &&
          (!has('current') || p.current === t.current) &&
          (!has('total') || p.total === t.total) &&
          (!has('unit') || p.unit === t.unit) &&
          (!has('etaSeconds') || p.etaSeconds === t.etaSeconds);
        if (same) return;
        applyRuntimePatch(s.transcription, p);
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
          clearRuntime(s.transcription);
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
          startedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          phaseStartedAt: null,
          phaseKey: undefined,
          current: undefined,
          total: undefined,
          unit: undefined,
          etaSeconds: undefined,
          model: undefined,
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
          startedAt: Date.now(),
          lastUpdatedAt: Date.now(),
          phaseStartedAt: null,
          phaseKey: undefined,
          current: undefined,
          total: undefined,
          unit: undefined,
          etaSeconds: undefined,
          model: undefined,
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
