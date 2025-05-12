import { parseSrt } from '../../shared/helpers';
import * as SubtitlesIPC from '@ipc/subtitles';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';

type ProgressPayload = Parameters<
  Parameters<typeof SubtitlesIPC.onGenerateProgress>[0]
>[1];

let queued: ProgressPayload | null = null;
let flushTimer: NodeJS.Timeout | null = null;

function flush() {
  if (!queued) return;

  const {
    stage = '',
    percent = 0,
    partialResult,
    operationId,
    batchStartIndex,
  } = queued;

  useTaskStore.getState().setTranslation({
    stage,
    percent,
    id: operationId ?? null,
    batchStartIndex,
  });

  if (partialResult?.trim()) {
    useSubStore.getState().load(parseSrt(partialResult));
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
