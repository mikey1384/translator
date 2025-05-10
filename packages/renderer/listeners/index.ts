import '../state/task-store';
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
import { parseSrt } from '../../shared/helpers/index';
import * as SubsIPC from '../ipc/subtitles';
import './key-listener';
import './search-listener';
import './translation-listener.js';

SubsIPC.onGenerateProgress(p => {
  const { percent = 0, stage = '', partialResult } = p;
  useTaskStore.getState().setTranslation({
    stage,
    percent,
    id: p.operationId ?? null,
    batchStartIndex: p.batchStartIndex,
  });
  if (partialResult?.trim()) {
    useSubStore.getState().load(parseSrt(partialResult));
  }
});
