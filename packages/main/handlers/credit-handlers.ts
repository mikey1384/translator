import type { CreditBalanceResult } from '@shared-types/app';
import Store from 'electron-store';
import { BrowserWindow } from 'electron';
import axios from 'axios'; // Assuming axios is available
import log from 'electron-log'; // Assuming electron-log is correctly configured

import { v4 as uuidv4 } from 'uuid';

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
    sendNetLog('info', `GET /credits -> ${response.status}`, {
      url: 'https://api.stage5.tools/credits',
      method: 'GET',
      status: response.status,
    });

    const credits = Number(response.data?.creditBalance ?? 0);
    const perHour = Math.max(1, Number(process.env.CREDITS_PER_HOUR_OVERRIDE) || 2800);
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
      await openStripeCheckout(response.data.url);
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

// Function to open Stripe checkout in a BrowserWindow
async function openStripeCheckout(sessionUrl: string): Promise<void> {
  return new Promise(resolve => {
    const win = new BrowserWindow({
      width: 800,
      height: 1000,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
      },
      parent: BrowserWindow.getAllWindows()[0], // Use first available window as parent
      modal: true,
    });

    win.loadURL(sessionUrl);

    // Handle redirect events (will-redirect is primary, will-navigate as safety net)
    const handleRedirect = (event: Electron.Event, url: string) => {
      if (url.startsWith('https://stage5.tools/checkout/success')) {
        event.preventDefault(); // stay on current page
        const u = new URL(url);
        const sessionId = u.searchParams.get('session_id');
        handleStripeSuccess(sessionId);
        win.close();
        resolve();
      } else if (url.startsWith('https://stage5.tools/checkout/cancelled')) {
        event.preventDefault();
        win.close();
        resolve();
      }
    };

    win.webContents.on('will-redirect', handleRedirect);
    win.webContents.on('will-navigate', handleRedirect); // Extra safety net for Windows/Linux

    // Handle network failures to prevent freezing
    win.webContents.on('did-fail-load', (_, errorCode, errorDescription) => {
      log.error(
        `[credit-handler] Checkout window failed to load: ${errorCode} - ${errorDescription}`
      );
      win.close();
      resolve();
    });

    win.on('closed', () => {
      resolve();
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
  sessionId?: string | null
): Promise<void> {
  if (!sessionId) return;

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
      const perHour = Math.max(1, Number(process.env.CREDITS_PER_HOUR_OVERRIDE) || 2800);
      const hours = credits / perHour;
      store.set('balanceCredits', credits);
      store.set('creditsPerHour', perHour);
      log.info(`[credit-handler] Updated credit balance: ${credits} credits (${hours} hours)`);

      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('credits-updated', {
          creditBalance: credits,
          hoursBalance: hours,
        });
        mainWindow.webContents.send('checkout-confirmed');
      }
    }
  } catch (error) {
    log.error('[credit-handler] Error refreshing credit balance:', error);
  }
}
