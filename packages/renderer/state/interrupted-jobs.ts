import { createWithEqualityFn } from 'zustand/traditional';
import { useTaskStore } from './task-store';
import { useUIStore } from './ui-store';
import { useVideoStore } from './video-store';
import { useStepTwoWorkflowStore } from './step-two-workflow-store';
import { freePreviewKey } from './free-preview-store';
import {
  STALE_AFTER_MS,
  staleRecords,
  type InterruptedJobKind,
  type RunningJobRecord,
} from './interrupted-job-records';

export type { InterruptedJobKind, RunningJobRecord };

/**
 * Paid subtitle jobs that were still running when Translator quit or
 * crashed. Each running transcription/translation leaves a small record per
 * source; a clean finish, failure or cancel removes it. A record whose tab
 * stopped refreshing it is a job the user never saw finish, so the workspace
 * can say so and offer to resume (which reuses the durable transcription).
 */

const STORAGE_KEY = 'runningSubtitleJobs.v1';
const HEARTBEAT_MS = 10_000;

const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function readRecords(): RunningJobRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (r: any): r is RunningJobRecord =>
            r &&
            typeof r.key === 'string' &&
            (r.kind === 'transcribe' || r.kind === 'translate') &&
            typeof r.language === 'string' &&
            typeof r.aliveAt === 'number' &&
            typeof r.owner === 'string'
        )
      : [];
  } catch {
    return [];
  }
}

function writeRecords(records: RunningJobRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage is a convenience; nothing else depends on it.
  }
}

interface InterruptedJobsState {
  items: Record<string, RunningJobRecord>;
  refresh(): void;
  dismiss(key: string): void;
}

export const useInterruptedJobsStore =
  createWithEqualityFn<InterruptedJobsState>()(set => ({
    items: {},
    refresh() {
      const found = staleRecords(readRecords(), Date.now(), owner);
      set({ items: Object.fromEntries(found.map(r => [r.key, r])) });
    },
    dismiss(key) {
      writeRecords(
        readRecords().filter(r => r.key !== key || r.owner === owner)
      );
      set(state => {
        if (!state.items[key]) return state;
        const items = { ...state.items };
        delete items[key];
        return { items };
      });
    },
  }));

function currentSourceKey(): string | null {
  const video = useVideoStore.getState();
  return freePreviewKey({
    originalPath: video.originalPath,
    path: video.path,
    sourceUrl: video.sourceUrl,
  });
}

let heartbeat: ReturnType<typeof setInterval> | null = null;

function syncHeartbeat(): void {
  const mine = readRecords().some(r => r.owner === owner);
  if (mine && !heartbeat) {
    heartbeat = setInterval(() => {
      const now = Date.now();
      writeRecords(
        readRecords().map(r => (r.owner === owner ? { ...r, aliveAt: now } : r))
      );
    }, HEARTBEAT_MS);
  } else if (!mine && heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function jobStarted(kind: InterruptedJobKind): void {
  const key = currentSourceKey();
  if (!key) return;
  const now = Date.now();
  const workflow = useStepTwoWorkflowStore.getState();
  const language =
    (workflow.kind === 'translate' && workflow.language) ||
    useUIStore.getState().targetLanguage;
  // A new run for this source replaces any leftover record and notice.
  const records = readRecords().filter(r => r.key !== key);
  records.push({ key, kind, language, startedAt: now, aliveAt: now, owner });
  writeRecords(records);
  useInterruptedJobsStore.getState().dismiss(key);
  syncHeartbeat();
}

function jobEnded(): void {
  const tasks = useTaskStore.getState();
  if (tasks.transcription.inProgress || tasks.translation.inProgress) return;
  // A transcription that hands off to translation ends and the translation
  // starts in a later tick; keep the record across that gap.
  if (useStepTwoWorkflowStore.getState().kind === 'translate') return;
  writeRecords(readRecords().filter(r => r.owner !== owner));
  syncHeartbeat();
}

let installed = false;

export function installInterruptedJobTracking(): void {
  if (installed) return;
  installed = true;
  useInterruptedJobsStore.getState().refresh();
  // Right after a crash the old tab's last refresh is still recent.
  setTimeout(
    () => useInterruptedJobsStore.getState().refresh(),
    STALE_AFTER_MS + 1_000
  );
  useTaskStore.subscribe((state, prev) => {
    const transcribing = Boolean(state.transcription.inProgress);
    const translating = Boolean(state.translation.inProgress);
    const wasTranscribing = Boolean(prev.transcription.inProgress);
    const wasTranslating = Boolean(prev.translation.inProgress);
    if (transcribing && !wasTranscribing) {
      jobStarted(
        useStepTwoWorkflowStore.getState().kind === 'translate'
          ? 'translate'
          : 'transcribe'
      );
    } else if (translating && !wasTranslating) {
      jobStarted('translate');
    } else if (
      (wasTranscribing || wasTranslating) &&
      !transcribing &&
      !translating
    ) {
      jobEnded();
    }
  });
  useStepTwoWorkflowStore.subscribe((state, prev) => {
    if (prev.kind && !state.kind) jobEnded();
  });
}
