import axios from 'axios';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import { getDeviceId } from '../handlers/credit-handlers.js';
import { STAGE5_API_URL } from './stage5-client.js';
import { getMainWindow } from '../utils/window.js';

export interface EntitlementsSnapshot {
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  fetchedAt?: string;
}

let storeRef: SettingsStoreType | null = null;

export function initEntitlementsManager(store: SettingsStoreType) {
  storeRef = store;
}

export function getCachedEntitlements(): EntitlementsSnapshot {
  const byoOpenAi = storeRef?.get('byoOpenAiUnlocked', false) ?? false;
  const byoAnthropic = storeRef?.get('byoAnthropicUnlocked', false) ?? false;
  const byoElevenLabs = storeRef?.get('byoElevenLabsUnlocked', false) ?? false;
  return {
    byoOpenAi: Boolean(byoOpenAi),
    byoAnthropic: Boolean(byoAnthropic),
    byoElevenLabs: Boolean(byoElevenLabs),
    fetchedAt: undefined,
  };
}

export function setByoUnlocked(
  entitlements: {
    byoOpenAi?: boolean;
    byoAnthropic?: boolean;
    byoElevenLabs?: boolean;
  },
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
    if (entitlements.byoElevenLabs !== undefined) {
      storeRef.set(
        'byoElevenLabsUnlocked',
        Boolean(entitlements.byoElevenLabs)
      );
    }
  }

  const snapshot: EntitlementsSnapshot = {
    byoOpenAi: Boolean(
      entitlements.byoOpenAi ?? storeRef?.get('byoOpenAiUnlocked', false)
    ),
    byoAnthropic: Boolean(
      entitlements.byoAnthropic ?? storeRef?.get('byoAnthropicUnlocked', false)
    ),
    byoElevenLabs: Boolean(
      entitlements.byoElevenLabs ??
      storeRef?.get('byoElevenLabsUnlocked', false)
    ),
    fetchedAt: new Date().toISOString(),
  };

  if (opts.notify !== false) {
    const target = opts.window ?? getMainWindow();
    if (target && !target.isDestroyed()) {
      target.webContents.send('entitlements-updated', snapshot);
    }
  }

  return snapshot;
}

export async function fetchEntitlementsFromServer(): Promise<EntitlementsSnapshot> {
  const deviceId = getDeviceId();
  const url = `${STAGE5_API_URL}/entitlements/${deviceId}`;

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
    const byoElevenLabs = Boolean(
      data?.entitlements?.byoElevenLabs ?? data?.byoElevenLabs ?? false
    );

    return setByoUnlocked(
      { byoOpenAi, byoAnthropic, byoElevenLabs },
      { notify: false }
    );
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
        {
          byoOpenAi: snapshot.byoOpenAi,
          byoAnthropic: snapshot.byoAnthropic,
          byoElevenLabs: snapshot.byoElevenLabs,
        },
        {
          notify: true,
          window: opts.window,
        }
      );
    } else {
      setByoUnlocked(
        {
          byoOpenAi: snapshot.byoOpenAi,
          byoAnthropic: snapshot.byoAnthropic,
          byoElevenLabs: snapshot.byoElevenLabs,
        },
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
      const target = opts.window ?? getMainWindow();
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
