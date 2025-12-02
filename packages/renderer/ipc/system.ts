import type {
  CreditBalanceResult,
  VideoMetadataResult,
} from '@shared-types/app';

export function showMessage(message: string): Promise<void> {
  return window.electron.showMessage(message);
}

export function getLocaleUrl(lang: string): Promise<string> {
  return window.electron.getLocaleUrl(lang);
}

export function getLanguagePreference(): Promise<string | null> {
  return window.electron.getLanguagePreference();
}

export function setLanguagePreference(
  lang: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setLanguagePreference(lang);
}

export function getCreditBalance(): Promise<CreditBalanceResult> {
  return window.electron.getCreditBalance();
}

export function getVideoMetadata(
  filePath: string
): Promise<VideoMetadataResult> {
  return window.electron.getVideoMetadata(filePath);
}

export function createCheckoutSession(
  packId: 'MICRO' | 'STARTER' | 'STANDARD' | 'PRO'
): Promise<string | null> {
  return window.electron.createCheckoutSession(packId);
}

export function createByoUnlockSession(): Promise<void> {
  return window.electron.createByoUnlockSession();
}

export function getOpenAiApiKey(): Promise<string | null> {
  return window.electron.getOpenAiApiKey();
}

export function setOpenAiApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setOpenAiApiKey(apiKey);
}

export function clearOpenAiApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearOpenAiApiKey();
}

export function validateOpenAiApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateOpenAiApiKey(apiKey);
}

export function getByoProviderEnabled(): Promise<boolean> {
  return window.electron.getByoProviderEnabled();
}

export function setByoProviderEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoProviderEnabled(enabled);
}

export function onCreditsUpdated(
  callback: (payload: { creditBalance: number; hoursBalance: number }) => void
): () => void {
  return window.electron.onCreditsUpdated(callback);
}

export function onCheckoutPending(callback: () => void): () => void {
  return window.electron.onCheckoutPending(callback);
}

export function onCheckoutConfirmed(callback: () => void): () => void {
  return window.electron.onCheckoutConfirmed(callback);
}

export function onCheckoutCancelled(callback: () => void): () => void {
  return window.electron.onCheckoutCancelled(callback);
}

export function getEntitlements(): Promise<{
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  fetchedAt?: string;
}> {
  return window.electron.getEntitlements();
}

export function refreshEntitlements(): Promise<{
  byoOpenAi: boolean;
  byoAnthropic: boolean;
  byoElevenLabs: boolean;
  fetchedAt?: string;
}> {
  return window.electron.refreshEntitlements();
}

export function onEntitlementsUpdated(
  callback: (snapshot: {
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    fetchedAt?: string;
  }) => void
): () => void {
  return window.electron.onEntitlementsUpdated(callback);
}

export function onEntitlementsError(
  callback: (payload: { message: string }) => void
): () => void {
  return window.electron.onEntitlementsError(callback);
}

export function onByoUnlockPending(callback: () => void): () => void {
  return window.electron.onByoUnlockPending(callback);
}

export function onByoUnlockConfirmed(
  callback: (snapshot: {
    byoOpenAi: boolean;
    byoAnthropic: boolean;
    byoElevenLabs: boolean;
    fetchedAt?: string;
  }) => void
): () => void {
  return window.electron.onByoUnlockConfirmed(callback);
}

export function onByoUnlockCancelled(callback: () => void): () => void {
  return window.electron.onByoUnlockCancelled(callback);
}

export function onByoUnlockError(
  callback: (payload: { message?: string }) => void
): () => void {
  return window.electron.onByoUnlockError(callback);
}

export function onOpenAiApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onOpenAiApiKeyChanged(callback);
}

// Anthropic API key functions
export function getAnthropicApiKey(): Promise<string | null> {
  return window.electron.getAnthropicApiKey();
}

export function setAnthropicApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setAnthropicApiKey(apiKey);
}

export function clearAnthropicApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearAnthropicApiKey();
}

export function validateAnthropicApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateAnthropicApiKey(apiKey);
}

export function getByoAnthropicEnabled(): Promise<boolean> {
  return window.electron.getByoAnthropicEnabled();
}

export function setByoAnthropicEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoAnthropicEnabled(enabled);
}

export function onAnthropicApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onAnthropicApiKeyChanged(callback);
}

export function getDeviceId(): Promise<string> {
  return window.electron.getDeviceId();
}

export function getAdminDeviceId(): Promise<string | null> {
  return window.electron.getAdminDeviceId();
}

export function resetCredits(): Promise<{
  success: boolean;
  creditsAdded?: number;
  error?: string;
}> {
  return window.electron.resetCredits();
}

export function resetCreditsToZero(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.resetCreditsToZero();
}

export function getVoiceCloningPricing(): Promise<{
  creditsPerMinute: number;
  description: string;
}> {
  return window.electron.getVoiceCloningPricing();
}

// ElevenLabs API key functions
export function getElevenLabsApiKey(): Promise<string | null> {
  return window.electron.getElevenLabsApiKey();
}

export function setElevenLabsApiKey(
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setElevenLabsApiKey(apiKey);
}

export function clearElevenLabsApiKey(): Promise<{
  success: boolean;
  error?: string;
}> {
  return window.electron.clearElevenLabsApiKey();
}

export function validateElevenLabsApiKey(
  apiKey?: string
): Promise<{ ok: boolean; error?: string }> {
  return window.electron.validateElevenLabsApiKey(apiKey);
}

export function getByoElevenLabsEnabled(): Promise<boolean> {
  return window.electron.getByoElevenLabsEnabled();
}

export function setByoElevenLabsEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoElevenLabsEnabled(enabled);
}

// Master BYO toggle
export function getByoMasterEnabled(): Promise<boolean> {
  return window.electron.getByoMasterEnabled();
}

export function setByoMasterEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setByoMasterEnabled(enabled);
}

// Claude translation preference
export function getPreferClaudeTranslation(): Promise<boolean> {
  return window.electron.getPreferClaudeTranslation();
}

export function setPreferClaudeTranslation(
  prefer: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferClaudeTranslation(prefer);
}

// Claude review preference
export function getPreferClaudeReview(): Promise<boolean> {
  return window.electron.getPreferClaudeReview();
}

export function setPreferClaudeReview(
  prefer: boolean
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferClaudeReview(prefer);
}

// Transcription provider preference
export type TranscriptionProvider = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredTranscriptionProvider(): Promise<TranscriptionProvider> {
  return window.electron.getPreferredTranscriptionProvider();
}

export function setPreferredTranscriptionProvider(
  provider: TranscriptionProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferredTranscriptionProvider(provider);
}

// Dubbing provider preference
export type DubbingProvider = 'elevenlabs' | 'openai' | 'stage5';

export function getPreferredDubbingProvider(): Promise<DubbingProvider> {
  return window.electron.getPreferredDubbingProvider();
}

export function setPreferredDubbingProvider(
  provider: DubbingProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setPreferredDubbingProvider(provider);
}

// Stage5 dubbing TTS provider (when using Stage5 API)
// 'openai' = cheaper ($15/1M chars), 'elevenlabs' = premium ($200/1M chars)
export type Stage5TtsProvider = 'openai' | 'elevenlabs';

export function getStage5DubbingTtsProvider(): Promise<Stage5TtsProvider> {
  return window.electron.getStage5DubbingTtsProvider();
}

export function setStage5DubbingTtsProvider(
  provider: Stage5TtsProvider
): Promise<{ success: boolean; error?: string }> {
  return window.electron.setStage5DubbingTtsProvider(provider);
}

export function onElevenLabsApiKeyChanged(
  callback: (payload: { hasKey: boolean }) => void
): () => void {
  return window.electron.onElevenLabsApiKeyChanged(callback);
}
