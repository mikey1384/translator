import { createWithEqualityFn } from 'zustand/traditional';
import { useTaskStore } from './task-store';
import { useUIStore } from './ui-store';
import { useVideoStore } from './video-store';
import { useSubStore } from './subtitle-store';
import { useStepTwoWorkflowStore } from './step-two-workflow-store';
import { freePreviewKey } from './free-preview-store';
import {
  applyRunningJobOp,
  sanitizeRunningJobRecords,
  STALE_AFTER_MS,
  staleRecords,
  type InterruptedJobKind,
  type RunningJobOp,
  type RunningJobRecord,
} from '../../shared/helpers/running-subtitle-jobs';
import { saveMountedSubtitleDocument } from '../utils/subtitle-documents';

export type { InterruptedJobKind, RunningJobRecord };

/**
 * Paid subtitle jobs that were still running when Translator quit or
 * crashed. Each running transcription/translation leaves a small record per
 * source; a clean finish, failure or cancel removes it. A record whose tab
 * stopped refreshing it (or that belongs to an earlier app run) is a job the
 * user never saw finish, so the workspace can say so and offer to resume
 * (which reuses the durable transcription).
 *
 * Main keeps the records on disk: renderer localStorage is lost when the app
 * is killed or crashes, which is exactly when the notice matters.
 */

const FALLBACK_KEY = 'runningSubtitleJobs.v1';
const HEARTBEAT_MS = 10_000;

const owner = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type Snapshot = { records: RunningJobRecord[]; session: string | null };

function bridge() {
  const api = (globalThis as any).window?.electron;
  return api &&
    typeof api.listRunningSubtitleJobs === 'function' &&
    typeof api.applyRunningSubtitleJobOp === 'function'
    ? api
    : null;
}

function readFallback(): RunningJobRecord[] {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return sanitizeRunningJobRecords(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function toSnapshot(value: any): Snapshot {
  return {
    records: sanitizeRunningJobRecords(value?.records),
    session: typeof value?.session === 'string' ? value.session : null,
  };
}

function readSnapshot(): Snapshot {
  const api = bridge();
  if (api) {
    try {
      return toSnapshot(api.listRunningSubtitleJobs());
    } catch {
      // Fall through to the local copy.
    }
  }
  return { records: readFallback(), session: null };
}

const readRecords = () => readSnapshot().records;

function apply(op: RunningJobOp): void {
  const api = bridge();
  if (api) {
    try {
      api.applyRunningSubtitleJobOp(op);
      return;
    } catch {
      // Fall through to the local copy.
    }
  }
  try {
    localStorage.setItem(
      FALLBACK_KEY,
      JSON.stringify(applyRunningJobOp(readFallback(), op))
    );
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
      const { records, session } = readSnapshot();
      const found = staleRecords(records, Date.now(), owner, session);
      set({ items: Object.fromEntries(found.map(r => [r.key, r])) });
    },
    dismiss(key) {
      apply({ type: 'dismiss', key, keepOwner: owner });
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
      apply({ type: 'heartbeat', owner, now: Date.now() });
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
  apply({
    type: 'start',
    record: { key, kind, language, startedAt: now, aliveAt: now, owner },
  });
  useInterruptedJobsStore.getState().dismiss(key);
  syncHeartbeat();
  // A translation of subtitles already on screen: keep a copy of them so
  // picking the job up after a crash starts from the same lines.
  if (kind === 'translate' && useSubStore.getState().order.length > 0) {
    void saveMountedSubtitleDocument({ keepDirty: true })
      .then(saved => {
        if (saved.success && saved.documentId) {
          apply({
            type: 'attachDocument',
            key,
            owner,
            documentId: saved.documentId,
          });
        }
      })
      .catch(() => {
        // Without the copy, picking up starts from the video instead.
      });
  }
}

function jobEnded(): void {
  const tasks = useTaskStore.getState();
  if (tasks.transcription.inProgress || tasks.translation.inProgress) return;
  // A transcription that hands off to translation ends and the translation
  // starts in a later tick; keep the record across that gap.
  if (useStepTwoWorkflowStore.getState().kind === 'translate') return;
  apply({ type: 'end', owner });
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
