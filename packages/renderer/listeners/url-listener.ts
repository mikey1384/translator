import { useUrlStore } from '../state/url-store';
import * as UrlIPC from '../ipc/url';

UrlIPC.onProgress(p => {
  const { percent = 0, stage = '', operationId: opId } = p;
  if (stage !== 'NeedCookies' && stage !== 'Cancelled') {
    useUrlStore.getState().setDownload({
      id: opId,
      stage,
      percent,
      inProgress: percent < 100,
    });
  }
  // Avoid surfacing transient/cancel or cookie-handoff messages as error banner
  if (p.stage === 'NeedCookies' || p.stage === 'Cancelled') {
    useUrlStore.getState().setError('');
  } else if (p.error) {
    useUrlStore.getState().setError(p.error as string);
  } else {
    useUrlStore.getState().setError('');
  }
});
