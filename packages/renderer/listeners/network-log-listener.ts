import { useLogsStore } from '../state/logs-store';

// Subscribe to app-level logs from main (network/status)
try {
  (window as any).electron?.onAppLog?.((payload: any) => {
    try {
      const level = (payload?.level as any) || 'info';
      const kind = (payload?.kind as any) || 'network';
      const message = String(payload?.message || '');
      const meta = payload?.meta || {};
      useLogsStore.getState().add({ level, kind, message, meta });
    } catch {
      // Do nothing
    }
  });
} catch {
  // Do nothing
}
