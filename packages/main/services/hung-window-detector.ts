import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { recordCriticalFailure } from './startup-health.js';

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds
const MAX_HANG_REPORTS = 3; // Limit hung reports per session

let heartbeatTimer: NodeJS.Timeout | null = null;
let lastHeartbeatTime: number | null = null;
let hangReportCount = 0;
let isMonitoring = false;

/**
 * Start monitoring the main window for hangs.
 * The renderer must respond to heartbeat pings within HEARTBEAT_TIMEOUT_MS.
 */
export function startHungWindowMonitoring(window: BrowserWindow): void {
  if (isMonitoring) {
    log.info('[hung-window-detector] Already monitoring');
    return;
  }

  isMonitoring = true;
  lastHeartbeatTime = Date.now();
  hangReportCount = 0;

  log.info('[hung-window-detector] Starting heartbeat monitoring');

  const checkHeartbeat = () => {
    if (!window || window.isDestroyed()) {
      stopHungWindowMonitoring();
      return;
    }

    if (!window.isVisible()) {
      // Don't monitor invisible windows
      lastHeartbeatTime = Date.now();
      return;
    }

    const now = Date.now();
    const timeSinceLastBeat = lastHeartbeatTime ? now - lastHeartbeatTime : 0;

    if (timeSinceLastBeat > HEARTBEAT_TIMEOUT_MS) {
      if (hangReportCount < MAX_HANG_REPORTS) {
        log.warn(
          `[hung-window-detector] Window hung detected (${timeSinceLastBeat}ms since last heartbeat)`
        );
        recordCriticalFailure('renderer_process_gone', 'runtime', 'abnormal-exit');
        hangReportCount++;
        // Reset the timer to avoid spam
        lastHeartbeatTime = now;
      }
    } else {
      // Request a heartbeat ping from the renderer
      try {
        window.webContents.send('heartbeat-ping');
      } catch (err) {
        log.warn('[hung-window-detector] Failed to send heartbeat ping:', err);
      }
    }
  };

  heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_INTERVAL_MS);
}

/**
 * Stop monitoring hung windows.
 */
export function stopHungWindowMonitoring(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  isMonitoring = false;
  log.info('[hung-window-detector] Stopped heartbeat monitoring');
}

/**
 * Called by the renderer when it responds to a heartbeat ping.
 */
export function recordHeartbeat(): void {
  lastHeartbeatTime = Date.now();
}
