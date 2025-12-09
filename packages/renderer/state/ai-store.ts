import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import { openApiKeysRequired } from './modal-store';

/**
 * Simple mutex to prevent race conditions in cascading state updates.
 * Used by checkAndDisableMasterIfNeeded to ensure only one check runs at a time.
 */
let masterToggleCheckInProgress = false;

/**
 * Check if user has a valid BYO provider combination.
 * Valid combos:
 * 1. OpenAI key present and enabled
 * 2. Both Anthropic AND ElevenLabs keys present and enabled
 */
function hasValidByoCombo(state: {
  keyPresent: boolean;
  useByo: boolean;
  anthropicKeyPresent: boolean;
  useByoAnthropic: boolean;
  elevenLabsKeyPresent: boolean;
  useByoElevenLabs: boolean;
}): boolean {
  const hasOpenAi = state.keyPresent && state.useByo;
  const hasAnthropicAndElevenLabs =
    state.anthropicKeyPresent &&
    state.useByoAnthropic &&
    state.elevenLabsKeyPresent &&
    state.useByoElevenLabs;
  return hasOpenAi || hasAnthropicAndElevenLabs;
}

/**
 * Check and disable master toggle if no valid BYO combo exists.
 * Shows modal to inform user they need to enter API keys.
 * Uses mutex to prevent race conditions from rapid key operations.
 */
async function checkAndDisableMasterIfNeeded(
  get: () => AiStoreState,
  set: (partial: Partial<AiStoreState>) => void
): Promise<void> {
  // Mutex: skip if another check is already in progress
  if (masterToggleCheckInProgress) return;
  // Set flag immediately to prevent race conditions
  masterToggleCheckInProgress = true;

  try {
    const state = get();
    if (!state.useByoMaster) return;

    if (!hasValidByoCombo(state)) {
      await SystemIPC.setByoMasterEnabled(false);
      set({ useByoMaster: false });
      openApiKeysRequired();
    }
  } catch (err) {
    console.error('[AiStore] Failed to disable master toggle:', err);
  } finally {
    masterToggleCheckInProgress = false;
  }
}

interface AiStoreState {
  initialized: boolean;
  initializing: boolean;
  encryptionAvailable: boolean; // Whether OS-level encryption is available for API keys
  byoUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  // Admin preview mode: when true, pretend BYO is not unlocked (for UI testing)
  adminByoPreviewMode: boolean;
  entitlementsLoading: boolean;
  entitlementsError?: string;
  unlockPending: boolean;
  unlockError?: string;
  lastFetched?: string;
  // Master BYO toggle (overrides individual toggles when off)
  useByoMaster: boolean;
  // Claude translation preference (use Sonnet for draft instead of GPT)
  preferClaudeTranslation: boolean;
  // Claude review preference (use Opus for review instead of GPT with high reasoning)
  preferClaudeReview: boolean;
  // Claude summary preference (use Opus for summary instead of GPT)
  preferClaudeSummary: boolean;
  // Transcription provider preference
  preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5';
  // Dubbing provider preference
  preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5';
  // Stage5 dubbing TTS provider (when using Stage5 API for dubbing)
  // 'openai' = cheaper ($15/1M chars), 'elevenlabs' = premium quality ($200/1M chars)
  stage5DubbingTtsProvider: 'openai' | 'elevenlabs';
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
  // ElevenLabs key state
  elevenLabsKeyValue: string;
  elevenLabsKeyPresent: boolean;
  elevenLabsKeyLoading: boolean;
  savingElevenLabsKey: boolean;
  validatingElevenLabsKey: boolean;
  useByoElevenLabs: boolean;
  // Actions
  initialize: () => Promise<void>;
  fetchEntitlements: () => Promise<void>;
  refreshEntitlements: () => Promise<void>;
  startUnlock: () => Promise<void>;
  // Admin preview mode action
  setAdminByoPreviewMode: (value: boolean) => void;
  // Master toggle actions
  syncByoMasterToggle: () => Promise<void>;
  setUseByoMaster: (
    value: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  // Claude translation preference actions
  syncClaudePreference: () => Promise<void>;
  setPreferClaudeTranslation: (
    value: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  // Claude review preference actions
  syncClaudeReviewPreference: () => Promise<void>;
  setPreferClaudeReview: (
    value: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  // Claude summary preference actions
  syncClaudeSummaryPreference: () => Promise<void>;
  setPreferClaudeSummary: (
    value: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  // Transcription provider preference actions
  syncTranscriptionPreference: () => Promise<void>;
  setPreferredTranscriptionProvider: (
    value: 'elevenlabs' | 'openai' | 'stage5'
  ) => Promise<{ success: boolean; error?: string }>;
  // Dubbing provider preference actions
  syncDubbingPreference: () => Promise<void>;
  setPreferredDubbingProvider: (
    value: 'elevenlabs' | 'openai' | 'stage5'
  ) => Promise<{ success: boolean; error?: string }>;
  // Stage5 dubbing TTS provider actions
  syncStage5DubbingTtsProvider: () => Promise<void>;
  setStage5DubbingTtsProvider: (
    value: 'openai' | 'elevenlabs'
  ) => Promise<{ success: boolean; error?: string }>;
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
  // ElevenLabs actions
  setElevenLabsKeyValue: (value: string) => void;
  loadElevenLabsKey: () => Promise<void>;
  saveElevenLabsKey: () => Promise<{ success: boolean; error?: string }>;
  clearElevenLabsKey: () => Promise<{ success: boolean; error?: string }>;
  validateElevenLabsKey: () => Promise<{ ok: boolean; error?: string }>;
  syncByoElevenLabsToggle: () => Promise<void>;
  setUseByoElevenLabs: (
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
        byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
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
        byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
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

  unsubscribers.push(
    SystemIPC.onElevenLabsApiKeyChanged(async ({ hasKey }) => {
      if (!hasKey) {
        set({
          elevenLabsKeyPresent: false,
          elevenLabsKeyValue: '',
          useByoElevenLabs: false,
        });
        try {
          await SystemIPC.setByoElevenLabsEnabled(false);
        } catch (err) {
          console.error(
            '[AiStore] Failed to sync BYO ElevenLabs toggle after key removal:',
            err
          );
        }
        return;
      }
      try {
        const key = await SystemIPC.getElevenLabsApiKey();
        set({
          elevenLabsKeyPresent: Boolean(key),
          elevenLabsKeyValue: key ?? '',
        });
      } catch {
        set({ elevenLabsKeyPresent: true });
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
    encryptionAvailable: true, // Assume true until checked
    byoUnlocked: false,
    byoAnthropicUnlocked: false,
    byoElevenLabsUnlocked: false,
    adminByoPreviewMode: false,
    entitlementsLoading: true,
    entitlementsError: undefined,
    unlockPending: false,
    unlockError: undefined,
    lastFetched: undefined,
    // Master toggle (defaults to false - user must explicitly enable)
    useByoMaster: false,
    // Claude translation preference (defaults to false - use GPT which is cheaper)
    preferClaudeTranslation: false,
    // Claude review preference (defaults to true - use Claude Opus for higher quality)
    preferClaudeReview: true,
    // Claude summary preference (defaults to true - use Claude Opus for higher quality)
    preferClaudeSummary: true,
    // Transcription provider preference (defaults to ElevenLabs for highest quality)
    preferredTranscriptionProvider: 'elevenlabs',
    // Dubbing provider preference (defaults to OpenAI TTS for cost efficiency)
    preferredDubbingProvider: 'openai',
    // Stage5 dubbing TTS provider (defaults to OpenAI for cost efficiency)
    stage5DubbingTtsProvider: 'openai',
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
    // ElevenLabs state
    elevenLabsKeyValue: '',
    elevenLabsKeyPresent: false,
    elevenLabsKeyLoading: false,
    savingElevenLabsKey: false,
    validatingElevenLabsKey: false,
    useByoElevenLabs: false,

    initialize: async () => {
      if (get().initialized || get().initializing) return;
      set({
        initializing: true,
        entitlementsLoading: true,
        keyLoading: true,
        anthropicKeyLoading: true,
        elevenLabsKeyLoading: true,
      });
      try {
        // Load entitlements and BYO settings in parallel
        // NOTE: We do NOT check encryption availability here to avoid Keychain prompt on startup.
        // Encryption is checked lazily only when user tries to save a key.
        const [, settingsResult] = await Promise.allSettled([
          get().fetchEntitlements(),
          SystemIPC.getAllByoSettings(),
        ]);

        // Assume encryption is available by default (it is on all modern systems)
        // Will be updated to false if saving a key fails due to encryption unavailability
        set({ encryptionAvailable: true });

        // Apply all BYO settings from the batched call
        // NOTE: API keys are NOT decrypted on startup to avoid Keychain prompts.
        // Only presence flags are checked. Keys are decrypted lazily when needed.
        if (settingsResult.status === 'fulfilled') {
          const settings = settingsResult.value;
          set({
            // API key presence (NOT the actual values - avoids Keychain prompt)
            // keyValue stays empty until user explicitly views/edits their key
            keyValue: '',
            keyPresent: settings.openAiKeyPresent,
            keyLoading: false,
            anthropicKeyValue: '',
            anthropicKeyPresent: settings.anthropicKeyPresent,
            anthropicKeyLoading: false,
            elevenLabsKeyValue: '',
            elevenLabsKeyPresent: settings.elevenLabsKeyPresent,
            elevenLabsKeyLoading: false,
            // Individual toggles
            useByo: settings.useByoOpenAi,
            useByoAnthropic: settings.useByoAnthropic,
            useByoElevenLabs: settings.useByoElevenLabs,
            // Master toggle
            useByoMaster: settings.useByoMaster,
            // Claude preferences
            preferClaudeTranslation: settings.preferClaudeTranslation,
            preferClaudeReview: settings.preferClaudeReview,
            preferClaudeSummary: settings.preferClaudeSummary,
            // Provider preferences
            preferredTranscriptionProvider:
              settings.preferredTranscriptionProvider,
            preferredDubbingProvider: settings.preferredDubbingProvider,
            stage5DubbingTtsProvider: settings.stage5DubbingTtsProvider,
          });

          // If master toggle is ON but no valid keys exist (e.g., keys were cleared
          // during migration), auto-disable master toggle so user sees Stage5 UI
          if (settings.useByoMaster) {
            const hasValidCombo = hasValidByoCombo({
              keyPresent: settings.openAiKeyPresent,
              useByo: settings.useByoOpenAi,
              anthropicKeyPresent: settings.anthropicKeyPresent,
              useByoAnthropic: settings.useByoAnthropic,
              elevenLabsKeyPresent: settings.elevenLabsKeyPresent,
              useByoElevenLabs: settings.useByoElevenLabs,
            });
            if (!hasValidCombo) {
              // Silently disable master toggle - user will see Stage5 credit UI
              try {
                await SystemIPC.setByoMasterEnabled(false);
                set({ useByoMaster: false });
              } catch (err) {
                console.error(
                  '[AiStore] Failed to auto-disable master toggle:',
                  err
                );
              }
            }
          }
        } else {
          // Fallback: if batched call fails, reset loading states
          set({
            keyLoading: false,
            anthropicKeyLoading: false,
            elevenLabsKeyLoading: false,
          });
          console.error(
            '[AiStore] Failed to load BYO settings:',
            settingsResult.reason
          );
        }
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
          byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
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
          byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
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

    setAdminByoPreviewMode: (value: boolean) => {
      set({ adminByoPreviewMode: value });
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
          await checkAndDisableMasterIfNeeded(get, set);
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
          // When turning OFF, check if valid combo still exists
          if (!value) {
            await checkAndDisableMasterIfNeeded(get, set);
          }
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
          await checkAndDisableMasterIfNeeded(get, set);
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
          // When turning OFF, check if valid combo still exists
          if (!value) {
            await checkAndDisableMasterIfNeeded(get, set);
          }
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

    // ElevenLabs actions
    setElevenLabsKeyValue: (value: string) => {
      set({ elevenLabsKeyValue: value });
    },

    loadElevenLabsKey: async () => {
      try {
        set({ elevenLabsKeyLoading: true });
        const key = await SystemIPC.getElevenLabsApiKey();
        set({
          elevenLabsKeyValue: key ?? '',
          elevenLabsKeyPresent: Boolean(key),
          elevenLabsKeyLoading: false,
        });
      } catch {
        set({ elevenLabsKeyLoading: false, elevenLabsKeyPresent: false });
      }
    },

    saveElevenLabsKey: async () => {
      const value = get().elevenLabsKeyValue;
      try {
        set({ savingElevenLabsKey: true });
        const result = await SystemIPC.setElevenLabsApiKey(value);
        if (result.success) {
          set({ elevenLabsKeyPresent: Boolean(value.trim()) });
        }
        return result;
      } finally {
        set({ savingElevenLabsKey: false });
      }
    },

    clearElevenLabsKey: async () => {
      try {
        set({ savingElevenLabsKey: true });
        const result = await SystemIPC.clearElevenLabsApiKey();
        if (result.success) {
          set({ elevenLabsKeyValue: '', elevenLabsKeyPresent: false });
          try {
            await SystemIPC.setByoElevenLabsEnabled(false);
            set({ useByoElevenLabs: false });
          } catch (err) {
            console.error(
              '[AiStore] Failed to disable BYO ElevenLabs toggle after key clear:',
              err
            );
          }
          await checkAndDisableMasterIfNeeded(get, set);
        }
        return result;
      } finally {
        set({ savingElevenLabsKey: false });
      }
    },

    validateElevenLabsKey: async () => {
      const value = get().elevenLabsKeyValue.trim();
      try {
        set({ validatingElevenLabsKey: true });
        const result = await SystemIPC.validateElevenLabsApiKey(
          value || undefined
        );
        return result;
      } finally {
        set({ validatingElevenLabsKey: false });
      }
    },

    syncByoElevenLabsToggle: async () => {
      try {
        const enabled = await SystemIPC.getByoElevenLabsEnabled();
        set({ useByoElevenLabs: Boolean(enabled) });
      } catch (err) {
        console.error('[AiStore] Failed to sync BYO ElevenLabs toggle:', err);
      }
    },

    setUseByoElevenLabs: async (value: boolean) => {
      try {
        const result = await SystemIPC.setByoElevenLabsEnabled(value);
        if (result.success) {
          set({ useByoElevenLabs: Boolean(value) });
          // When turning OFF, check if valid combo still exists
          if (!value) {
            await checkAndDisableMasterIfNeeded(get, set);
          }
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update BYO ElevenLabs toggle:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save toggle',
        };
      }
    },

    // Master BYO toggle actions
    syncByoMasterToggle: async () => {
      try {
        const enabled = await SystemIPC.getByoMasterEnabled();
        set({ useByoMaster: Boolean(enabled) });
      } catch (err) {
        console.error('[AiStore] Failed to sync BYO master toggle:', err);
      }
    },

    setUseByoMaster: async (value: boolean) => {
      try {
        const result = await SystemIPC.setByoMasterEnabled(value);
        if (result.success) {
          set({ useByoMaster: Boolean(value) });

          // When turning ON, auto-enable all providers that have keys
          if (value) {
            const state = get();
            if (state.keyPresent) {
              try {
                await SystemIPC.setByoProviderEnabled(true);
                set({ useByo: true });
              } catch (err) {
                console.error('[AiStore] Failed to auto-enable OpenAI:', err);
              }
            }
            if (state.anthropicKeyPresent) {
              try {
                await SystemIPC.setByoAnthropicEnabled(true);
                set({ useByoAnthropic: true });
              } catch (err) {
                console.error(
                  '[AiStore] Failed to auto-enable Anthropic:',
                  err
                );
              }
            }
            if (state.elevenLabsKeyPresent) {
              try {
                await SystemIPC.setByoElevenLabsEnabled(true);
                set({ useByoElevenLabs: true });
              } catch (err) {
                console.error(
                  '[AiStore] Failed to auto-enable ElevenLabs:',
                  err
                );
              }
            }
          }
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update BYO master toggle:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save toggle',
        };
      }
    },

    // Claude translation preference actions
    syncClaudePreference: async () => {
      try {
        const prefer = await SystemIPC.getPreferClaudeTranslation();
        set({ preferClaudeTranslation: Boolean(prefer) });
      } catch (err) {
        console.error('[AiStore] Failed to sync Claude preference:', err);
      }
    },

    setPreferClaudeTranslation: async (value: boolean) => {
      try {
        const result = await SystemIPC.setPreferClaudeTranslation(value);
        if (result.success) {
          set({ preferClaudeTranslation: Boolean(value) });
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update Claude preference:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Claude review preference actions
    syncClaudeReviewPreference: async () => {
      try {
        const prefer = await SystemIPC.getPreferClaudeReview();
        set({ preferClaudeReview: Boolean(prefer) });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync Claude review preference:',
          err
        );
      }
    },

    setPreferClaudeReview: async (value: boolean) => {
      try {
        const result = await SystemIPC.setPreferClaudeReview(value);
        if (result.success) {
          set({ preferClaudeReview: Boolean(value) });
        }
        return result;
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update Claude review preference:',
          err
        );
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Claude summary preference actions
    syncClaudeSummaryPreference: async () => {
      try {
        const prefer = await SystemIPC.getPreferClaudeSummary();
        set({ preferClaudeSummary: Boolean(prefer) });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync Claude summary preference:',
          err
        );
      }
    },

    setPreferClaudeSummary: async (value: boolean) => {
      try {
        const result = await SystemIPC.setPreferClaudeSummary(value);
        if (result.success) {
          set({ preferClaudeSummary: Boolean(value) });
        }
        return result;
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update Claude summary preference:',
          err
        );
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Transcription provider preference actions
    syncTranscriptionPreference: async () => {
      try {
        const provider = await SystemIPC.getPreferredTranscriptionProvider();
        set({ preferredTranscriptionProvider: provider });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync transcription preference:',
          err
        );
      }
    },

    setPreferredTranscriptionProvider: async (
      value: 'elevenlabs' | 'openai' | 'stage5'
    ) => {
      try {
        const result = await SystemIPC.setPreferredTranscriptionProvider(value);
        if (result.success) {
          set({ preferredTranscriptionProvider: value });
        }
        return result;
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update transcription preference:',
          err
        );
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Dubbing provider preference actions
    syncDubbingPreference: async () => {
      try {
        const provider = await SystemIPC.getPreferredDubbingProvider();
        set({ preferredDubbingProvider: provider });
      } catch (err) {
        console.error('[AiStore] Failed to sync dubbing preference:', err);
      }
    },

    setPreferredDubbingProvider: async (
      value: 'elevenlabs' | 'openai' | 'stage5'
    ) => {
      try {
        const result = await SystemIPC.setPreferredDubbingProvider(value);
        if (result.success) {
          set({ preferredDubbingProvider: value });
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update dubbing preference:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Stage5 dubbing TTS provider actions
    syncStage5DubbingTtsProvider: async () => {
      try {
        const provider = await SystemIPC.getStage5DubbingTtsProvider();
        set({ stage5DubbingTtsProvider: provider });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync Stage5 dubbing TTS provider:',
          err
        );
      }
    },

    setStage5DubbingTtsProvider: async (value: 'openai' | 'elevenlabs') => {
      try {
        const result = await SystemIPC.setStage5DubbingTtsProvider(value);
        if (result.success) {
          set({ stage5DubbingTtsProvider: value });
        }
        return result;
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update Stage5 dubbing TTS provider:',
          err
        );
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },
  };
});
