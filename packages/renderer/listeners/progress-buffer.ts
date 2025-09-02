import { parseSrt, secondsToSrtTime } from '../../shared/helpers';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
import { useUIStore } from '../state/ui-store';
import { useCreditStore } from '../state/credit-store';

type ProgressPayload = Parameters<
  Parameters<typeof SubtitlesIPC.onGenerateProgress>[0]
>[1];

let queued: ProgressPayload | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let lastParsed = 0;

function flush() {
  if (!queued) return;

  const {
    stage = '',
    percent = 0,
    operationId,
    batchStartIndex,
    partialResult,
  } = queued;

  // Route updates based on operationId prefix
  const isTranscribe = operationId?.startsWith('transcribe-');
  const isTranslate = operationId?.startsWith('translate-');

  if (isTranslate) {
    const active = useTaskStore.getState().translation.id;
    const inProgress = useTaskStore.getState().translation.inProgress;
    if (active && operationId && operationId !== active) {
      queued = null;
      return;
    }
    useTaskStore.getState().setTranslation({
      stage,
      percent,
      id: operationId ?? null,
      batchStartIndex,
    });
    // After completion, stop applying any further queued updates
    const isComplete =
      percent >= 100 || /processing complete/i.test(stage ?? '');
    if (isComplete) {
      queued = null;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      return;
    }
    // If the task has been marked complete (inProgress=false), ignore any late non-final updates
    if (!inProgress) {
      queued = null;
      return;
    }
  } else if (isTranscribe) {
    const active = useTaskStore.getState().transcription.id;
    if (active && operationId && operationId !== active) {
      queued = null;
      return;
    }
    useTaskStore.getState().setTranscription({
      stage,
      percent,
      id: operationId ?? null,
      batchStartIndex,
    });

    // Surface progress to the user by opening the Edit panel automatically
    // when transcription is underway so the incremental results are visible.
    try {
      const { showEditPanel, setEditPanelOpen } = useUIStore.getState();
      if (!showEditPanel) setEditPanelOpen(true);
    } catch {}
  }

  const isComplete = percent >= 100 || /processing complete/i.test(stage ?? '');

  // Apply partial SRT updates during processing (throttled), and load immediately on completion
  if (partialResult?.trim()) {
    const isTranslateMissing = operationId?.startsWith('translate-missing-');
    if (isTranslateMissing) {
      // Incrementally apply translations only to matching timecodes
      try {
        const partSegs = parseSrt(partialResult);
        if (partSegs.length) {
          const store = useSubStore.getState();
          const current = useSubStore.getState();
          // Build lookup by time key
          const byTimeKey = new Map<string, string>(); // key -> id
          for (const id of current.order) {
            const s = current.segments[id];
            const key = `${secondsToSrtTime(s.start)}-->${secondsToSrtTime(
              s.end
            )}`;
            if (!byTimeKey.has(key)) byTimeKey.set(key, id);
          }
          for (const seg of partSegs) {
            const key = `${secondsToSrtTime(seg.start)}-->${secondsToSrtTime(
              seg.end
            )}`;
            const matchId = byTimeKey.get(key);
            const translated = seg.translation?.trim();
            if (matchId && translated) {
              store.update(matchId, { translation: translated });
            }
          }
        }
      } catch {
        // Ignore parse/apply errors for partial updates
      }
    } else if (isComplete || Date.now() - lastParsed > 1500) {
      useSubStore.getState().load(parseSrt(partialResult));
      lastParsed = Date.now();
    }
  }

  // After completion, stop applying any further queued updates
  if (isComplete) {
    queued = null;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    return;
  }

  // Refresh credit balance during AI processing phases when credits are being consumed
  const stageLower = stage.toLowerCase();
  const isActiveAIPhase =
    stageLower.includes('transcrib') ||
    stageLower.includes('translat') ||
    stageLower.includes('reviewing') ||
    stageLower.includes('__i18n__:transcribed');

  if (isActiveAIPhase && percent > 0 && percent <= 100) {
    useCreditStore.getState().refresh();
  }

  queued = null;
}

SubtitlesIPC.onGenerateProgress(progress => {
  queued = progress;

  if (!document.hidden) {
    flush();
    return;
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 500);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flush();
  }
});
