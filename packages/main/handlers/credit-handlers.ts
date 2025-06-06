import type {
  CreditBalanceResult,
  PurchaseCreditsOptions,
  PurchaseCreditsResult,
} from '@shared-types/app';
import Store from 'electron-store';
import { dialog, BrowserWindow } from 'electron';
import axios from 'axios'; // Assuming axios is available
import log from 'electron-log'; // Assuming electron-log is correctly configured
import { getApiKey } from '../services/secure-store.js';
import { v4 as uuidv4 } from 'uuid';

// Generate or retrieve device ID using proper UUID v4
function getDeviceId(): string {
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

const store = new Store<{ balanceCredits: number }>({
  name: 'credit-balance',
  defaults: { balanceCredits: 0 }, // This local store is a cache for raw credits
});

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  try {
    // Get credit balance from the API
    const response = await axios.get(
      `https://api.stage5.tools/credits/${getDeviceId()}`,
      { headers: { Authorization: `Bearer ${getDeviceId()}` } }
    );

    if (response.data && typeof response.data.creditBalance === 'number') {
      const balanceFromBackend = response.data.creditBalance;
      store.set('balanceCredits', balanceFromBackend); // Update cache
      return {
        success: true,
        balanceHours: balanceFromBackend / 50000, // Convert credits to hours for display
        updatedAt: new Date().toISOString(),
      };
    } else {
      throw new Error('Invalid response format from credit balance API');
    }
  } catch (err: any) {
    log.error('[credit-handler] handleGetCreditBalance error:', err);
    // Attempt to return cached value on error
    const cachedBal = store.get('balanceCredits', 0);
    return {
      success: false,
      error: err.message,
      balanceHours: cachedBal / 50000, // Convert cached credits to hours for display
      updatedAt: new Date().toISOString(),
    };
  }
}

// Renamed from handlePurchaseCredits
export async function handleDevFakePurchaseCredits(
  // _evt: Electron.IpcMainInvokeEvent, // evt not used
  opts: PurchaseCreditsOptions
): Promise<PurchaseCreditsResult> {
  const hoursForPack: Record<string, number> = {
    HOUR_1: 1,
    HOUR_5: 5,
    HOUR_10: 10,
  };
  const add = hoursForPack[opts.packageId] ?? 0;
  if (!add) return { success: false, error: 'Unknown package' };

  const confirmed = dialog.showMessageBoxSync({
    type: 'question',
    message: `DEV MODE: Pretend payment for ${add} hour(s)?`,
    buttons: ['Cancel', 'Pay'],
    cancelId: 0,
  });
  if (confirmed === 0) return { success: false, error: 'Cancelled' };

  const addCredits = add * 50000; // Convert hours to credits
  const newBal = store.get('balanceCredits', 0) + addCredits;
  store.set('balanceCredits', newBal);
  log.info(
    `[credit-handler] DEV: Added ${add} fake credits. New balance: ${newBal}`
  );
  return { success: true, newBalanceHours: newBal };
}

export async function handleCreateCheckoutSession(
  _evt: Electron.IpcMainInvokeEvent,
  packId: 'HOUR_5' // ← only one pack supported for now
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
    if (response.data && response.data.url) {
      log.info(
        `[credit-handler] Checkout session URL received: ${response.data.url}`
      );

      // Open checkout in BrowserWindow instead of external browser
      await openStripeCheckout(response.data.url);
      return response.data.url;
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
): Promise<{ success: boolean; newBalanceHours?: number; error?: string }> {
  try {
    if (typeof hours !== 'number' || hours <= 0) {
      return { success: false, error: 'Invalid hours to refund' };
    }
    const creditsToRefund = hours * 50000; // Convert hours to credits
    const currentBalance = store.get('balanceCredits', 0);
    const newBalance = currentBalance + creditsToRefund;
    store.set('balanceCredits', newBalance);
    return { success: true, newBalanceHours: newBalance / 50000 }; // Convert back to hours for response
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function handleReserveCredits(
  _evt: Electron.IpcMainInvokeEvent,
  hours: number
): Promise<{ success: boolean; newBalanceHours?: number; error?: string }> {
  try {
    if (typeof hours !== 'number' || hours <= 0) {
      return { success: false, error: 'Invalid hours to reserve' };
    }
    const creditsToReserve = hours * 50000; // Convert hours to credits
    const currentBalance = store.get('balanceCredits', 0);
    if (currentBalance < creditsToReserve) {
      return { success: false, error: 'Insufficient credits' };
    }
    const newBalance = currentBalance - creditsToReserve;
    store.set('balanceCredits', newBalance);
    return { success: true, newBalanceHours: newBalance / 50000 }; // Convert back to hours for response
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function handleHasOpenAIKey(): Promise<boolean> {
  try {
    // Check secure store first
    const apiKey = await getApiKey('openai');
    if (apiKey !== null && apiKey.trim().length > 0) {
      return true;
    }

    // Check environment variable as fallback
    const envApiKey = process.env.OPENAI_API_KEY;
    if (envApiKey && envApiKey.trim().length > 0) {
      return true;
    }

    return false;
  } catch (err: any) {
    log.error('[credit-handler] handleHasOpenAIKey error:', err);
    return false;
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

    // 1️⃣ Intercept navigation inside the child window
    win.webContents.on('will-redirect', (event, url) => {
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
    });

    win.on('closed', () => {
      resolve();
    });
  });
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

    if (response.data && typeof response.data.creditBalance === 'number') {
      const newBalance = response.data.creditBalance;
      store.set('balanceCredits', newBalance);
      log.info(
        `[credit-handler] Updated credit balance: ${newBalance} credits`
      );

      // Notify the renderer process about the updated balance (convert to hours for UI)
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.webContents.send('credits-updated', newBalance / 50000);
      }
    }
  } catch (error) {
    log.error('[credit-handler] Error refreshing credit balance:', error);
  }
}
