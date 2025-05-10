import { useUrlStore } from '../state/url-store';
import * as UrlIPC from '../ipc/url';

UrlIPC.onProgress(p => {
  const { percent = 0, stage = '', operationId: opId } = p;
  useUrlStore.getState().setDownload({
    id: opId,
    stage,
    percent,
    inProgress: percent < 100,
  });
  if (p.error) useUrlStore.getState().setError(p.error as string);
  else useUrlStore.getState().setError('');
});
