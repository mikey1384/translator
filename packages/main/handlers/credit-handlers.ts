import type {
  CreditBalanceResult,
  PurchaseCreditsOptions,
  PurchaseCreditsResult,
} from '@shared-types/app';
import Store from 'electron-store';
import { dialog } from 'electron';
import axios from 'axios'; // Assuming axios is available
import log from 'electron-log'; // Assuming electron-log is correctly configured
import { getApiKey } from '../services/secure-store.js';

// Stub for device ID - replace with actual implementation
function getDeviceId(): string {
  // In a real app, this might read a UUID from a file, use a hardware ID,
  // or a an ID associated with a user license/account.
  // For now, a placeholder:
  const deviceIdStore = new Store<{ deviceId?: string }>({
    name: 'device-config',
  });
  let id = deviceIdStore.get('deviceId');
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    deviceIdStore.set('deviceId', id);
  }
  return id;
}

const store = new Store<{ balanceHours: number }>({
  name: 'credit-balance',
  defaults: { balanceHours: 0 }, // This local store might become a cache
});

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  try {
    // TODO: Replace with your real backend URL + auth
    // const response = await axios.get('https://api.example.com/credits/balance', {
    //   headers: { Authorization: `Bearer ${getAuthToken()}` }, // Assuming getAuthToken() exists
    // });
    // const balanceFromBackend = response.data.balanceHours;
    // store.set('balanceHours', balanceFromBackend); // Update cache
    // return {
    //   success: true,
    //   balanceHours: balanceFromBackend,
    //   updatedAt: new Date().toISOString(),
    // };

    // For now, returning stubbed local value but logging intent to change
    log.info(
      '[credit-handler] handleGetCreditBalance: Currently returning local cache. TODO: Implement backend call.'
    );
    const bal = store.get('balanceHours', 0);
    return {
      success: true,
      balanceHours: bal,
      updatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    log.error('[credit-handler] handleGetCreditBalance error:', err);
    // Attempt to return cached value on error
    const cachedBal = store.get('balanceHours', 0);
    return {
      success: false,
      error: err.message,
      balanceHours: cachedBal, // Optionally return cached value
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

  const newBal = store.get('balanceHours', 0) + add;
  store.set('balanceHours', newBal);
  log.info(
    `[credit-handler] DEV: Added ${add} fake credits. New balance: ${newBal}`
  );
  return { success: true, newBalanceHours: newBal };
}

export async function handleCreateCheckoutSession(
  _evt: Electron.IpcMainInvokeEvent,
  packId: 'HOUR_1' | 'HOUR_5' | 'HOUR_10'
): Promise<string | null> {
  try {
    // TODO: Replace with your real backend URL + auth strategy
    const apiUrl = 'https://api.example.com/payments/create-session';
    log.info(
      `[credit-handler] Creating checkout session for ${packId} via ${apiUrl}`
    );
    const response = await axios.post(
      apiUrl,
      { packId, deviceId: getDeviceId() } // Send packId and deviceId
      // { headers: { Authorization: `Bearer ${getAuthToken()}` } } // Assuming getAuthToken() for real auth
    );

    // Expecting backend to respond with { url: 'https://checkout.stripe.com/…' }
    if (response.data && response.data.url) {
      log.info(
        `[credit-handler] Checkout session URL received: ${response.data.url}`
      );
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
    const currentBalance = store.get('balanceHours', 0);
    const newBalance = currentBalance + hours;
    store.set('balanceHours', newBalance);
    return { success: true, newBalanceHours: newBalance };
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
    const currentBalance = store.get('balanceHours', 0);
    if (currentBalance < hours) {
      return { success: false, error: 'Insufficient credits' }; // Or a more specific error message
    }
    const newBalance = currentBalance - hours;
    store.set('balanceHours', newBalance);
    // Consider logging the reservation transaction here if needed in the future
    return { success: true, newBalanceHours: newBalance };
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
