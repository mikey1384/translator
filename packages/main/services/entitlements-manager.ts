import axios from 'axios';
import { BrowserWindow } from 'electron';
import log from 'electron-log';
import type { SettingsStoreType } from '../handlers/settings-handlers.js';
import { getDeviceId } from '../handlers/credit-handlers.js';
import { STAGE5_API_URL } from './endpoints.js';
import { withStage5AuthRetry } from './stage5-auth.js';
import { getMainWindow } from '../utils/window.js';
import {
  isStage5UpdateRequiredError,
  throwIfStage5UpdateRequiredError,
} from './stage5-version-gate.js';

export interface EntitlementsSnapshot {
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  stage5AnthropicReviewAvailable: boolean;
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
  const stage5AnthropicReviewAvailable =
    storeRef?.get('stage5AnthropicReviewAvailable', false) ?? false;
  return {
    byoOpenAi: Boolean(byoOpenAi),
    byoAnthropic: Boolean(byoAnthropic),
    byoElevenLabs: Boolean(byoElevenLabs),
    stage5AnthropicReviewAvailable: Boolean(stage5AnthropicReviewAvailable),
    fetchedAt: undefined,
  };
}

export function setByoUnlocked(
  entitlements: {
    byoOpenAi?: boolean;
    byoAnthropic?: boolean;
    byoElevenLabs?: boolean;
    stage5AnthropicReviewAvailable?: boolean;
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
    if (entitlements.stage5AnthropicReviewAvailable !== undefined) {
      storeRef.set(
        'stage5AnthropicReviewAvailable',
        Boolean(entitlements.stage5AnthropicReviewAvailable)
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
    stage5AnthropicReviewAvailable: Boolean(
      entitlements.stage5AnthropicReviewAvailable ??
        storeRef?.get('stage5AnthropicReviewAvailable', false)
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
    const response = await withStage5AuthRetry(authHeaders =>
      axios.get(url, {
        headers: authHeaders,
        timeout: 15_000,
      })
    );

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
    const stage5AnthropicReviewAvailable = Boolean(
      data?.capabilities?.stage5AnthropicReviewAvailable ?? false
    );

    return setByoUnlocked(
      {
        byoOpenAi,
        byoAnthropic,
        byoElevenLabs,
        stage5AnthropicReviewAvailable,
      },
      { notify: false }
    );
  } catch (error: any) {
    throwIfStage5UpdateRequiredError({ error, source: 'stage5-api' });
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
          stage5AnthropicReviewAvailable:
            snapshot.stage5AnthropicReviewAvailable,
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
          stage5AnthropicReviewAvailable:
            snapshot.stage5AnthropicReviewAvailable,
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
    if (isStage5UpdateRequiredError(error)) {
      throw error;
    }
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
