import { useTaskStore } from '../state';
import * as SubtitlesIPC from '@ipc/subtitles';

SubtitlesIPC.onGenerateProgress(msg => {
  useTaskStore.getState().setTranslation({
    stage: msg.stage || '',
    percent: msg.percent || 0,
    inProgress: (msg.percent || 0) < 100,
    id: msg.operationId || null,
    batchStartIndex: msg.batchStartIndex,
  });
});
