import { create } from 'zustand';
import * as SystemIPC from '@ipc/system';
import type {
  ByoVideoSuggestionModel,
  Stage5VideoSuggestionMode,
  VideoSuggestionModelPreference,
} from '@shared-types/app';
import {
  normalizeByoVideoSuggestionModel,
  normalizeStage5VideoSuggestionMode,
  resolveVideoSuggestionPreferenceForMode,
} from '../../shared/helpers/video-suggestion-model-preference';
import { openApiKeysRequired } from './modal-store';
import {
  hasApiKeyModeActiveCoverage,
  hasApiKeyModeConfiguredCoverage,
} from './byo-runtime';

/**
 * Simple mutex to prevent race conditions in cascading state updates.
 * Used by checkAndDisableApiKeyModeIfNeeded to ensure only one check runs at a time.
 */
let apiKeyModeCheckInProgress = false;

function resolveActiveVideoSuggestionPreference(
  state: Pick<
    AiStoreState,
    'useApiKeysMode' | 'stage5VideoSuggestionMode' | 'byoVideoSuggestionModel'
  >
): VideoSuggestionModelPreference {
  return resolveVideoSuggestionPreferenceForMode({
    apiKeyModeEnabled: state.useApiKeysMode,
    stage5Mode: state.stage5VideoSuggestionMode,
    byoModel: state.byoVideoSuggestionModel,
  });
}

/**
 * Check and disable API key mode if no full BYO coverage exists.
 * Shows modal to inform user they need to enter API keys.
 * Uses mutex to prevent race conditions from rapid key operations.
 */
async function checkAndDisableApiKeyModeIfNeeded(
  get: () => AiStoreState,
  set: (partial: Partial<AiStoreState>) => void
): Promise<void> {
  // Mutex: skip if another check is already in progress
  if (apiKeyModeCheckInProgress) return;
  // Set flag immediately to prevent race conditions
  apiKeyModeCheckInProgress = true;

  try {
    const state = get();
    if (!state.useApiKeysMode) return;
    if (!state.entitlementsHydrated) return;

    if (!hasApiKeyModeActiveCoverage(state)) {
      await SystemIPC.setApiKeyModeEnabled(false);
      set({
        useApiKeysMode: false,
        videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference(
          {
            ...state,
            useApiKeysMode: false,
          }
        ),
      });
      openApiKeysRequired();
    }
  } catch (err) {
    console.error('[AiStore] Failed to disable API key mode:', err);
  } finally {
    apiKeyModeCheckInProgress = false;
  }
}

interface AiStoreState {
  initialized: boolean;
  initializing: boolean;
  encryptionAvailable: boolean; // Whether OS-level encryption is available for API keys
  byoUnlocked: boolean;
  byoAnthropicUnlocked: boolean;
  byoElevenLabsUnlocked: boolean;
  stage5AnthropicReviewAvailable: boolean;
  entitlementsHydrated: boolean;
  // Admin preview mode: when true, pretend BYO is not unlocked (for UI testing)
  adminByoPreviewMode: boolean;
  entitlementsLoading: boolean;
  entitlementsError?: string;
  unlockPending: boolean;
  unlockUnresolved: boolean;
  unlockError?: string;
  lastFetched?: string;
  // Global API-key mode (never spend Stage5 credits)
  useApiKeysMode: boolean;
  // Claude translation preference (use Sonnet for draft instead of GPT)
  preferClaudeTranslation: boolean;
  // High-end review preference (Anthropic uses Opus, OpenAI uses GPT-5.4)
  preferClaudeReview: boolean;
  // Claude summary preference (use Claude on BYO summary paths instead of GPT)
  preferClaudeSummary: boolean;
  // Active preference currently used by runtime (derived from mode + split settings).
  videoSuggestionModelPreference: VideoSuggestionModelPreference;
  // Stage5 credits preference (standard/high).
  stage5VideoSuggestionMode: Stage5VideoSuggestionMode;
  // BYO model preference (direct model + migration-only legacy follow states).
  byoVideoSuggestionModel: ByoVideoSuggestionModel;
  // Transcription provider preference
  preferredTranscriptionProvider: 'elevenlabs' | 'openai' | 'stage5';
  // Dubbing provider preference
  preferredDubbingProvider: 'elevenlabs' | 'openai' | 'stage5';
  // Stage5 dubbing TTS provider (when using Stage5 API for dubbing)
  // 'openai' = cheaper ($15/1M chars), 'elevenlabs' = premium quality
  // (currently modeled at ElevenLabs Pro overage: $180/1M chars)
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
  dismissUnresolvedUnlock: () => void;
  // Admin preview mode action
  setAdminByoPreviewMode: (value: boolean) => void;
  // API key mode actions
  syncApiKeyMode: () => Promise<void>;
  setUseApiKeysMode: (
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
  // Video suggestion model preference actions
  syncStage5VideoSuggestionMode: () => Promise<void>;
  setStage5VideoSuggestionMode: (
    value: Stage5VideoSuggestionMode
  ) => Promise<{ success: boolean; error?: string }>;
  syncByoVideoSuggestionModel: () => Promise<void>;
  setByoVideoSuggestionModel: (
    value: ByoVideoSuggestionModel
  ) => Promise<{ success: boolean; error?: string }>;
  // Legacy compatibility wrappers.
  syncVideoSuggestionModelPreference: () => Promise<void>;
  setVideoSuggestionModelPreference: (
    value: VideoSuggestionModelPreference
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

function getApiKeyModeTranscriptionFallback(
  state: Pick<
    AiStoreState,
    | 'byoUnlocked'
    | 'byoElevenLabsUnlocked'
    | 'keyPresent'
    | 'elevenLabsKeyPresent'
  >
): 'elevenlabs' | 'openai' | 'stage5' {
  if (state.elevenLabsKeyPresent && state.byoElevenLabsUnlocked) {
    return 'elevenlabs';
  }
  if (state.keyPresent && state.byoUnlocked) {
    return 'openai';
  }
  return 'stage5';
}

function getApiKeyModeDubbingFallback(
  state: Pick<
    AiStoreState,
    | 'byoUnlocked'
    | 'byoElevenLabsUnlocked'
    | 'keyPresent'
    | 'elevenLabsKeyPresent'
  >
): 'elevenlabs' | 'openai' | 'stage5' {
  if (state.keyPresent && state.byoUnlocked) {
    return 'openai';
  }
  if (state.elevenLabsKeyPresent && state.byoElevenLabsUnlocked) {
    return 'elevenlabs';
  }
  return 'stage5';
}

async function coerceStage5ProviderPreferencesForApiKeyMode(
  get: () => AiStoreState,
  set: (partial: Partial<AiStoreState>) => void
): Promise<void> {
  const state = get();

  if (state.preferredTranscriptionProvider === 'stage5') {
    const fallback = getApiKeyModeTranscriptionFallback(state);
    if (fallback !== 'stage5') {
      try {
        await SystemIPC.setPreferredTranscriptionProvider(fallback);
        set({ preferredTranscriptionProvider: fallback });
      } catch (err) {
        console.error(
          '[AiStore] Failed to coerce transcription provider for API key mode:',
          err
        );
      }
    }
  }

  if (state.preferredDubbingProvider === 'stage5') {
    const fallback = getApiKeyModeDubbingFallback(state);
    if (fallback !== 'stage5') {
      try {
        await SystemIPC.setPreferredDubbingProvider(fallback);
        set({ preferredDubbingProvider: fallback });
      } catch (err) {
        console.error(
          '[AiStore] Failed to coerce dubbing provider for API key mode:',
          err
        );
      }
    }
  }
}

type HiddenByoProvider = 'openai' | 'anthropic' | 'elevenlabs';

async function enableConfiguredByoToggles(
  get: () => AiStoreState,
  set: (partial: Partial<AiStoreState>) => void,
  providers: HiddenByoProvider[] = ['openai', 'anthropic', 'elevenlabs']
): Promise<void> {
  const state = get();
  const enabledProviders = new Set(providers);
  let changed = false;

  if (
    enabledProviders.has('openai') &&
    state.byoUnlocked &&
    state.keyPresent &&
    !state.useByo
  ) {
    try {
      const result = await SystemIPC.setByoProviderEnabled(true);
      if (result.success) {
        set({ useByo: true });
        changed = true;
      }
    } catch (err) {
      console.error('[AiStore] Failed to auto-enable OpenAI BYO:', err);
    }
  }

  if (
    enabledProviders.has('anthropic') &&
    state.byoAnthropicUnlocked &&
    state.anthropicKeyPresent &&
    !state.useByoAnthropic
  ) {
    try {
      const result = await SystemIPC.setByoAnthropicEnabled(true);
      if (result.success) {
        set({ useByoAnthropic: true });
        changed = true;
      }
    } catch (err) {
      console.error('[AiStore] Failed to auto-enable Anthropic BYO:', err);
    }
  }

  if (
    enabledProviders.has('elevenlabs') &&
    state.byoElevenLabsUnlocked &&
    state.elevenLabsKeyPresent &&
    !state.useByoElevenLabs
  ) {
    try {
      const result = await SystemIPC.setByoElevenLabsEnabled(true);
      if (result.success) {
        set({ useByoElevenLabs: true });
        changed = true;
      }
    } catch (err) {
      console.error('[AiStore] Failed to auto-enable ElevenLabs BYO:', err);
    }
  }

  if (changed && get().useApiKeysMode) {
    await coerceStage5ProviderPreferencesForApiKeyMode(get, set);
  }
}

const unsubscribers: Array<() => void> = [];
const BYO_UNLOCK_REFRESH_INTERVAL_MS = 2_500;
const BYO_UNLOCK_REFRESH_MAX_MS = 10 * 60_000;
const BYO_UNLOCK_FOCUS_REFRESH_DEBOUNCE_MS = 1_000;

let byoUnlockRefreshInterval: ReturnType<typeof setInterval> | null = null;
let byoUnlockRefreshStartedAt: number | null = null;
let byoUnlockRefreshInFlight = false;
let lastByoUnlockFocusRefreshAt = 0;

function stopByoUnlockRefreshLoop() {
  if (byoUnlockRefreshInterval) {
    clearInterval(byoUnlockRefreshInterval);
    byoUnlockRefreshInterval = null;
  }
  byoUnlockRefreshInFlight = false;
}

function refreshUnresolvedByoUnlock(get: () => AiStoreState) {
  const state = get();
  if (!state.unlockUnresolved || state.byoUnlocked) {
    stopByoUnlockRefreshLoop();
    return;
  }

  if (
    byoUnlockRefreshStartedAt &&
    Date.now() - byoUnlockRefreshStartedAt > BYO_UNLOCK_REFRESH_MAX_MS
  ) {
    byoUnlockRefreshStartedAt = null;
    stopByoUnlockRefreshLoop();
    return;
  }

  if (byoUnlockRefreshInFlight) {
    return;
  }

  byoUnlockRefreshInFlight = true;
  void state
    .refreshEntitlements()
    .catch(err => {
      console.error('[AiStore] Failed to poll unresolved BYO unlock:', err);
    })
    .finally(() => {
      byoUnlockRefreshInFlight = false;
      const nextState = get();
      if (!nextState.unlockUnresolved || nextState.byoUnlocked) {
        stopByoUnlockRefreshLoop();
      }
    });
}

function startByoUnlockRefreshLoop(get: () => AiStoreState) {
  if (!byoUnlockRefreshStartedAt) {
    byoUnlockRefreshStartedAt = Date.now();
  }

  refreshUnresolvedByoUnlock(get);

  if (byoUnlockRefreshInterval) {
    return;
  }

  byoUnlockRefreshInterval = setInterval(() => {
    refreshUnresolvedByoUnlock(get);
  }, BYO_UNLOCK_REFRESH_INTERVAL_MS);
}

function ensureSubscriptions(
  set: (partial: Partial<AiStoreState>) => void,
  get: () => AiStoreState
) {
  if (unsubscribers.length > 0) return;

  const refreshUnresolvedByoUnlockAfterReturn = () => {
    const state = get();
    if (!state.unlockUnresolved || state.byoUnlocked) return;

    const now = Date.now();
    if (
      now - lastByoUnlockFocusRefreshAt <
      BYO_UNLOCK_FOCUS_REFRESH_DEBOUNCE_MS
    ) {
      return;
    }
    lastByoUnlockFocusRefreshAt = now;

    startByoUnlockRefreshLoop(get);
  };

  const onWindowFocus = () => refreshUnresolvedByoUnlockAfterReturn();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      refreshUnresolvedByoUnlockAfterReturn();
    }
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    unsubscribers.push(() => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopByoUnlockRefreshLoop();
    });
  }

  unsubscribers.push(
    SystemIPC.onEntitlementsUpdated(snapshot => {
      const hasByoOpenAi = Boolean(snapshot?.byoOpenAi);
      const previousState = get();
      set({
        byoUnlocked: hasByoOpenAi,
        byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
        byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
        stage5AnthropicReviewAvailable: Boolean(
          snapshot?.stage5AnthropicReviewAvailable
        ),
        entitlementsHydrated: true,
        entitlementsLoading: false,
        entitlementsError: undefined,
        unlockPending: hasByoOpenAi ? false : previousState.unlockPending,
        unlockUnresolved: hasByoOpenAi
          ? false
          : previousState.unlockUnresolved,
        lastFetched: snapshot?.fetchedAt,
      });
      if (hasByoOpenAi) {
        byoUnlockRefreshStartedAt = null;
        stopByoUnlockRefreshLoop();
      }
      void enableConfiguredByoToggles(get, set);
    })
  );

  unsubscribers.push(
    SystemIPC.onEntitlementsError(payload => {
      set({
        entitlementsError: payload?.message || 'Failed to load entitlements',
        entitlementsLoading: false,
        unlockPending: false,
        unlockUnresolved: false,
      });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockPending(() => {
      set({
        unlockPending: true,
        unlockUnresolved: false,
        unlockError: undefined,
      });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockConfirmed(snapshot => {
      set({
        unlockPending: false,
        unlockUnresolved: false,
        unlockError: undefined,
        byoUnlocked: Boolean(snapshot?.byoOpenAi),
        byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
        byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
        stage5AnthropicReviewAvailable: Boolean(
          snapshot?.stage5AnthropicReviewAvailable
        ),
        entitlementsHydrated: true,
        entitlementsLoading: false,
        entitlementsError: undefined,
        lastFetched: snapshot?.fetchedAt,
      });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
      void enableConfiguredByoToggles(get, set);
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockCancelled(() => {
      if (get().unlockPending || get().unlockUnresolved) {
        set({ unlockPending: false, unlockUnresolved: false });
      }
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockUnresolved(() => {
      set({ unlockPending: false, unlockUnresolved: true });
      byoUnlockRefreshStartedAt = Date.now();
      startByoUnlockRefreshLoop(get);
    })
  );

  unsubscribers.push(
    SystemIPC.onByoUnlockError(payload => {
      set({
        unlockPending: false,
        unlockUnresolved: false,
        unlockError: payload?.message || 'Unlock failed',
      });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
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
        await checkAndDisableApiKeyModeIfNeeded(get, set);
        return;
      }
      try {
        const key = await SystemIPC.getOpenAiApiKey();
        set({ keyPresent: Boolean(key), keyValue: key ?? '' });
        await enableConfiguredByoToggles(get, set, ['openai']);
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
        await checkAndDisableApiKeyModeIfNeeded(get, set);
        return;
      }
      try {
        const key = await SystemIPC.getAnthropicApiKey();
        set({
          anthropicKeyPresent: Boolean(key),
          anthropicKeyValue: key ?? '',
        });
        await enableConfiguredByoToggles(get, set, ['anthropic']);
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
        await checkAndDisableApiKeyModeIfNeeded(get, set);
        return;
      }
      try {
        const key = await SystemIPC.getElevenLabsApiKey();
        set({
          elevenLabsKeyPresent: Boolean(key),
          elevenLabsKeyValue: key ?? '',
        });
        await enableConfiguredByoToggles(get, set, ['elevenlabs']);
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
    stage5AnthropicReviewAvailable: false,
    entitlementsHydrated: false,
    adminByoPreviewMode: false,
    entitlementsLoading: true,
    entitlementsError: undefined,
    unlockPending: false,
    unlockUnresolved: false,
    unlockError: undefined,
    lastFetched: undefined,
    // API key mode (defaults to false - user must explicitly enable it)
    useApiKeysMode: false,
    // Claude translation preference (defaults to false - use GPT which is cheaper)
    preferClaudeTranslation: false,
    // Review preference defaults to OpenAI high-end review on fresh installs.
    preferClaudeReview: false,
    // Claude summary preference (defaults to true - prefer Claude on BYO summary paths)
    preferClaudeSummary: true,
    // Video suggestion model settings (split by mode)
    stage5VideoSuggestionMode: 'standard',
    byoVideoSuggestionModel: 'gpt-5.1',
    videoSuggestionModelPreference: 'gpt-5.1',
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
        const [, settingsResult] = await Promise.allSettled([
          get().fetchEntitlements(),
          SystemIPC.getAllByoSettings(),
        ]);

        // Assume encryption is available by default (it is on all modern systems)
        // Will be updated to false if saving a key fails due to encryption unavailability
        set({ encryptionAvailable: true });

        // Apply all BYO settings from the batched call
        if (settingsResult.status === 'fulfilled') {
          const settings = settingsResult.value;
          const stage5VideoSuggestionMode = normalizeStage5VideoSuggestionMode(
            settings.stage5VideoSuggestionMode ?? settings.videoSuggestionModelPreference
          );
          const byoVideoSuggestionModel = normalizeByoVideoSuggestionModel(
            settings.byoVideoSuggestionModel ?? settings.videoSuggestionModelPreference
          );
          const videoSuggestionModelPreference =
            resolveVideoSuggestionPreferenceForMode({
              apiKeyModeEnabled: settings.useApiKeysMode,
              stage5Mode: stage5VideoSuggestionMode,
              byoModel: byoVideoSuggestionModel,
            });
          set({
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
            // API key mode
            useApiKeysMode: settings.useApiKeysMode,
            // Claude preferences
            preferClaudeTranslation: settings.preferClaudeTranslation,
            preferClaudeReview: settings.preferClaudeReview,
            preferClaudeSummary: settings.preferClaudeSummary,
            stage5VideoSuggestionMode,
            byoVideoSuggestionModel,
            videoSuggestionModelPreference,
            // Provider preferences
            preferredTranscriptionProvider:
              settings.preferredTranscriptionProvider,
            preferredDubbingProvider: settings.preferredDubbingProvider,
            stage5DubbingTtsProvider: settings.stage5DubbingTtsProvider,
          });

          await enableConfiguredByoToggles(get, set);

          // If API key mode is ON but no valid full-stack coverage exists
          // (for example, keys were cleared during migration), auto-disable it so
          // the user sees the Stage5 credits UI again.
          if (settings.useApiKeysMode && get().entitlementsHydrated) {
            const currentState = get();
            const hasValidCombo = hasApiKeyModeActiveCoverage({
              useApiKeysMode: currentState.useApiKeysMode,
              byoUnlocked: currentState.byoUnlocked,
              byoAnthropicUnlocked: currentState.byoAnthropicUnlocked,
              byoElevenLabsUnlocked: currentState.byoElevenLabsUnlocked,
              useByo: currentState.useByo,
              useByoAnthropic: currentState.useByoAnthropic,
              useByoElevenLabs: currentState.useByoElevenLabs,
              keyPresent: currentState.keyPresent,
              anthropicKeyPresent: currentState.anthropicKeyPresent,
              elevenLabsKeyPresent: currentState.elevenLabsKeyPresent,
            });
            if (!hasValidCombo) {
              // Silently disable API key mode so the user sees Stage5 credits.
              try {
                await SystemIPC.setApiKeyModeEnabled(false);
                const refreshedState = get();
                set({
                  useApiKeysMode: false,
                  videoSuggestionModelPreference:
                    resolveActiveVideoSuggestionPreference({
                      ...refreshedState,
                      useApiKeysMode: false,
                    }),
                });
              } catch (err) {
                console.error(
                  '[AiStore] Failed to auto-disable API key mode:',
                  err
                );
              }
            } else {
              await coerceStage5ProviderPreferencesForApiKeyMode(get, set);
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
        const hasByoOpenAi = Boolean(snapshot?.byoOpenAi);
        const previousState = get();
        set({
          byoUnlocked: hasByoOpenAi,
          byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
          byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
          stage5AnthropicReviewAvailable: Boolean(
            snapshot?.stage5AnthropicReviewAvailable
          ),
          entitlementsHydrated: true,
          entitlementsLoading: false,
          entitlementsError: undefined,
          unlockPending: hasByoOpenAi ? false : previousState.unlockPending,
          unlockUnresolved: hasByoOpenAi
            ? false
            : previousState.unlockUnresolved,
          lastFetched: snapshot?.fetchedAt,
        });
        if (hasByoOpenAi) {
          byoUnlockRefreshStartedAt = null;
          stopByoUnlockRefreshLoop();
        }
        await enableConfiguredByoToggles(get, set);
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
        const hasByoOpenAi = Boolean(snapshot?.byoOpenAi);
        const previousState = get();
        set({
          byoUnlocked: hasByoOpenAi,
          byoAnthropicUnlocked: Boolean(snapshot?.byoAnthropic),
          byoElevenLabsUnlocked: Boolean(snapshot?.byoElevenLabs),
          stage5AnthropicReviewAvailable: Boolean(
            snapshot?.stage5AnthropicReviewAvailable
          ),
          entitlementsHydrated: true,
          entitlementsLoading: false,
          entitlementsError: undefined,
          unlockPending: hasByoOpenAi ? false : previousState.unlockPending,
          unlockUnresolved: hasByoOpenAi
            ? false
            : previousState.unlockUnresolved,
          lastFetched: snapshot?.fetchedAt,
        });
        if (hasByoOpenAi) {
          byoUnlockRefreshStartedAt = null;
          stopByoUnlockRefreshLoop();
        }
        await enableConfiguredByoToggles(get, set);
      } catch (err: any) {
        set({
          entitlementsLoading: false,
          entitlementsError: err?.message || 'Failed to refresh entitlements',
        });
      }
    },

    startUnlock: async () => {
      set({
        unlockPending: true,
        unlockUnresolved: false,
        unlockError: undefined,
      });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
      try {
        await SystemIPC.createByoUnlockSession();
      } catch (err: any) {
        set({
          unlockPending: false,
          unlockUnresolved: false,
          unlockError: err?.message || 'Unable to start checkout',
        });
      }
    },

    dismissUnresolvedUnlock: () => {
      set({ unlockPending: false, unlockUnresolved: false });
      byoUnlockRefreshStartedAt = null;
      stopByoUnlockRefreshLoop();
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
          await enableConfiguredByoToggles(get, set, ['openai']);
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
          // Reset OpenAI-dependent preferences to fallback (ElevenLabs if available, else stage5)
          const state = get();
          const fallback =
            state.elevenLabsKeyPresent && state.byoElevenLabsUnlocked
              ? 'elevenlabs'
              : 'stage5';
          if (state.preferredTranscriptionProvider === 'openai') {
            try {
              await SystemIPC.setPreferredTranscriptionProvider(fallback);
              set({ preferredTranscriptionProvider: fallback });
            } catch (err) {
              console.error(
                '[AiStore] Failed to reset transcription provider:',
                err
              );
            }
          }
          if (state.preferredDubbingProvider === 'openai') {
            try {
              await SystemIPC.setPreferredDubbingProvider(fallback);
              set({ preferredDubbingProvider: fallback });
            } catch (err) {
              console.error('[AiStore] Failed to reset dubbing provider:', err);
            }
          }
          await checkAndDisableApiKeyModeIfNeeded(get, set);
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
            await checkAndDisableApiKeyModeIfNeeded(get, set);
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
          await enableConfiguredByoToggles(get, set, ['anthropic']);
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
          // Reset Anthropic-dependent preferences that truly require Anthropic BYO.
          // Review preference is shared with the Stage5 credit path, so keep it.
          const state = get();
          if (state.preferClaudeTranslation) {
            try {
              await SystemIPC.setPreferClaudeTranslation(false);
              set({ preferClaudeTranslation: false });
            } catch (err) {
              console.error(
                '[AiStore] Failed to reset Claude translation preference:',
                err
              );
            }
          }
          if (state.preferClaudeSummary) {
            try {
              await SystemIPC.setPreferClaudeSummary(false);
              set({ preferClaudeSummary: false });
            } catch (err) {
              console.error(
                '[AiStore] Failed to reset Claude summary preference:',
                err
              );
            }
          }
          await checkAndDisableApiKeyModeIfNeeded(get, set);
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
            await checkAndDisableApiKeyModeIfNeeded(get, set);
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
          await enableConfiguredByoToggles(get, set, ['elevenlabs']);
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
          // Reset ElevenLabs-dependent preferences to defaults
          const state = get();
          const fallback =
            state.keyPresent && state.byoUnlocked ? 'openai' : 'stage5';
          if (state.preferredTranscriptionProvider === 'elevenlabs') {
            try {
              await SystemIPC.setPreferredTranscriptionProvider(fallback);
              set({ preferredTranscriptionProvider: fallback });
            } catch (err) {
              console.error(
                '[AiStore] Failed to reset transcription provider:',
                err
              );
            }
          }
          if (state.preferredDubbingProvider === 'elevenlabs') {
            try {
              await SystemIPC.setPreferredDubbingProvider(fallback);
              set({ preferredDubbingProvider: fallback });
            } catch (err) {
              console.error('[AiStore] Failed to reset dubbing provider:', err);
            }
          }
          await checkAndDisableApiKeyModeIfNeeded(get, set);
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
            await checkAndDisableApiKeyModeIfNeeded(get, set);
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

    // API key mode actions
    syncApiKeyMode: async () => {
      try {
        const enabled = await SystemIPC.getApiKeyModeEnabled();
        set(state => {
          const useApiKeysMode = Boolean(enabled);
          return {
            useApiKeysMode,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              useApiKeysMode,
            }),
          };
        });
      } catch (err) {
        console.error('[AiStore] Failed to sync API key mode:', err);
      }
    },

    setUseApiKeysMode: async (value: boolean) => {
      try {
        if (value && !hasApiKeyModeConfiguredCoverage(get())) {
          return {
            success: false,
            error: 'Full API-key coverage is required to enable this mode.',
          };
        }
        const result = await SystemIPC.setApiKeyModeEnabled(value);
        if (result.success) {
          set(state => {
            const useApiKeysMode = Boolean(value);
            return {
              useApiKeysMode,
              videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
                ...state,
                useApiKeysMode,
              }),
            };
          });

          // When turning ON, auto-enable all providers that have keys and
          // move any legacy Stage5 provider prefs onto a BYO provider.
          if (value) {
            const state = get();
            if (state.keyPresent && state.byoUnlocked) {
              try {
                await SystemIPC.setByoProviderEnabled(true);
                set({ useByo: true });
              } catch (err) {
                console.error('[AiStore] Failed to auto-enable OpenAI:', err);
              }
            }
            if (state.anthropicKeyPresent && state.byoAnthropicUnlocked) {
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
            if (state.elevenLabsKeyPresent && state.byoElevenLabsUnlocked) {
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
            await coerceStage5ProviderPreferencesForApiKeyMode(get, set);
          }
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update API key mode:', err);
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

    // Video suggestion model settings (split by mode)
    syncStage5VideoSuggestionMode: async () => {
      try {
        const mode = await SystemIPC.getStage5VideoSuggestionMode();
        set(state => {
          const stage5VideoSuggestionMode = normalizeStage5VideoSuggestionMode(mode);
          return {
            stage5VideoSuggestionMode,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              stage5VideoSuggestionMode,
            }),
          };
        });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync Stage5 video suggestion mode:',
          err
        );
      }
    },

    setStage5VideoSuggestionMode: async (value: Stage5VideoSuggestionMode) => {
      try {
        const mode = normalizeStage5VideoSuggestionMode(value);
        const result = await SystemIPC.setStage5VideoSuggestionMode(mode);
        if (result.success) {
          set(state => ({
            stage5VideoSuggestionMode: mode,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              stage5VideoSuggestionMode: mode,
            }),
          }));
        }
        return result;
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update Stage5 video suggestion mode:',
          err
        );
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    syncByoVideoSuggestionModel: async () => {
      try {
        const model = await SystemIPC.getByoVideoSuggestionModel();
        set(state => {
          const byoVideoSuggestionModel = normalizeByoVideoSuggestionModel(model);
          return {
            byoVideoSuggestionModel,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              byoVideoSuggestionModel,
            }),
          };
        });
      } catch (err) {
        console.error('[AiStore] Failed to sync BYO video suggestion model:', err);
      }
    },

    setByoVideoSuggestionModel: async (value: ByoVideoSuggestionModel) => {
      try {
        const model = normalizeByoVideoSuggestionModel(value);
        const result = await SystemIPC.setByoVideoSuggestionModel(model);
        if (result.success) {
          set(state => ({
            byoVideoSuggestionModel: model,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              byoVideoSuggestionModel: model,
            }),
          }));
        }
        return result;
      } catch (err: any) {
        console.error('[AiStore] Failed to update BYO video suggestion model:', err);
        return {
          success: false,
          error: err?.message || 'Failed to save preference',
        };
      }
    },

    // Legacy compatibility wrappers
    syncVideoSuggestionModelPreference: async () => {
      try {
        const [stage5VideoSuggestionMode, byoVideoSuggestionModel] =
          await Promise.all([
            SystemIPC.getStage5VideoSuggestionMode(),
            SystemIPC.getByoVideoSuggestionModel(),
          ]);
        set(state => {
          const normalizedStage5 = normalizeStage5VideoSuggestionMode(
            stage5VideoSuggestionMode
          );
          const normalizedByo =
            normalizeByoVideoSuggestionModel(byoVideoSuggestionModel);
          return {
            stage5VideoSuggestionMode: normalizedStage5,
            byoVideoSuggestionModel: normalizedByo,
            videoSuggestionModelPreference: resolveActiveVideoSuggestionPreference({
              ...state,
              stage5VideoSuggestionMode: normalizedStage5,
              byoVideoSuggestionModel: normalizedByo,
            }),
          };
        });
      } catch (err) {
        console.error(
          '[AiStore] Failed to sync video suggestion model preference:',
          err
        );
      }
    },

    setVideoSuggestionModelPreference: async (
      value: VideoSuggestionModelPreference
    ) => {
      try {
        if (value === 'default' || value === 'quality') {
          return await get().setStage5VideoSuggestionMode(
            value === 'quality' ? 'high' : 'standard'
          );
        }
        return await get().setByoVideoSuggestionModel(
          normalizeByoVideoSuggestionModel(value)
        );
      } catch (err: any) {
        console.error(
          '[AiStore] Failed to update video suggestion model preference:',
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
          if (value === 'openai' || value === 'elevenlabs') {
            await enableConfiguredByoToggles(get, set, [value]);
          }
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
          if (value === 'openai' || value === 'elevenlabs') {
            await enableConfiguredByoToggles(get, set, [value]);
          }
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
