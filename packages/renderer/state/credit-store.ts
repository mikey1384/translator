import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import type { PurchaseCreditsOptions } from '@shared-types/app';

interface CreditState {
  balance: number | null;
  loading: boolean;
  error?: string;
  refresh: () => Promise<void>;
  buy: (pkg: PurchaseCreditsOptions['packageId']) => Promise<void>;
}

export const useCreditStore = create<CreditState>(set => ({
  balance: null,
  loading: true,
  error: undefined,
  refresh: async () => {
    set({ loading: true });
    const res = await SystemIPC.getCreditBalance();
    set({
      balance: res.success ? (res.balanceHours ?? 0) : null,
      loading: false,
      error: res.error,
    });
  },
  buy: async pkg => {
    set({ loading: true }); // Optional: set loading true before purchase
    const res = await SystemIPC.purchaseCredits({ packageId: pkg });
    if (res.success) {
      set({ balance: res.newBalanceHours, error: undefined, loading: false });
    } else {
      set({ error: res.error, loading: false });
    }
  },
}));

useCreditStore.getState().refresh(); // kick off once on module import
