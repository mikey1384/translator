import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';

interface AiStoreState {
  initialized: boolean;
  initializing: boolean;
  byoUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  entitlementsLoading: boolean;
  entitlementsError?: string;
  unlockPending: boolean;
  unlockError?: string;
  lastFetched?: string;
  // OpenAI key state
  keyValue: string;
  keyPresent: boolean;
  keyLoading: boolean;
  savingKey: boolean;
  validatingKey: boolean;
  useByo: boolean;
  // Anthropic key state
  anthropicKeyValue: string;
  anthropicKeyPresent: boolean;
  anthropicKeyLoading: boolean;
  savingAnthropicKey: boolean;
  validatingAnthropicKey: boolean;
  useByoAnthropic: boolean;
  // Actions
  initialize: () => Promise<void>;
  fetchEntitlements: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
  startUnlock: () => Promise<void>;
  // OpenAI actions
  setKeyValue: (value: string) => void;
  loadKey: () => Promise<void>;
  saveKey: () => Promise<{ success: boolean; error?: string }>;
  clearKey: () => Promise<{ success: boolean; error?: string }>;
  validateKey: () => Promise<{ ok: boolean; error?: string }>;
  syncByoToggle: () => Promise<void>;
  setUseByo: (value: boolean) => Promise<{ success: boolean; error?: string }>;
  // Anthropic actions
  setAnthropicKeyValue: (value: string) => void;
  loadAnthropicKey: () => Promise<void>;
  saveAnthropicKey: () => Promise<{ success: boolean; error?: string }>;
  clearAnthropicKey: () => Promise<{ success: boolean; error?: string }>;
  validateAnthropicKey: () => Promise<{ ok: boolean; error?: string }>;
  syncByoAnthropicToggle: () => Promise<void>;
  setUseByoAnthropic: (
    value: boolean
  ) => Promise<{ success: boolean; error?: string }>;
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
        byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
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
        byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
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
          console.error(
            '[AiStore] Failed to sync BYO toggle after key removal:',
            err
          );
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

  unsubscribers.push(
    SystemIPC.onAnthropicApiKeyChanged(async ({ hasKey }) => {
      if (!hasKey) {
        set({
          anthropicKeyPresent: false,
          anthropicKeyValue: '',
          useByoAnthropic: false,
        });
        try {
          await SystemIPC.setByoAnthropicEnabled(false);
        } catch (err) {
          console.error(
            '[AiStore] Failed to sync BYO Anthropic toggle after key removal:',
            err
          );
        }
        return;
      }
      try {
        const key = await SystemIPC.getAnthropicApiKey();
        set({
          anthropicKeyPresent: Boolean(key),
          anthropicKeyValue: key ?? '',
        });
      } catch {
        set({ anthropicKeyPresent: true });
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
    byoAnthropicUnlocked: false,
    entitlementsLoading: true,
    entitlementsError: undefined,
    unlockPending: false,
    unlockError: undefined,
    lastFetched: undefined,
    // OpenAI state
    keyValue: '',
    keyPresent: false,
    keyLoading: false,
    savingKey: false,
    validatingKey: false,
    useByo: false,
    // Anthropic state
    anthropicKeyValue: '',
    anthropicKeyPresent: false,
    anthropicKeyLoading: false,
    savingAnthropicKey: false,
    validatingAnthropicKey: false,
    useByoAnthropic: false,

    initialize: async () => {
      if (get().initialized || get().initializing) return;
      set({
        initializing: true,
        entitlementsLoading: true,
        keyLoading: true,
        anthropicKeyLoading: true,
      });
      try {
        await Promise.allSettled([
          get().fetchEntitlements(),
          get().loadKey(),
          get().syncByoToggle(),
          get().loadAnthropicKey(),
          get().syncByoAnthropicToggle(),
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
          byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
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
          byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
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
      } catch {
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
            console.error(
              '[AiStore] Failed to disable BYO toggle after key clear:',
              err
            );
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
        return {
          success: false,
          error: err?.message || 'Failed to save toggle',
        };
      }
    },

    // Anthropic actions
    setAnthropicKeyValue: (value: string) => {
      set({ anthropicKeyValue: value });
    },

    loadAnthropicKey: async () => {
      try {
        set({ anthropicKeyLoading: true });
        const key = await SystemIPC.getAnthropicApiKey();
        set({
          anthropicKeyValue: key ?? '',
          anthropicKeyPresent: Boolean(key),
          anthropicKeyLoading: false,
        });
      } catch {
        set({ anthropicKeyLoading: false, anthropicKeyPresent: false });
      }
    },

    saveAnthropicKey: async () => {
      const value = get().anthropicKeyValue;
      try {
        set({ savingAnthropicKey: true });
        const result = await SystemIPC.setAnthropicApiKey(value);
        if (result.success) {
          set({ anthropicKeyPresent: Boolean(value.trim()) });
        }
        return result;
      } finally {
        set({ savingAnthropicKey: false });
      }
    },

    clearAnthropicKey: async () => {
      try {
        set({ savingAnthropicKey: true });
        const result = await SystemIPC.clearAnthropicApiKey();
        if (result.success) {
          set({ anthropicKeyValue: '', anthropicKeyPresent: false });
          try {
            await SystemIPC.setByoAnthropicEnabled(false);
            set({ useByoAnthropic: false });
          } catch (err) {
            console.error(
              '[AiStore] Failed to disable BYO Anthropic toggle after key clear:',
              err
            );
          }
        }
        return result;
      } finally {
        set({ savingAnthropicKey: false });
      }
    },

    validateAnthropicKey: async () => {
      const value = get().anthropicKeyValue.trim();
      try {
        set({ validatingAnthropicKey: true });
        const result = await SystemIPC.validateAnthropicApiKey(
          value || undefined
        );
        return result;
      } finally {
        set({ validatingAnthropicKey: false });
      }
    },

    syncByoAnthropicToggle: async () => {
      try {
        const enabled = await SystemIPC.getByoAnthropicEnabled();
        set({ useByoAnthropic: Boolean(enabled) });
      } catch (err) {
        console.error('[AiStore] Failed to sync BYO Anthropic toggle:', err);
      }
    },

    setUseByoAnthropic: async (value: boolean) => {
      try {
        const result = await SystemIPC.setByoAnthropicEnabled(value);
        if (result.success) {
          set({ useByoAnthropic: Boolean(value) });
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update BYO Anthropic toggle:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save toggle',
        };
      }
    },
  };
});
