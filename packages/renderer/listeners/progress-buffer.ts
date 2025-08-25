import { parseSrt } from '../../shared/helpers';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
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

  // Only accept updates for the active translation operation
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

  const isComplete = percent >= 100 || /processing complete/i.test(stage ?? '');

  // Apply partial SRT updates during processing (throttled), and load immediately on completion
  if (partialResult?.trim()) {
    if (isComplete || Date.now() - lastParsed > 1500) {
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

  // If the task has been marked complete (inProgress=false), ignore any late non-final updates
  if (!inProgress) {
    queued = null;
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
