import '../state/task-store'; // ensures store is initialised
import { useTaskStore } from '../state/task-store';
import { useSubStore } from '../state/subtitle-store';
import { parseSrt } from '../../shared/helpers/index';
import * as UrlIPC from '../ipc/url';
import * as SubsIPC from '../ipc/subtitles';
import './key-listener';
import './search-listener';

/* URL download progress */
UrlIPC.onProgress(p => {
  if (p.stage === 'Download cancelled') {
    useTaskStore.setState({
      download: { id: null, stage: '', percent: 0, inProgress: false },
    });
    return;
  }
  useTaskStore.setState({
    download: {
      id: p.operationId ?? null,
      stage: p.stage ?? '',
      percent: p.percent ?? 0,
      inProgress: (p.percent ?? 0) < 100,
    },
  });
});

/* Subtitle generation / translation progress */
SubsIPC.onGenerateProgress(p => {
  const { percent = 0, stage = '', partialResult } = p;
  useTaskStore.setState({
    translation: {
      stage,
      percent,
      inProgress: percent < 100,
      id: p.operationId ?? null,
    },
  });
  if (partialResult?.trim()) {
    useSubStore.getState().load(parseSrt(partialResult));
  }
});
