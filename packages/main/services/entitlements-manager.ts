import axios from 'axios';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import { getDeviceId } from '../handlers/credit-handlers.js';

export interface EntitlementsSnapshot {
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  fetchedAt?: string;
}

const API_BASE = 'https://api.stage5.tools';

let storeRef: SettingsStoreType | null = null;

export function initEntitlementsManager(store: SettingsStoreType) {
  storeRef = store;
}

export function getCachedEntitlements(): EntitlementsSnapshot {
  const byoOpenAi = storeRef?.get('byoOpenAiUnlocked', false) ?? false;
  const byoAnthropic = storeRef?.get('byoAnthropicUnlocked', false) ?? false;
  return {
    byoOpenAi: Boolean(byoOpenAi),
    byoAnthropic: Boolean(byoAnthropic),
    fetchedAt: undefined,
  };
}

export function setByoUnlocked(
  entitlements: { byoOpenAi?: boolean; byoAnthropic?: boolean },
  opts: { notify?: boolean; window?: BrowserWindow | null } = {}
): EntitlementsSnapshot {
  if (!storeRef) {
    log.warn('[entitlements-manager] setByoUnlocked called before init.');
  } else {
    if (entitlements.byoOpenAi !== undefined) {
      storeRef.set('byoOpenAiUnlocked', Boolean(entitlements.byoOpenAi));
    }
    if (entitlements.byoAnthropic !== undefined) {
      storeRef.set('byoAnthropicUnlocked', Boolean(entitlements.byoAnthropic));
    }
  }

  const snapshot: EntitlementsSnapshot = {
    byoOpenAi: Boolean(
      entitlements.byoOpenAi ?? storeRef?.get('byoOpenAiUnlocked', false)
    ),
    byoAnthropic: Boolean(
      entitlements.byoAnthropic ?? storeRef?.get('byoAnthropicUnlocked', false)
    ),
    fetchedAt: new Date().toISOString(),
  };

  if (opts.notify !== false) {
    const target = opts.window ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (target && !target.isDestroyed()) {
      target.webContents.send('entitlements-updated', snapshot);
    }
  }

  return snapshot;
}

export async function fetchEntitlementsFromServer(): Promise<EntitlementsSnapshot> {
  const deviceId = getDeviceId();
  const url = `${API_BASE}/entitlements/${deviceId}`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${deviceId}` },
      timeout: 15_000,
    });

    const data = response.data ?? {};
    const byoOpenAi = Boolean(
      data?.entitlements?.byoOpenAi ??
        data?.byoOpenAi ??
        data?.unlocked ??
        false
    );
    const byoAnthropic = Boolean(
      data?.entitlements?.byoAnthropic ?? data?.byoAnthropic ?? false
    );

    return setByoUnlocked({ byoOpenAi, byoAnthropic }, { notify: false });
  } catch (error: any) {
    log.error('[entitlements-manager] Failed to fetch entitlements:', error);
    throw error;
  }
}

export async function syncEntitlements(
  opts: { window?: BrowserWindow | null; silent?: boolean } = {}
): Promise<EntitlementsSnapshot> {
  try {
    const snapshot = await fetchEntitlementsFromServer();
    if (!opts.silent) {
      setByoUnlocked(
        { byoOpenAi: snapshot.byoOpenAi, byoAnthropic: snapshot.byoAnthropic },
        {
          notify: true,
          window: opts.window,
        }
      );
    } else {
      setByoUnlocked(
        { byoOpenAi: snapshot.byoOpenAi, byoAnthropic: snapshot.byoAnthropic },
        {
          notify: false,
          window: opts.window,
        }
      );
    }
    return {
      ...snapshot,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    // Preserve existing cached value on fetch failures, but log the error.
    const cached = getCachedEntitlements();
    if (!opts.silent) {
      const target = opts.window ?? BrowserWindow.getAllWindows()[0] ?? null;
      if (target && !target.isDestroyed()) {
        target.webContents.send('entitlements-error', {
          message: error?.message || 'Failed to fetch entitlements',
        });
      }
    }
    return cached;
  }
}

export function ensureEntitlementsInitialized() {
  if (!storeRef) {
    throw new Error(
      '[entitlements-manager] Manager used before initialization.'
    );
  }
}
