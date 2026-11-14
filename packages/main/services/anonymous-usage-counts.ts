import fs from 'node:fs';
import path from 'node:path';
import nodeProcess from 'node:process';
import axios from 'axios';
import { app } from 'electron';
import { createSafeStore } from '../store/safe-store.js';
import log from 'electron-log';
import { STAGE5_API_URL } from './endpoints.js';
import { shouldSendProductAnalytics } from './product-analytics-policy.js';
import {
  addCount,
  prunePendingCounts,
  removeSent,
  takeBatch,
  type PendingCounts,
} from './usage-count-buffer.js';
import { PROVISIONAL_USAGE_EVENTS } from './handoff-funnel.js';

// Anonymous step counts ("+1 app_open on 2026-10-13, win32, 1.25.0"). They
// carry no device id, token, content or settings and are sent without auth
// headers, so they are on for everyone; detailed analytics stay opt-in.

type UsageCountStore = {
  pending: PendingCounts;
  firstOpenCounted?: boolean;
};

const FLUSH_DELAY_MS = 5_000;

const store = createSafeStore<UsageCountStore>({
  name: 'anonymous-usage-counts',
  defaults: { pending: {} },
});

let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing: Promise<void> | null = null;

function available(): boolean {
  return shouldSendProductAnalytics({
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  });
}

function platform(): 'darwin' | 'win32' | 'linux' {
  return nodeProcess.platform === 'win32' || nodeProcess.platform === 'linux'
    ? nodeProcess.platform
    : 'darwin';
}

function readPending(): PendingCounts {
  return prunePendingCounts(store.get('pending'), new Date());
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushAnonymousUsageCounts();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

export function countAnonymousUsage(event: string): void {
  if (!available()) return;
  try {
    store.set('pending', addCount(readPending(), event, new Date()));
    scheduleFlush();
  } catch (error) {
    log.info('[usage-counts] Could not record a count:', error);
  }
}

/**
 * Whether this launch is a brand-new install. Installs that predate these
 * counts already have a device-config file from an earlier launch, so they
 * are not miscounted as first opens when they update.
 */
function isNewInstall(): boolean {
  const deviceConfig = path.join(app.getPath('userData'), 'device-config.json');
  try {
    const createdAt = fs.statSync(deviceConfig).birthtimeMs;
    const launchedAt = Date.now() - nodeProcess.uptime() * 1000;
    return createdAt >= launchedAt - 60_000;
  } catch {
    return true;
  }
}

export function countAnonymousAppOpen(): void {
  if (!available()) return;
  if (store.get('firstOpenCounted') !== true) {
    if (isNewInstall()) countAnonymousUsage('app_first_open');
    store.set('firstOpenCounted', true);
  }
  countAnonymousUsage('app_open');
}

/**
 * One request per group. Established names go first and are dropped on a
 * 400, as before. Names the server may not know yet (provisional) go in a
 * request of their own, so a refusal can never take the established counts
 * with it, and they stay pending (inside the 14-day window) until accepted.
 */
async function postBatch(
  include: (event: string) => boolean,
  dropOnRefusal: boolean
): Promise<boolean> {
  const batch = takeBatch(readPending(), include);
  if (batch.length === 0) return false;
  try {
    await axios.post(
      `${STAGE5_API_URL}/usage/counts`,
      {
        appVersion: app.getVersion(),
        platform: platform(),
        counts: batch.map(({ event, day, n }) => ({ event, day, n })),
      },
      { timeout: 10_000 }
    );
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    // A 400 means the server will never accept these; drop them. Anything
    // else (offline, 5xx) keeps them for the next flush.
    if (status !== 400 || !dropOnRefusal) return false;
  }
  store.set('pending', removeSent(readPending(), batch));
  return true;
}

export function flushAnonymousUsageCounts(): Promise<void> {
  if (!available()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    store.set('pending', readPending());
    const establishedSent = await postBatch(
      event => !PROVISIONAL_USAGE_EVENTS.has(event),
      true
    );
    await postBatch(event => PROVISIONAL_USAGE_EVENTS.has(event), false);
    const left = readPending();
    // More established counts than one request holds: send the rest soon.
    // Provisional ones wait for the regular flushes instead of retrying hot.
    if (
      establishedSent &&
      Object.keys(left).some(
        key => !PROVISIONAL_USAGE_EVENTS.has(key.slice(11))
      )
    )
      scheduleFlush();
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}
