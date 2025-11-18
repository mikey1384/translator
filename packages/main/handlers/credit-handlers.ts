import type { CreditBalanceResult } from '@shared-types/app';
import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import axios from 'axios'; // Assuming axios is available
import log from 'electron-log'; // Assuming electron-log is correctly configured

import { v4 as uuidv4 } from 'uuid';
import { syncEntitlements } from '../services/entitlements-manager.js';

// Generate or retrieve device ID using proper UUID v4
export function getDeviceId(): string {
  const deviceIdStore = new Store<{ deviceId?: string }>({
    name: 'device-config',
  });
  let id = deviceIdStore.get('deviceId');
  if (!id) {
    id = uuidv4(); // ✅ valid RFC 4122 v4
    deviceIdStore.set('deviceId', id);
  }
  return id;
}

function sendNetLog(
  level: 'info' | 'warn' | 'error',
  message: string,
  meta?: any
) {
  try {
    const payload = { level, kind: 'network', message, meta };
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('app:log', payload)
    );
  } catch {
    // Do nothing
  }
}
const store = new Store<{ balanceCredits: number; creditsPerHour: number }>({
  name: 'credit-balance',
  defaults: { balanceCredits: 0, creditsPerHour: 100_000 },
});

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  // Dev override to simulate credit state without hitting the API
  const overrideRaw = process.env.CREDIT_BALANCE_OVERRIDE;
  const forceZero = process.env.FORCE_ZERO_CREDITS === '1';
  const perHourOverrideRaw = process.env.CREDITS_PER_HOUR_OVERRIDE;
  if (forceZero || (overrideRaw && overrideRaw.length > 0)) {
    const credits = forceZero ? 0 : Math.max(0, Number(overrideRaw) || 0);
    const creditsPerHour = Math.max(1, Number(perHourOverrideRaw) || 2800);
    store.set('balanceCredits', credits);
    store.set('creditsPerHour', creditsPerHour);
    return {
      success: true,
      creditBalance: credits,
      balanceHours: credits / creditsPerHour,
      creditsPerHour,
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    // Get credit balance from the API (server returns creditBalance and updatedAt)
    const response = await axios.get(
      `https://api.stage5.tools/credits/${getDeviceId()}`,
      { headers: { Authorization: `Bearer ${getDeviceId()}` } }
    );
    // Intentionally avoid logging successful GET /credits to reduce noise in the UI log modal

    const credits = Number(response.data?.creditBalance ?? 0);
    const perHour = Math.max(
      1,
      Number(process.env.CREDITS_PER_HOUR_OVERRIDE) || 2800
    );
    const hours = credits / perHour;
    store.set('balanceCredits', credits);
    store.set('creditsPerHour', perHour); // Cache the conversion rate
    return {
      success: true,
      creditBalance: credits,
      balanceHours: hours,
      creditsPerHour: perHour,
      updatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    if (err.response) {
      sendNetLog(
        'error',
        `HTTP ${err.response.status} GET https://api.stage5.tools/credits`,
        {
          status: err.response.status,
          url: err.config?.url,
          method: err.config?.method,
        }
      );
    } else if (err.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE GET https://api.stage5.tools/credits`,
        { url: err.config?.url, method: err.config?.method }
      );
    }
    log.error('[credit-handler] handleGetCreditBalance error:', err);
    const cachedBal = store.get('balanceCredits', 0);
    const cachedPerHour = store.get('creditsPerHour', 2800);
    return {
      success: false,
      error: err.message,
      creditBalance: cachedBal,
      balanceHours: cachedBal / cachedPerHour,
      creditsPerHour: cachedPerHour,
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function handleCreateCheckoutSession(
  _evt: Electron.IpcMainInvokeEvent,
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO'
): Promise<string | null> {
  try {
    const apiUrl = 'https://api.stage5.tools/payments/create-session';
    log.info(
      `[credit-handler] Creating checkout session for ${packId} via ${apiUrl}`
    );
    const response = await axios.post(apiUrl, {
      packId,
      deviceId: getDeviceId(),
    });
    sendNetLog('info', `POST /payments/create-session -> ${response.status}`, {
      url: apiUrl,
      method: 'POST',
      status: response.status,
    });

    // Expecting backend to respond with { url: 'https://checkout.stripe.com/…' }
    if (response.data?.url) {
      log.info(
        `[credit-handler] Checkout session URL received: ${response.data.url}`
      );

      // Emit checkout-pending event so UI can show "syncing balance..." until webhook lands
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('checkout-pending');
      }

      // Always open inside an Electron modal so we catch the redirect even in dev
      await openStripeCheckout({
        sessionUrl: response.data.url,
        defaultMode: 'credits',
        onSuccess: async ({ sessionId, mode }) => {
          await handleStripeSuccess(sessionId, {
            mode,
            window: mainWindow ?? null,
          });
        },
        onCancel: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('checkout-cancelled');
          }
        },
      });
      return null;
    }
    log.warn(
      '[credit-handler] Backend did not return a URL for checkout session.',
      response.data
    );
    return null;
  } catch (err: any) {
    if (err.response) {
      sendNetLog(
        'error',
        `HTTP ${err.response.status} POST https://api.stage5.tools/payments/create-session`,
        {
          status: err.response.status,
          url: err.config?.url,
          method: err.config?.method,
        }
      );
    } else if (err.request) {
      sendNetLog(
        'error',
        `HTTP NO_RESPONSE POST https://api.stage5.tools/payments/create-session`,
        { url: err.config?.url, method: err.config?.method }
      );
    }
    log.error('[credit-handler] handleCreateCheckoutSession error:', err);
    return null;
  }
}

export async function handleCreateByoUnlockSession(): Promise<void> {
  const mainWindow = BrowserWindow.getAllWindows()[0] ?? null;
  const deviceId = getDeviceId();
  const apiUrl = 'https://api.stage5.tools/payments/create-byo-unlock';

  try {
    log.info('[credit-handler] Initiating BYO OpenAI unlock checkout.');

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('byo-unlock-pending');
    }

    const response = await axios.post(apiUrl, { deviceId });
    sendNetLog(
      'info',
      `POST /payments/create-byo-unlock -> ${response.status}`,
      {
        url: apiUrl,
        method: 'POST',
        status: response.status,
      }
    );

    const checkoutUrl = response.data?.url;
    if (!checkoutUrl) {
      log.warn(
        '[credit-handler] BYO unlock endpoint did not return a checkout URL.'
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('byo-unlock-cancelled');
      }
      return;
    }

    await openStripeCheckout({
      sessionUrl: checkoutUrl,
      defaultMode: 'byo',
      onSuccess: async ({ sessionId, mode }) => {
        await handleStripeSuccess(sessionId, {
          mode,
          window: mainWindow,
        });
      },
      onCancel: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('byo-unlock-cancelled');
        }
      },
      onClosed: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('byo-unlock-closed');
        }
      },
    });
  } catch (err: any) {
    if (err?.response) {
      sendNetLog('error', `HTTP ${err.response.status} POST ${apiUrl}`, {
        status: err.response.status,
        url: err.config?.url,
        method: err.config?.method,
        data: err.response?.data,
      });
    } else if (err?.request) {
      sendNetLog('error', `HTTP NO_RESPONSE POST ${apiUrl}`, {
        url: err.config?.url,
        method: err.config?.method,
      });
    }

    log.error('[credit-handler] Failed to initiate BYO unlock checkout:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('byo-unlock-error', {
        message:
          err?.response?.data?.message ||
          err?.message ||
          'Unable to start checkout',
      });
    }
  }
}

type CheckoutMode = 'credits' | 'byo';

interface StripeCheckoutOptions {
  sessionUrl: string;
  defaultMode: CheckoutMode;
  onSuccess?: (payload: {
    sessionId?: string | null;
    mode: CheckoutMode;
    url: string;
  }) => void | Promise<void>;
  onCancel?: () => void;
  onClosed?: () => void;
}

// Function to open Stripe checkout in a BrowserWindow
async function openStripeCheckout(
  options: StripeCheckoutOptions
): Promise<void> {
  return new Promise(resolve => {
    const parent = BrowserWindow.getAllWindows()[0];
    const win = new BrowserWindow({
      width: 800,
      height: 1000,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      parent,
      modal: true,
    });

    win.loadURL(options.sessionUrl);

    let completed = false;

    const cleanup = () => {
      try {
        if (!win.isDestroyed()) {
          win.webContents.removeListener('will-redirect', handleRedirect);
          win.webContents.removeListener('will-navigate', handleRedirect);
          win.webContents.removeListener('did-fail-load', handleLoadFailure);
        }
      } catch (e) {
        log.warn(
          '[credit-handler] Cleanup after checkout encountered an issue:',
          e
        );
      }
    };

    const finish = (cb?: () => void) => {
      if (completed) return;
      completed = true;
      cleanup();
      try {
        cb?.();
      } catch (err) {
        log.error('[credit-handler] Error during checkout callback:', err);
      }
      resolve();
    };

    const parseMode = (raw: string | null): CheckoutMode => {
      return raw === 'byo' ? 'byo' : 'credits';
    };

    const handleSuccess = async (payload: {
      sessionId?: string | null;
      mode: CheckoutMode;
      url: string;
    }) => {
      try {
        if (options.onSuccess) {
          await options.onSuccess(payload);
        }
      } catch (err) {
        log.error('[credit-handler] onSuccess handler threw:', err);
      } finally {
        finish();
        // Defer close to avoid closing during navigation events (Windows safety)
        setImmediate(() => {
          try {
            if (!win.isDestroyed()) {
              win.close();
            }
          } catch (e) {
            log.warn(
              '[credit-handler] Error closing checkout window after success:',
              e
            );
          }
        });
      }
    };

    const handleRedirect = (event: Electron.Event, url: string) => {
      try {
        const targetUrl = new URL(url);
        const pathname = targetUrl.pathname;

        if (pathname.startsWith('/checkout/success')) {
          event.preventDefault();
          const mode = parseMode(
            targetUrl.searchParams.get('mode') ?? options.defaultMode
          );
          const sessionId = targetUrl.searchParams.get('session_id');
          handleSuccess({ sessionId, mode, url });
          return;
        }

        if (pathname.startsWith('/checkout/cancelled')) {
          event.preventDefault();
          finish(options.onCancel);
          // Defer close to avoid lifecycle races on Windows
          setImmediate(() => {
            try {
              if (!win.isDestroyed()) {
                win.close();
              }
            } catch (e) {
              log.warn(
                '[credit-handler] Error closing checkout window after cancel:',
                e
              );
            }
          });
        }
      } catch (err) {
        log.error(
          '[credit-handler] Failed to parse checkout redirect URL:',
          err
        );
      }
    };

    const handleLoadFailure = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string
    ) => {
      log.error(
        `[credit-handler] Checkout window failed to load: ${errorCode} - ${errorDescription}`
      );
      finish();
      setImmediate(() => {
        try {
          if (!win.isDestroyed()) {
            win.close();
          }
        } catch (e) {
          log.warn(
            '[credit-handler] Error closing checkout window after load failure:',
            e
          );
        }
      });
    };

    win.webContents.on('will-redirect', handleRedirect);
    win.webContents.on('will-navigate', handleRedirect); // Extra safety net for Windows/Linux
    win.webContents.on('did-fail-load', handleLoadFailure);

    win.on('closed', () => {
      finish(options.onClosed);
    });
  });
}

export async function handleResetCredits(): Promise<{
  success: boolean;
  creditsAdded?: number;
  error?: string;
}> {
  try {
    log.info('[credit-handler] Attempting admin add credits...');

    const response = await axios.post(
      'https://api.stage5.tools/admin/add-credits',
      {
        deviceId: getDeviceId(),
        pack: 'STANDARD',
      }
    );

    if (response.data?.success) {
      const { creditsAdded } = response.data;
      log.info(
        `[credit-handler] ✅ Admin add credits successful: Added ${creditsAdded} credits`
      );

      // Force a refresh so UI updates instantly
      const updatedBalance = await handleGetCreditBalance();

      // Broadcast the updated balance to renderer
      if (
        updatedBalance.success &&
        updatedBalance.creditBalance !== undefined
      ) {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send('credits-updated', {
            creditBalance: updatedBalance.creditBalance,
            hoursBalance: updatedBalance.balanceHours || 0,
          });
        }
      }

      return {
        success: true,
        creditsAdded,
      };
    } else {
      const error = response.data?.error || 'Unknown error';
      log.error(`[credit-handler] ❌ Admin add credits failed: ${error}`);
      return { success: false, error };
    }
  } catch (err: any) {
    log.error('[credit-handler] ❌ Admin add credits error:', err);
    return {
      success: false,
      error: err.response?.data?.error || err.message || 'Network error',
    };
  }
}

export async function handleResetCreditsToZero(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    log.info('[credit-handler] Attempting admin credit reset to zero...');

    const response = await axios.post(
      'https://api.stage5.tools/admin/reset-to-zero',
      {
        deviceId: getDeviceId(),
      }
    );

    if (response.data?.success) {
      log.info('[credit-handler] ✅ Admin reset to zero successful');

      // Force a refresh so UI updates instantly
      const updatedBalance = await handleGetCreditBalance();

      // Broadcast the updated balance to renderer
      if (
        updatedBalance.success &&
        updatedBalance.creditBalance !== undefined
      ) {
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow) {
          mainWindow.webContents.send('credits-updated', {
            creditBalance: updatedBalance.creditBalance,
            hoursBalance: updatedBalance.balanceHours || 0,
          });
        }
      }

      return { success: true };
    } else {
      const error = response.data?.error || 'Unknown error';
      log.error(`[credit-handler] ❌ Admin reset to zero failed: ${error}`);
      return { success: false, error };
    }
  } catch (err: any) {
    log.error('[credit-handler] ❌ Admin reset to zero error:', err);
    return {
      success: false,
      error: err.response?.data?.error || err.message || 'Network error',
    };
  }
}

export async function handleStripeSuccess(
  sessionId?: string | null,
  opts: { mode?: CheckoutMode; window?: BrowserWindow | null } = {}
): Promise<void> {
  const mode = opts.mode ?? 'credits';
  const targetWindow = opts.window ?? BrowserWindow.getAllWindows()[0] ?? null;

  if (mode === 'byo') {
    try {
      log.info(
        '[credit-handler] BYO OpenAI unlock payment detected. Refreshing entitlements...'
      );
      const snapshot = await syncEntitlements({
        window: targetWindow ?? undefined,
      });
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('byo-unlock-confirmed', snapshot);
      }
      log.info(
        `[credit-handler] Entitlements synced. BYO unlocked: ${snapshot.byoOpenAi}`
      );
    } catch (error: any) {
      log.error(
        '[credit-handler] Failed to sync entitlements after BYO unlock:',
        error
      );
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('byo-unlock-error', {
          message: error?.message || 'Failed to refresh entitlements',
        });
      }
    }
    return;
  }

  if (!sessionId) {
    log.warn('[credit-handler] Stripe success without sessionId for credits.');
    return;
  }

  try {
    log.info(`[credit-handler] Processing successful payment: ${sessionId}`);

    // Refresh the credit balance from the server with retry logic for webhook race conditions
    let response: any = null;
    for (let i = 0; i < 3; i++) {
      response = await axios.get(
        `https://api.stage5.tools/credits/${getDeviceId()}`,
        { headers: { Authorization: `Bearer ${getDeviceId()}` } }
      );
      if (response.data?.creditBalance !== undefined) break;
      log.info(
        `[credit-handler] Balance not yet updated, retrying in 2s (attempt ${i + 1}/3)...`
      );
      await new Promise(r => setTimeout(r, 2_000)); // wait 2 seconds
    }

    if (response?.data && typeof response.data.creditBalance === 'number') {
      const credits = Number(response.data.creditBalance) || 0;
      const perHour = Math.max(
        1,
        Number(process.env.CREDITS_PER_HOUR_OVERRIDE) || 2800
      );
      const hours = credits / perHour;
      store.set('balanceCredits', credits);
      store.set('creditsPerHour', perHour);
      log.info(
        `[credit-handler] Updated credit balance: ${credits} credits (${hours} hours)`
      );

      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('credits-updated', {
          creditBalance: credits,
          hoursBalance: hours,
        });
        targetWindow.webContents.send('checkout-confirmed');
      }
    }
  } catch (error) {
    log.error('[credit-handler] Error refreshing credit balance:', error);
  }
}
