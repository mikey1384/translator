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
