import { useEffect } from 'react';

/**
 * Sets up a heartbeat listener that automatically responds to pings from the
 * main process. This helps detect hung windows without spamming the renderer.
 */
export function useHeartbeat(): void {
  useEffect(() => {
    const cleanup = window.electron.onHeartbeatPing(() => {
      // The preload layer automatically sends the pong response
    });
    return cleanup;
  }, []);
}
