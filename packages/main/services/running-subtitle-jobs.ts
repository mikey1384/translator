import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import log from 'electron-log';
import type Store from 'electron-store';
import { createSafeStore } from '../store/safe-store.js';
import {
  applyRunningJobOp,
  RUNNING_JOBS_CHANNEL,
  RUNNING_JOBS_LIST_CHANNEL,
  sanitizeRunningJobRecords,
  type RunningJobOp,
  type RunningJobRecord,
} from '../../shared/helpers/running-subtitle-jobs.js';

/**
 * The running-job records behind the "stopped when Translator closed" notice.
 * Renderer localStorage is not flushed before a crash or force-quit, so the
 * records live here and every change is written to disk before the tab's
 * synchronous call returns.
 */

type Shape = { records: RunningJobRecord[] };

const SESSION = randomUUID();
let store: Store<Shape> | null = null;
let memory: RunningJobRecord[] = [];

function getStore(): Store<Shape> | null {
  if (store) return store;
  try {
    store = createSafeStore<Shape>({
      name: 'running-subtitle-jobs',
      defaults: { records: [] },
    });
  } catch (error) {
    log.warn('[running-subtitle-jobs] store unavailable:', error);
  }
  return store;
}

function read(): RunningJobRecord[] {
  const s = getStore();
  if (!s) return memory;
  try {
    return sanitizeRunningJobRecords(s.get('records'));
  } catch {
    return memory;
  }
}

function write(records: RunningJobRecord[]): void {
  memory = records;
  try {
    getStore()?.set('records', records);
  } catch (error) {
    log.warn('[running-subtitle-jobs] write failed:', error);
  }
}

export function registerRunningSubtitleJobHandlers(): void {
  ipcMain.on(RUNNING_JOBS_LIST_CHANNEL, event => {
    event.returnValue = { records: read(), session: SESSION };
  });
  ipcMain.on(RUNNING_JOBS_CHANNEL, (event, op: RunningJobOp) => {
    try {
      if (op && typeof op === 'object') {
        write(applyRunningJobOp(read(), op, SESSION));
      }
    } catch (error) {
      log.warn('[running-subtitle-jobs] op failed:', error);
    }
    event.returnValue = { records: read(), session: SESSION };
  });
}
