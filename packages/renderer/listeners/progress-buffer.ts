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
const MIN_PARSE_INTERVAL = 1500;
let lastParsed = 0;

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

  if (partialResult?.trim() && Date.now() - lastParsed > MIN_PARSE_INTERVAL) {
    useSubStore.getState().load(parseSrt(partialResult));
    lastParsed = Date.now();
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
