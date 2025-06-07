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

export function refundCredits(hours: number): Promise<{
  success: boolean;
  newBalanceCredits?: number;
  newBalanceHours?: number;
  error?: string;
}> {
  return window.electron.refundCredits(hours);
}

export function reserveCredits(hours: number): Promise<{
  success: boolean;
  newBalanceCredits?: number;
  newBalanceHours?: number;
  error?: string;
}> {
  return window.electron.reserveCredits(hours);
}

export function getVideoMetadata(
  filePath: string
): Promise<VideoMetadataResult> {
  return window.electron.getVideoMetadata(filePath);
}

export function createCheckoutSession(
  packId: 'HOUR_5'
): Promise<string | null> {
  return window.electron.createCheckoutSession(packId);
}

export function onCreditsUpdated(
  callback: (payload: { creditBalance: number; hoursBalance: number }) => void
): () => void {
  return window.electron.onCreditsUpdated(callback);
}
