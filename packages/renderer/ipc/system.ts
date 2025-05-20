import type {
  CreditBalanceResult,
  PurchaseCreditsOptions,
  PurchaseCreditsResult,
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

export function purchaseCredits(
  opts: PurchaseCreditsOptions
): Promise<PurchaseCreditsResult> {
  return window.electron.purchaseCredits(opts);
}

export function refundCredits(hours: number) {
  return window.electron.refundCredits(hours);
}

export function reserveCredits(hours: number) {
  return window.electron.reserveCredits(hours);
}

export function getVideoMetadata(
  filePath: string
): Promise<VideoMetadataResult> {
  return window.electron.getVideoMetadata(filePath);
}
