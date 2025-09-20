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
  fetchedAt?: string;
}> {
  return window.electron.getEntitlements();
}

export function refreshEntitlements(): Promise<{
  byoOpenAi: boolean;
  fetchedAt?: string;
}> {
  return window.electron.refreshEntitlements();
}

export function onEntitlementsUpdated(
  callback: (snapshot: { byoOpenAi: boolean; fetchedAt?: string }) => void
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
  callback: (snapshot: { byoOpenAi: boolean; fetchedAt?: string }) => void
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
