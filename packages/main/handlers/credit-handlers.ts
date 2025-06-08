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

const store = new Store<{ balanceCredits: number; creditsPerHour: number }>({
  name: 'credit-balance',
  defaults: { balanceCredits: 0, creditsPerHour: 83333 },
});

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  try {
    // Get credit balance from the API
    const response = await axios.get(
      `https://api.stage5.tools/credits/${getDeviceId()}`,
      { headers: { Authorization: `Bearer ${getDeviceId()}` } }
    );

    if (
      response.data &&
      typeof response.data.creditBalance === 'number' &&
      typeof response.data.hoursBalance === 'number'
    ) {
      const { creditBalance, hoursBalance, creditsPerHour } = response.data;
      store.set('balanceCredits', creditBalance); // Update cache
      store.set('creditsPerHour', creditsPerHour); // Cache the conversion rate
      return {
        success: true,
        creditBalance,
        balanceHours: hoursBalance, // Use API's calculation directly
        creditsPerHour,
        updatedAt: new Date().toISOString(),
      };
    } else {
      throw new Error('Invalid response format from credit balance API');
    }
  } catch (err: any) {
    log.error('[credit-handler] handleGetCreditBalance error:', err);
    const cachedBal = store.get('balanceCredits', 0);
    const cachedPerHour = store.get('creditsPerHour', 83333);
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
  packId: 'STARTER' | 'STANDARD' | 'PRO'
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

    // Expecting backend to respond with { url: 'https://checkout.stripe.com/…' }
    if (response.data?.url) {
      log.info(
        `[credit-handler] Checkout session URL received: ${response.data.url}`
      );

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
    log.error('[credit-handler] handleCreateCheckoutSession error:', err);
    return null;
  }
}

export async function handleRefundCredits(
  _evt: Electron.IpcMainInvokeEvent,
  hours: number
): Promise<{
  success: boolean;
  newBalanceCredits?: number;
  newBalanceHours?: number;
  error?: string;
}> {
  try {
    if (typeof hours !== 'number' || hours <= 0) {
      return { success: false, error: 'Invalid hours to refund' };
    }
    const perHour = store.get('creditsPerHour', 83333); // Use cached conversion rate
    const creditsToRefund = hours * perHour; // Convert hours to credits
    const currentBalance = store.get('balanceCredits', 0);
    const newBalance = currentBalance + creditsToRefund;
    store.set('balanceCredits', newBalance);

    // Emit credits-updated event to notify UI
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('credits-updated', {
        creditBalance: newBalance,
        hoursBalance: newBalance / perHour,
      });
    }

    return {
      success: true,
      newBalanceCredits: newBalance,
      newBalanceHours: newBalance / perHour,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function handleReserveCredits(
  _evt: Electron.IpcMainInvokeEvent,
  hours: number
): Promise<{
  success: boolean;
  newBalanceCredits?: number;
  newBalanceHours?: number;
  error?: string;
}> {
  try {
    if (typeof hours !== 'number' || hours <= 0) {
      return { success: false, error: 'Invalid hours to reserve' };
    }
    const perHour = store.get('creditsPerHour', 83333); // Use cached conversion rate
    const creditsToReserve = hours * perHour; // Convert hours to credits
    const currentBalance = store.get('balanceCredits', 0);
    if (currentBalance < creditsToReserve) {
      return { success: false, error: 'Insufficient credits' };
    }
    const newBalance = currentBalance - creditsToReserve;
    store.set('balanceCredits', newBalance);

    // Emit credits-updated event to notify UI
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send('credits-updated', {
        creditBalance: newBalance,
        hoursBalance: newBalance / perHour,
      });
    }

    return {
      success: true,
      newBalanceCredits: newBalance,
      newBalanceHours: newBalance / perHour,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
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
    win.webContents.on(
      'did-fail-load',
      (event, errorCode, errorDescription) => {
        log.error(
          `[credit-handler] Checkout window failed to load: ${errorCode} - ${errorDescription}`
        );
        win.close();
        resolve();
      }
    );

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
    log.info('[credit-handler] Attempting admin credit reset...');

    const response = await axios.post('https://api.stage5.tools/admin/reset', {
      deviceId: getDeviceId(),
      pack: 'STANDARD',
    });

    if (response.data?.success) {
      const { creditsAdded } = response.data;
      log.info(
        `[credit-handler] ✅ Admin reset successful: Added ${creditsAdded} credits`
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
      log.error(`[credit-handler] ❌ Admin reset failed: ${error}`);
      return { success: false, error };
    }
  } catch (err: any) {
    log.error('[credit-handler] ❌ Admin reset error:', err);
    return {
      success: false,
      error: err.response?.data?.error || err.message || 'Network error',
    };
  }
}

async function handleStripeSuccess(sessionId?: string | null): Promise<void> {
  if (!sessionId) return;

  try {
    log.info(`[credit-handler] Processing successful payment: ${sessionId}`);

    // Refresh the credit balance from the server
    const response = await axios.get(
      `https://api.stage5.tools/credits/${getDeviceId()}`,
      { headers: { Authorization: `Bearer ${getDeviceId()}` } }
    );

    if (
      response.data &&
      typeof response.data.creditBalance === 'number' &&
      typeof response.data.hoursBalance === 'number'
    ) {
      const { creditBalance, hoursBalance, creditsPerHour } = response.data;
      store.set('balanceCredits', creditBalance);
      store.set('creditsPerHour', creditsPerHour); // Cache the conversion rate
      log.info(
        `[credit-handler] Updated credit balance: ${creditBalance} credits (${hoursBalance} hours)`
      );

      // Notify the renderer process about the updated balance using API's hours calculation
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('credits-updated', {
          creditBalance,
          hoursBalance,
        });
      }
    }
  } catch (error) {
    log.error('[credit-handler] Error refreshing credit balance:', error);
  }
}
