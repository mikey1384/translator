import { BrowserWindow, powerMonitor } from 'electron';
import log from 'electron-log';
import { recordCriticalFailure } from './startup-health.js';
import { getActiveAppWebContents } from '../utils/window.js';

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds
const HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds
export const MAX_HANG_REPORTS = 3; // Limit hung reports per session

let heartbeatTimer: NodeJS.Timeout | null = null;
let lastHeartbeatTime: number | null = null;
let hangReportCount = 0;
let isMonitoring = false;
let isPaused = false;
let suspendHandler: (() => void) | null = null;
let resumeHandler: (() => void) | null = null;

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
  isPaused = false;
  lastHeartbeatTime = Date.now();
  hangReportCount = 0;

  log.info('[hung-window-detector] Starting heartbeat monitoring');

  // Pause monitoring on system suspend to avoid false positives from sleep/lid-close
  suspendHandler = () => {
    log.info('[hung-window-detector] System suspending, pausing monitoring');
    isPaused = true;
  };

  resumeHandler = () => {
    log.info('[hung-window-detector] System resumed, resetting heartbeat timer');
    isPaused = false;
    lastHeartbeatTime = Date.now();
  };

  powerMonitor.on('suspend', suspendHandler);
  powerMonitor.on('resume', resumeHandler);

  const checkHeartbeat = () => {
    if (!window || window.isDestroyed()) {
      stopHungWindowMonitoring();
      return;
    }

    // Don't monitor when paused (system suspended) or when window is not visible
    if (isPaused || !window.isVisible()) {
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
        // Use distinct failure class, not renderer_process_gone
        recordCriticalFailure('renderer_window_hung', 'runtime');
        hangReportCount++;
        // Reset the timer to avoid spam
        lastHeartbeatTime = now;
      }
    } else {
      // Ping the active tab webContents, not the shell window.
      // The app uses shell BrowserWindow + WebContentsView tabs.
      const activeTab = getActiveAppWebContents();
      if (activeTab && !activeTab.isDestroyed()) {
        try {
          activeTab.send('heartbeat-ping');
        } catch (err) {
          log.warn('[hung-window-detector] Failed to send heartbeat ping:', err);
        }
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
  // Remove only the specific listeners we added, not all listeners
  if (suspendHandler) {
    powerMonitor.removeListener('suspend', suspendHandler);
    suspendHandler = null;
  }
  if (resumeHandler) {
    powerMonitor.removeListener('resume', resumeHandler);
    resumeHandler = null;
  }
  isMonitoring = false;
  isPaused = false;
  log.info('[hung-window-detector] Stopped heartbeat monitoring');
}

/**
 * Called by the renderer when it responds to a heartbeat ping.
 */
export function recordHeartbeat(): void {
  lastHeartbeatTime = Date.now();
}
