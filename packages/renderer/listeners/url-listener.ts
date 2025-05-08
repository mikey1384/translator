import { useUIStore, useTaskStore } from '../state';
import * as UrlIPC from '../ipc/url';

UrlIPC.onProgress(p => {
  useTaskStore.getState().setDownload({
    id: p.operationId || null,
    stage: p.stage || '',
    percent: p.percent || 0,
    inProgress: (p.percent || 0) < 100,
  });
  if (p.error) useUIStore.getState().setError(p.error as string);
  else useUIStore.getState().setError(null);
});
