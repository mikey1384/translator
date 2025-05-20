import type {
  CreditBalanceResult,
  PurchaseCreditsOptions,
  PurchaseCreditsResult,
} from '@shared-types/app';
import Store from 'electron-store';
import { dialog } from 'electron';

const store = new Store<{ balanceHours: number }>({
  name: 'credit-balance',
  defaults: { balanceHours: 0 },
});

export async function handleGetCreditBalance(): Promise<CreditBalanceResult> {
  try {
    const bal = store.get('balanceHours', 0);
    return {
      success: true,
      balanceHours: bal,
      updatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// super-naïve "purchase" placeholder
export async function handlePurchaseCredits(
  _evt: Electron.IpcMainInvokeEvent,
  opts: PurchaseCreditsOptions
): Promise<PurchaseCreditsResult> {
  const hoursForPack: Record<string, number> = {
    HOUR_1: 1,
    HOUR_5: 5,
    HOUR_10: 10,
  };
  const add = hoursForPack[opts.packageId] ?? 0;
  if (!add) return { success: false, error: 'Unknown package' };

  // <-- here you'd normally kick off Stripe/PayPal flow instead
  const confirmed = dialog.showMessageBoxSync({
    type: 'question',
    message: `Pretend payment for ${add} hour(s)?`,
    buttons: ['Cancel', 'Pay'],
    cancelId: 0,
  });
  if (confirmed === 0) return { success: false, error: 'Cancelled' };

  const newBal = store.get('balanceHours', 0) + add;
  store.set('balanceHours', newBal);
  return { success: true, newBalanceHours: newBal };
}

export async function handleSpendCredits(
  _evt: Electron.IpcMainInvokeEvent,
  hours: number
): Promise<{ success: boolean; newBalanceHours?: number; error?: string }> {
  try {
    if (typeof hours !== 'number' || hours <= 0) {
      return { success: false, error: 'Invalid hours to spend' };
    }
    const currentBalance = store.get('balanceHours', 0);
    // It's okay if this goes below zero temporarily, optimistic UI handles Math.max(0, ...)
    // but the actual store should reflect the attempt accurately or clamp as well.
    // Clamping here to prevent negative balance in the store.
    const newBalance = Math.max(0, currentBalance - hours);
    store.set('balanceHours', newBalance);
    return { success: true, newBalanceHours: newBalance };
  } catch (err: any) {
    return { success: false, error: err.message };
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
