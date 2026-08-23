import { createWithEqualityFn } from 'zustand/traditional';
import { immer } from 'zustand/middleware/immer';
import { i18n } from '../i18n';
import { resolveTaskLifecycle } from './task-state-transition';

export interface TranslationTask {
  id: string | null;
  stage: string;
  percent: number;
  inProgress: boolean;
  workflowOwner?: 'default' | 'highlight';
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
  task.workflowOwner = undefined;
  task.startedAt = null;
  task.phaseStartedAt = null;
  task.lastUpdatedAt = null;
}

function clearRuntimePreservingWorkflowOwner(task: TranslationTask) {
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
            p.percent == null ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (!has('id') || p.id === t.id) &&
          (!has('inProgress') || p.inProgress === t.inProgress) &&
          (!has('isCompleted') || p.isCompleted === t.isCompleted) &&
          (!has('workflowOwner') || p.workflowOwner === t.workflowOwner) &&
          (!has('model') || p.model === t.model) &&
          (!has('phaseKey') || p.phaseKey === t.phaseKey) &&
          (!has('current') || p.current === t.current) &&
          (!has('total') || p.total === t.total) &&
          (!has('unit') || p.unit === t.unit) &&
          (!has('etaSeconds') || p.etaSeconds === t.etaSeconds) &&
          (!has('batchStartIndex') ||
            p.batchStartIndex === t.reviewedBatchStartIndex);
        if (same) return;
        const lifecycle = resolveTaskLifecycle(t, p);
        applyRuntimePatch(s.translation, p);
        s.translation.inProgress = lifecycle.inProgress;
        s.translation.isCompleted = lifecycle.isCompleted;
        if (has('isCompleted')) {
          s.translation.reviewedBatchStartIndex = null;
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
            p.percent == null ||
            Math.round(p.percent) === Math.round(task.percent)) &&
          (!has('id') || p.id === task.id) &&
          (!has('inProgress') || p.inProgress === task.inProgress) &&
          (!has('isCompleted') || p.isCompleted === task.isCompleted) &&
          (!has('workflowOwner') || p.workflowOwner === task.workflowOwner) &&
          (!has('model') || p.model === task.model) &&
          (!has('phaseKey') || p.phaseKey === task.phaseKey) &&
          (!has('current') || p.current === task.current) &&
          (!has('total') || p.total === task.total) &&
          (!has('unit') || p.unit === task.unit) &&
          (!has('etaSeconds') || p.etaSeconds === task.etaSeconds);
        if (same) return;
        const lifecycle = resolveTaskLifecycle(task, p);
        applyRuntimePatch(s.dubbing, p);
        s.dubbing.inProgress = lifecycle.inProgress;
        s.dubbing.isCompleted = lifecycle.isCompleted;
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
            p.percent == null ||
            Math.round(p.percent) === Math.round(t.percent)) &&
          (!has('id') || p.id === t.id) &&
          (!has('inProgress') || p.inProgress === t.inProgress) &&
          (!has('isCompleted') || p.isCompleted === t.isCompleted) &&
          (!has('workflowOwner') || p.workflowOwner === t.workflowOwner) &&
          (!has('model') || p.model === t.model) &&
          (!has('phaseKey') || p.phaseKey === t.phaseKey) &&
          (!has('current') || p.current === t.current) &&
          (!has('total') || p.total === t.total) &&
          (!has('unit') || p.unit === t.unit) &&
          (!has('etaSeconds') || p.etaSeconds === t.etaSeconds);
        if (same) return;
        const lifecycle = resolveTaskLifecycle(t, p);
        applyRuntimePatch(s.transcription, p);
        s.transcription.inProgress = lifecycle.inProgress;
        s.transcription.isCompleted = lifecycle.isCompleted;
        if (p.inProgress === false) {
          // Preserve the finished operation identity until an explicit reset or
          // replacement operation arrives so buffered completion packets still
          // know which workflow owns them.
          s.transcription.inProgress = false;
          const isExplicitReset =
            has('id') &&
            p.id === null &&
            (p.stage === '' || p.stage === undefined) &&
            (p.percent === 0 || p.percent === undefined);
          if (isExplicitReset) {
            s.transcription.id = null;
            clearRuntime(s.transcription);
          } else {
            clearRuntimePreservingWorkflowOwner(s.transcription);
          }
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
          (p.inProgress === undefined || p.inProgress === t.inProgress) &&
          (p.isCompleted === undefined || p.isCompleted === t.isCompleted);
        if (same) return;
        const lifecycle = resolveTaskLifecycle(t, p);
        Object.assign(s.summary, p);
        s.summary.inProgress = lifecycle.inProgress;
        s.summary.isCompleted = lifecycle.isCompleted;
        if (p.inProgress === false) {
          s.summary.inProgress = false;
          s.summary.id = null;
        }
      }),
    setMerge: p =>
      set(s => {
        const task = s.merge;
        const has = (key: keyof TranslationTask) =>
          Object.prototype.hasOwnProperty.call(p, key);
        const same =
          (!has('stage') || p.stage === task.stage) &&
          (!has('percent') ||
            p.percent == null ||
            Math.round(p.percent) === Math.round(task.percent)) &&
          (!has('id') || p.id === task.id) &&
          (!has('inProgress') || p.inProgress === task.inProgress) &&
          (!has('isCompleted') || p.isCompleted === task.isCompleted) &&
          (!has('workflowOwner') || p.workflowOwner === task.workflowOwner) &&
          (!has('model') || p.model === task.model) &&
          (!has('phaseKey') || p.phaseKey === task.phaseKey) &&
          (!has('current') || p.current === task.current) &&
          (!has('total') || p.total === task.total) &&
          (!has('unit') || p.unit === task.unit) &&
          (!has('etaSeconds') || p.etaSeconds === task.etaSeconds);
        if (same) return;
        const lifecycle = resolveTaskLifecycle(task, p);
        applyRuntimePatch(task, p);
        task.inProgress = lifecycle.inProgress;
        task.isCompleted = lifecycle.isCompleted;

        if (p.inProgress === false) {
          task.inProgress = false;
          task.id = null;
          clearRuntime(task);
        }
      }),
    startMerge: () =>
      set(s => {
        s.merge = {
          ...s.merge,
          percent: 0,
          stage: i18n.t('generateSubtitles.status.starting'),
          inProgress: true,
          isCompleted: false,
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
