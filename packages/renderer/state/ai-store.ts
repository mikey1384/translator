import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';

interface AiStoreState {
  initialized: boolean;
  initializing: boolean;
  byoUnlocked: boolean;
  entitlementsLoading: boolean;
  entitlementsError?: string;
  unlockPending: boolean;
  unlockError?: string;
  lastFetched?: string;
  keyValue: string;
  keyPresent: boolean;
  keyLoading: boolean;
  savingKey: boolean;
  validatingKey: boolean;
  useByo: boolean;
  initialize: () => Promise<void>;
  fetchEntitlements: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
  startUnlock: () => Promise<void>;
  setKeyValue: (value: string) => void;
  loadKey: () => Promise<void>;
  saveKey: () => Promise<{ success: boolean; error?: string }>;
  clearKey: () => Promise<{ success: boolean; error?: string }>;
  validateKey: () => Promise<{ ok: boolean; error?: string }>;
  syncByoToggle: () => Promise<void>;
  setUseByo: (value: boolean) => Promise<{ success: boolean; error?: string }>;
}

const unsubscribers: Array<() => void> = [];

function ensureSubscriptions(
  set: (partial: Partial<AiStoreState>) => void,
  get: () => AiStoreState
) {
  if (unsubscribers.length > 0) return;

  unsubscribers.push(
    SystemIPC.onEntitlementsUpdated(snapshot => {
      set({
        byoUnlocked: Boolean(snapshot?.byoOpenAi),
        entitlementsLoading: false,
        entitlementsError: undefined,
        unlockPending: false,
        lastFetched: snapshot?.fetchedAt,
      });
    })
  );

  unsubscribers.push(
    SystemIPC.onEntitlementsError(payload => {
      set({
        entitlementsError: payload?.message || 'Failed to load entitlements',
        entitlementsLoading: false,
        unlockPending: false,
      });
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockPending(() => {
      set({ unlockPending: true, unlockError: undefined });
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockConfirmed(snapshot => {
      set({
        unlockPending: false,
        unlockError: undefined,
        byoUnlocked: Boolean(snapshot?.byoOpenAi),
        entitlementsLoading: false,
        entitlementsError: undefined,
        lastFetched: snapshot?.fetchedAt,
      });
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockCancelled(() => {
      if (get().unlockPending) {
        set({ unlockPending: false });
      }
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockError(payload => {
      set({
        unlockPending: false,
        unlockError: payload?.message || 'Unlock failed',
      });
    })
  );

  unsubscribers.push(
    SystemIPC.onOpenAiApiKeyChanged(async ({ hasKey }) => {
      if (!hasKey) {
        set({ keyPresent: false, keyValue: '', useByo: false });
        try {
          await SystemIPC.setByoProviderEnabled(false);
        } catch (err) {
          console.error('[AiStore] Failed to sync BYO toggle after key removal:', err);
        }
        return;
      }
      try {
        const key = await SystemIPC.getOpenAiApiKey();
        set({ keyPresent: Boolean(key), keyValue: key ?? '' });
      } catch {
        set({ keyPresent: true });
      }
    })
  );
}

export const useAiStore = create<AiStoreState>((set, get) => {
  ensureSubscriptions(
    partial => set(partial as Partial<AiStoreState>),
    () => get()
  );

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      while (unsubscribers.length) {
        const unsub = unsubscribers.pop();
        try {
          unsub?.();
        } catch {
          // ignore
        }
      }
    });
  }

  return {
    initialized: false,
    initializing: false,
    byoUnlocked: false,
    entitlementsLoading: true,
    entitlementsError: undefined,
    unlockPending: false,
    unlockError: undefined,
    lastFetched: undefined,
    keyValue: '',
    keyPresent: false,
    keyLoading: false,
    savingKey: false,
    validatingKey: false,
    useByo: false,

    initialize: async () => {
      if (get().initialized || get().initializing) return;
      set({ initializing: true, entitlementsLoading: true, keyLoading: true });
      try {
        await Promise.allSettled([
          get().fetchEntitlements(),
          get().loadKey(),
          get().syncByoToggle(),
        ]);
      } finally {
        set({ initialized: true, initializing: false });
      }
    },

    fetchEntitlements: async () => {
      try {
        set({ entitlementsLoading: true, entitlementsError: undefined });
        const snapshot = await SystemIPC.getEntitlements();
        set({
          byoUnlocked: Boolean(snapshot?.byoOpenAi),
          entitlementsLoading: false,
          entitlementsError: undefined,
          lastFetched: snapshot?.fetchedAt,
        });
      } catch (err: any) {
        set({
          entitlementsLoading: false,
          entitlementsError: err?.message || 'Failed to load entitlements',
        });
      }
    },

    refreshEntitlements: async () => {
      try {
        set({ entitlementsLoading: true, entitlementsError: undefined });
        const snapshot = await SystemIPC.refreshEntitlements();
        set({
          byoUnlocked: Boolean(snapshot?.byoOpenAi),
          entitlementsLoading: false,
          entitlementsError: undefined,
          lastFetched: snapshot?.fetchedAt,
        });
      } catch (err: any) {
        set({
          entitlementsLoading: false,
          entitlementsError: err?.message || 'Failed to refresh entitlements',
        });
      }
    },

    startUnlock: async () => {
      set({ unlockPending: true, unlockError: undefined });
      try {
        await SystemIPC.createByoUnlockSession();
      } catch (err: any) {
        set({
          unlockPending: false,
          unlockError: err?.message || 'Unable to start checkout',
        });
      }
    },

    setKeyValue: (value: string) => {
      set({ keyValue: value });
    },

    loadKey: async () => {
      try {
        set({ keyLoading: true });
        const key = await SystemIPC.getOpenAiApiKey();
        set({
          keyValue: key ?? '',
          keyPresent: Boolean(key),
          keyLoading: false,
        });
      } catch (_err: any) {
        set({ keyLoading: false, keyPresent: false });
      }
    },

    saveKey: async () => {
      const value = get().keyValue;
      try {
        set({ savingKey: true });
        const result = await SystemIPC.setOpenAiApiKey(value);
        if (result.success) {
          set({ keyPresent: Boolean(value.trim()) });
        }
        return result;
      } finally {
        set({ savingKey: false });
      }
    },

    clearKey: async () => {
      try {
        set({ savingKey: true });
        const result = await SystemIPC.clearOpenAiApiKey();
        if (result.success) {
          set({ keyValue: '', keyPresent: false });
          try {
            await SystemIPC.setByoProviderEnabled(false);
            set({ useByo: false });
          } catch (err) {
            console.error('[AiStore] Failed to disable BYO toggle after key clear:', err);
          }
        }
        return result;
      } finally {
        set({ savingKey: false });
      }
    },

    validateKey: async () => {
      const value = get().keyValue.trim();
      try {
        set({ validatingKey: true });
        const result = await SystemIPC.validateOpenAiApiKey(value || undefined);
        return result;
      } finally {
        set({ validatingKey: false });
      }
    },

    syncByoToggle: async () => {
      try {
        const enabled = await SystemIPC.getByoProviderEnabled();
        set({ useByo: Boolean(enabled) });
      } catch (err) {
        console.error('[AiStore] Failed to sync BYO toggle:', err);
      }
    },

    setUseByo: async (value: boolean) => {
      try {
        const result = await SystemIPC.setByoProviderEnabled(value);
        if (result.success) {
          set({ useByo: Boolean(value) });
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update BYO toggle:', err);
        return { success: false, error: err?.message || 'Failed to save toggle' };
      }
    },
  };
});
